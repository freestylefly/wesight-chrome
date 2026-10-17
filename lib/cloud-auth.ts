import {
  getLocal, getSession, removeLocal, removeSession, setLocal, setSession,
  parseMembershipSummary, SESSION_KEYS, STORAGE_KEYS, type AccessRecord
} from "~lib/storage"
import { isWeSightUser, type WeSightAuthState, type WeSightUser } from "~types/auth"

export const CLOUD_API = "https://api.wesight.ai"
const LOGIN_TTL_MS = 10 * 60 * 1000
const IDENTITY_CACHE_MS = 60_000
const LOGIN_CALLBACK_RULE_ID = 10001
const LOGIN_CALLBACK_PAGE = "tabs/auth-callback.html"

interface Envelope<T> {
  code: number
  data?: T
  message?: string
}

interface Tokens {
  accessToken: string
  refreshToken: string
}

interface CloudSession {
  accessToken: string
  user?: WeSightUser
  access?: AccessRecord
  checkedAt?: number
}

interface LoginTransaction {
  tabId: number
  expiresAt: number
}

export interface VerifiedIdentity {
  user: WeSightUser
  access: AccessRecord
}

class AuthExpiredError extends Error {}
let refreshPromise: Promise<string> | null = null
let identityPromise: Promise<VerifiedIdentity | null> | null = null
let callbackPromise: Promise<boolean> | null = null

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${CLOUD_API}${path}`, { ...init, credentials: "omit" })
  const envelope = await response.json() as Envelope<T>
  if (response.status === 401) throw new AuthExpiredError(envelope.message || "WeSight 登录已失效")
  if (!response.ok || envelope.code !== 0 || !envelope.data) {
    throw new Error(envelope.message || `WeSight 请求失败（HTTP ${response.status}）`)
  }
  return envelope.data
}

export const DEFAULT_CHECKOUT_URL = "https://pay.wesight.ai/billing"

// Only https pages on wesight.ai may be opened as the membership checkout.
export function safeCheckoutUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  try {
    const url = new URL(value)
    return url.protocol === "https:" && (url.hostname === "wesight.ai" || url.hostname.endsWith(".wesight.ai"))
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

export function membershipCheckoutUrl(access: AccessRecord | null | undefined): string {
  const url = new URL(safeCheckoutUrl(access?.checkoutUrl) ?? DEFAULT_CHECKOUT_URL)
  url.searchParams.set("source", "chrome-extension")
  return url.toString()
}

export async function publishAuthState(state: WeSightAuthState): Promise<void> {
  const previous = await getLocal<WeSightAuthState>(STORAGE_KEYS.auth)
  if (JSON.stringify(previous) !== JSON.stringify(state)) await setLocal(STORAGE_KEYS.auth, state)
}

export async function loginPending(): Promise<boolean> {
  const transaction = await getSession<LoginTransaction>(SESSION_KEYS.loginTransaction)
  if (!transaction) return false
  if (transaction.expiresAt <= Date.now()) {
    await removeSession(SESSION_KEYS.loginTransaction)
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [LOGIN_CALLBACK_RULE_ID] })
    return false
  }
  return true
}

async function rotate(): Promise<string> {
  const refreshToken = await getLocal<string>(STORAGE_KEYS.refreshToken)
  if (!refreshToken) throw new AuthExpiredError("请登录 WeSight")
  const tokens = await api<Tokens>("/api/auth/refresh", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken })
  })
  if (!tokens.accessToken || !tokens.refreshToken) throw new Error("WeSight 登录响应不完整")
  await setLocal(STORAGE_KEYS.refreshToken, tokens.refreshToken)
  await setSession<CloudSession>(SESSION_KEYS.cloudSession, { accessToken: tokens.accessToken })
  return tokens.accessToken
}

async function refreshToken(): Promise<string> {
  refreshPromise ??= rotate()
  try { return await refreshPromise } finally { refreshPromise = null }
}

async function fetchIdentity(force: boolean): Promise<VerifiedIdentity | null> {
  let session = await getSession<CloudSession>(SESSION_KEYS.cloudSession)
  if (!session && !await getLocal<string>(STORAGE_KEYS.refreshToken)) return null
  if (!force && session?.user && session.access && Date.now() - (session.checkedAt ?? 0) < IDENTITY_CACHE_MS) {
    return { user: session.user, access: session.access }
  }
  let token: string
  try { token = session?.accessToken || await refreshToken() } catch (error) {
    if (!(error instanceof AuthExpiredError)) throw error
    await removeLocal(STORAGE_KEYS.refreshToken)
    await removeSession(SESSION_KEYS.cloudSession)
    return null
  }
  const read = async () => {
    const headers = { Authorization: `Bearer ${token}` }
    const user = await api<WeSightUser>("/api/user/profile", { headers })
    if (!isWeSightUser(user)) throw new Error("WeSight 用户信息无效")
    const billing = await api<{ membership: { active: boolean }; checkoutUrl?: unknown; totalCreditsRemaining?: unknown }>("/api/billing/summary", { headers })
    if (typeof billing.membership?.active !== "boolean") throw new Error("WeSight 会员信息无效")
    const checkoutUrl = safeCheckoutUrl(billing.checkoutUrl)
    const summary = parseMembershipSummary(billing)
    const access: AccessRecord = {
      user, state: billing.membership.active ? "multi-platform" : "single-platform",
      maxTargets: billing.membership.active ? null : 1, checkedAt: new Date().toISOString(),
      ...(checkoutUrl ? { checkoutUrl } : {}),
      ...(summary ? { billing: summary } : {})
    }
    await setSession<CloudSession>(SESSION_KEYS.cloudSession, { accessToken: token, user, access, checkedAt: Date.now() })
    return { user, access }
  }
  try {
    try { return await read() } catch (error) {
      if (!(error instanceof AuthExpiredError)) throw error
      token = await refreshToken()
      return await read()
    }
  } catch (error) {
    if (error instanceof AuthExpiredError) {
      await removeLocal(STORAGE_KEYS.refreshToken)
      await removeSession(SESSION_KEYS.cloudSession)
      return null
    }
    throw error
  }
}

export async function verifyCloudIdentity(force = false): Promise<VerifiedIdentity | null> {
  identityPromise ??= fetchIdentity(force)
  try { return await identityPromise } finally { identityPromise = null }
}

export async function startWeSightLogin(): Promise<void> {
  const previous = await getSession<LoginTransaction>(SESSION_KEYS.loginTransaction)
  if (previous && previous.expiresAt > Date.now()) {
    try { await chrome.tabs.update(previous.tabId, { active: true }); return } catch { /* Closed login tab. */ }
  }
  await removeLocal(STORAGE_KEYS.signedOut)
  // The existing desktop OAuth route issues the same one-use exchange code as
  // Obsidian. Only this tab may return a code to this extension.
  const tab = await chrome.tabs.create({ url: "about:blank", active: true })
  if (tab.id === undefined) throw new Error("无法打开 WeSight 登录页面")
  // Catch only our login tab's completion navigation before the existing
  // desktop page can launch wesight://. Other WeSight logins are unaffected.
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [LOGIN_CALLBACK_RULE_ID],
    addRules: [{
      id: LOGIN_CALLBACK_RULE_ID, priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: { regexSubstitution: `${chrome.runtime.getURL(LOGIN_CALLBACK_PAGE)}?code=\\1` }
      },
      condition: {
        regexFilter: "^https://api\\.wesight\\.ai/oauth/desktop/complete\\?code=([A-Za-z0-9_-]+)(?:&.*)?$",
        tabIds: [tab.id], resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME]
      }
    }]
  })
  await setSession<LoginTransaction>(SESSION_KEYS.loginTransaction, { tabId: tab.id, expiresAt: Date.now() + LOGIN_TTL_MS })
  const old = await getLocal<WeSightAuthState>(STORAGE_KEYS.auth)
  await publishAuthState({ user: old?.user ?? null, source: old?.source ?? null, loginPending: true })
  await chrome.tabs.update(tab.id, { url: `${CLOUD_API}/login?source=electron` })
}

export async function completeWeSightLogin(tabId: number, rawUrl: string): Promise<boolean> {
  const url = new URL(rawUrl)
  const ownCallback = new URL(chrome.runtime.getURL(LOGIN_CALLBACK_PAGE))
  if (!(url.origin === CLOUD_API && url.pathname === "/oauth/desktop/complete")
    && !(url.protocol === ownCallback.protocol && url.origin === ownCallback.origin && url.hostname === ownCallback.hostname && url.pathname === ownCallback.pathname)) return false
  const transaction = await getSession<LoginTransaction>(SESSION_KEYS.loginTransaction)
  if (!transaction || transaction.tabId !== tabId || transaction.expiresAt <= Date.now()) return false
  const code = url.searchParams.get("code")
  if (!code) return false
  if (callbackPromise) return callbackPromise
  callbackPromise = (async () => {
    // Replace the desktop completion page before its custom-scheme launcher runs.
    await chrome.tabs.update(tabId, { url: chrome.runtime.getURL("tabs/publish.html"), active: true })
    await removeSession(SESSION_KEYS.loginTransaction)
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [LOGIN_CALLBACK_RULE_ID] })
    try {
      const result = await api<Tokens & { user: WeSightUser }>("/api/auth/exchange", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ authCode: code })
      })
      if (!result.accessToken || !result.refreshToken || !isWeSightUser(result.user)) throw new Error("WeSight 登录响应无效")
      await setLocal(STORAGE_KEYS.refreshToken, result.refreshToken)
      await setSession<CloudSession>(SESSION_KEYS.cloudSession, { accessToken: result.accessToken })
      const identity = await verifyCloudIdentity(true)
      if (!identity) throw new Error("WeSight 登录已失效，请重试")
      await setLocal(STORAGE_KEYS.access, identity.access)
      await publishAuthState({ user: identity.user, source: "cloud", loginPending: false })
      return true
    } catch (error) {
      await publishAuthState({ user: null, source: null, loginPending: false, error: error instanceof Error ? error.message : "登录失败" })
      return false
    }
  })()
  try { return await callbackPromise } finally { callbackPromise = null }
}

export async function signOutWeSight(): Promise<void> {
  const refreshToken = await getLocal<string>(STORAGE_KEYS.refreshToken)
  await removeLocal(STORAGE_KEYS.refreshToken)
  await removeSession(SESSION_KEYS.cloudSession)
  await removeSession(SESSION_KEYS.loginTransaction)
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [LOGIN_CALLBACK_RULE_ID] })
  await setLocal(STORAGE_KEYS.signedOut, true)
  await removeLocal(STORAGE_KEYS.access)
  await publishAuthState({ user: null, source: null, loginPending: false })
  if (refreshToken) {
    await api("/api/auth/logout", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken })
    }).catch(() => undefined)
  }
}
