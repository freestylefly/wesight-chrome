import type { AccountRecord } from "~lib/storage"
import type { ArticlePlatformId, PlatformId } from "~types/protocol"
import { readAccountPage } from "~lib/account-page"
import { findPlatformDefinition, type PlatformDefinition } from "~platforms/catalog"
import { platformsMissingPermission } from "~lib/optional-platforms"
import { accountPlatformIds } from "~platforms/config"
import { probeCode, recordDiagnostic, sanitizeUrl, type ProbeMethod, type ProbeTrace } from "~lib/diagnostics"

type JsonResponse = { status: number; body: unknown; url: string }
type Getter = (url: string) => Promise<JsonResponse>
type Probe = (get: Getter) => Promise<AccountRecord>

const PROBE_TIMEOUT_MS = 8_000
const SESSION_PROBE_INTERVAL_MS = 300
const SESSION_LOGIN_STABILITY_MS = 900

async function getJson(url: string): Promise<JsonResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(url, { credentials: "include", cache: "no-store", signal: controller.signal })
    const text = await response.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    return { status: response.status, body, url: response.url || url }
  } finally {
    clearTimeout(timer)
  }
}

/** getJson that also notes what each request returned, for the diagnostics self-check. */
function tracedGetter(trace: ProbeTrace): Getter {
  return async url => {
    const started = Date.now()
    try {
      const response = await getJson(url)
      trace.steps.push({
        url: sanitizeUrl(url),
        status: response.status,
        finalUrl: sanitizeUrl(response.url),
        kind: typeof response.body === "string" ? "html" : "json",
        ...(probeCode(response.body) ? { code: probeCode(response.body) } : {}),
        ms: Date.now() - started
      })
      return response
    } catch (error) {
      trace.steps.push({ url: sanitizeUrl(url), status: 0, finalUrl: "", kind: "error", ms: Date.now() - started })
      trace.note = error instanceof Error && error.name === "AbortError" ? "请求超时" : `请求失败：${error instanceof Error ? error.message : String(error)}`
      throw error
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function loggedIn(name?: string, avatar?: string): AccountRecord {
  return { state: "logged_in", ...(name ? { name } : {}), ...(avatar ? { avatar } : {}) }
}

const LOGIN_REQUIRED: AccountRecord = { state: "login_required" }

const PAGE_PATTERNS: Partial<Record<PlatformId, string[]>> = {
  csdn: ["https://www.csdn.net/*", "https://mp.csdn.net/*", "https://editor.csdn.net/*"],
  "weibo-article": ["https://weibo.com/*", "https://www.weibo.com/*"],
  "x-article": ["https://x.com/*", "https://twitter.com/*"],
  xiaohongshu: ["https://creator.xiaohongshu.com/*"],
  "jike-post": ["https://web.okjike.com/*"]
}

async function readAccountTab(platformId: PlatformId, tabId: number, timeoutMs = 2_000): Promise<{ account: AccountRecord; failed: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      chrome.scripting.executeScript({ target: { tabId }, func: readAccountPage, args: [platformId] }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Account probe timed out")), timeoutMs) })
    ])
    return { account: result[0]?.result ?? { state: "unknown" }, failed: false }
  } catch { return { account: { state: "unknown" }, failed: true } }
  finally { clearTimeout(timer) }
}

async function probeOpenPages(platformId: PlatformId): Promise<AccountRecord> {
  const patterns = PAGE_PATTERNS[platformId]
  if (!patterns) return { state: "unknown" }
  const tabs = await chrome.tabs.query({ url: patterns })
  const results = await Promise.all(tabs.filter(tab => tab.id !== undefined && !tab.discarded)
    .map(async tab => (await readAccountTab(platformId, tab.id!)).account))
  // A leftover login tab cannot override an account shown on another live tab.
  return results.find(result => result.state === "logged_in")
    ?? results.find(result => result.state === "login_required") ?? { state: "unknown" }
}

const SESSION_HOME = {
  "jike-post": "https://web.okjike.com/",
  xiaohongshu: "https://creator.xiaohongshu.com/new/home",
  "x-article": "https://x.com/home"
} as const

type SessionPagePlatform = keyof typeof SESSION_HOME

function isSessionPage(platformId: SessionPagePlatform, url: string | undefined): boolean {
  try {
    if (!url) return false
    const parsed = new URL(url)
    if (platformId === "x-article") return ["https://x.com", "https://twitter.com"].includes(parsed.origin)
    return parsed.origin === new URL(SESSION_HOME[platformId]).origin
  } catch { return false }
}

/** Read a normal browser session, including when its last platform tab was closed. */
async function probeSessionPages(platformId: SessionPagePlatform): Promise<AccountRecord> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS
  const tabs = (await chrome.tabs.query({ url: PAGE_PATTERNS[platformId] }))
    .filter(tab => tab.id !== undefined && !tab.discarded)
  const owned = tabs.length === 0 ? await chrome.tabs.create({ url: SESSION_HOME[platformId], active: false }) : undefined
  let ownedWasActivated = false
  const targets = (owned ? [owned] : tabs).filter(tab => tab.id !== undefined)
    .map(tab => ({ tab, loginSince: undefined as number | undefined, failed: false }))
  let initial = true
  try {
    while (targets.some(target => !target.failed) && Date.now() < deadline) {
      const results = await Promise.all(targets.map(async target => {
        if (target.failed) return { state: "unknown" } as AccountRecord
        if (!initial || owned || platformId === "x-article") {
          try {
            target.tab = await chrome.tabs.get(target.tab.id!)
            if (owned && target.tab.active) ownedWasActivated = true
            const awaitingInitialNavigation = owned && target.tab.status === "loading"
              && (!target.tab.url || target.tab.url === "about:blank")
              && (!target.tab.pendingUrl || isSessionPage(platformId, target.tab.pendingUrl))
            if (awaitingInitialNavigation) return { state: "unknown" } as AccountRecord
            if (target.tab.discarded || !isSessionPage(platformId, target.tab.url) || (target.tab.pendingUrl && !isSessionPage(platformId, target.tab.pendingUrl))) {
              target.failed = true
              return { state: "unknown" } as AccountRecord
            }
          } catch {
            target.failed = true
            return { state: "unknown" } as AccountRecord
          }
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) return { state: "unknown" } as AccountRecord
        const { account, failed } = await readAccountTab(platformId, target.tab.id!, Math.min(2_000, remaining))
        target.failed = failed
        if (account.state !== "login_required") {
          target.loginSince = undefined
          return account
        }
        target.loginSince ??= Date.now()
        // A new page may briefly show a login shell before session hydration.
        // Wait for navigation to settle, and keep actual loading failures unknown.
        const settled = target.tab.status !== "loading"
          && ((!owned && initial) || Date.now() - target.loginSince >= SESSION_LOGIN_STABILITY_MS)
        return settled ? account : { state: "unknown" } as AccountRecord
      }))
      const loggedIn = results.find(result => result.state === "logged_in")
      if (loggedIn) return loggedIn
      const loggedOut = results.find(result => result.state === "login_required")
      if (loggedOut) return loggedOut
      initial = false
      const remaining = deadline - Date.now()
      if (remaining <= 0 || targets.every(target => target.failed)) break
      await new Promise(resolve => setTimeout(resolve, Math.min(SESSION_PROBE_INTERVAL_MS, remaining)))
    }
    return { state: "unknown" }
  } finally {
    if (owned?.id !== undefined && !ownedWasActivated) {
      try {
        const current = await chrome.tabs.get(owned.id)
        // Never close a page the user has started using or navigated elsewhere.
        if (!current.active && isSessionPage(platformId, current.url) && (!current.pendingUrl || isSessionPage(platformId, current.pendingUrl))) await chrome.tabs.remove(owned.id)
      } catch { /* The user may already have closed the temporary page. */ }
    }
  }
}

/** Read the current JSON bootstrap as data, without executing page scripts. */
export function parseWeiboAccount(html: string): AccountRecord {
  const assignment = /(?:window\.)?\$CONFIG\s*=\s*\{/.exec(html)
  if (assignment) {
    const start = assignment.index + assignment[0].length - 1
    let depth = 0, quoted = false, escaped = false
    for (let index = start; index < html.length; index++) {
      const char = html[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === "{") depth++
      else if (char === "}" && --depth === 0) {
        try {
          const user = record(record(JSON.parse(html.slice(start, index + 1))).user)
          if (/^[1-9]\d+$/.test(String(user.idstr ?? user.id ?? ""))) return loggedIn(text(user.screen_name), text(user.avatar_large) ?? text(user.profile_image_url))
        } catch { /* Try the legacy article bootstrap below. */ }
        break
      }
    }
  }
  const uid = /\$CONFIG\[['"]uid['"]\]\s*=\s*['"]?([1-9]\d+)/.exec(html)?.[1]
  const nick = /\$CONFIG\[['"]nick['"]\]\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1]
  const avatar = /\$CONFIG\[['"]avatar_large['"]\]\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1]
  return uid ? loggedIn(nick, avatar) : { state: "unknown" }
}

// Endpoints mirror the "current user" calls each creator site makes itself.
// Any unexpected shape falls back to "unknown" so a site change never blocks publishing.
/**
 * 51CTO has no JSON "current user" endpoint; the blog home page server-renders
 * the header account link and a `var isLogin = 0|1` flag.
 */
export function parse51ctoAccount(html: string): AccountRecord {
  const link = /class="user-base"[^>]*>([\s\S]{0,400}?)<\/a>/.exec(html)?.[1]
  const name = link ? text(/<span[^>]*>([^<]+)<\/span>/.exec(link)?.[1]) : undefined
  if (name) return loggedIn(name, text(/<img[^>]*\ssrc="([^"]+)"/.exec(link ?? "")?.[1]))
  return /\bvar\s+isLogin\s*=\s*0\s*;/.test(html) ? LOGIN_REQUIRED : { state: "unknown" }
}

/** 人人都是产品经理: the home page bootstraps `PURE = {..."user_id":"<uid>"...}` (0 when signed out). */
export function parseWoshipmUserId(html: string): string | null | undefined {
  const id = /"user_id"\s*:\s*"?(\d+)/.exec(html)?.[1]
  if (id === undefined) return undefined
  return id === "0" ? null : id
}

const PROBES: Partial<Record<PlatformId, Probe>> = {
  async "woshipm-article"(get) {
    const home = await get("https://www.woshipm.com/")
    const uid = typeof home.body === "string" ? parseWoshipmUserId(home.body) : undefined
    if (uid === null) return LOGIN_REQUIRED
    if (!uid) return { state: "unknown" }
    const { body } = await get(`https://www.woshipm.com/api2/user/profile?uid=${uid}`)
    const user = record(record(record(body).RESULT).userInfoVo)
    return text(user.nickName) ? loggedIn(text(user.nickName), text(user.avartar)) : { state: "unknown" }
  },
  async "weixin-article"(get) {
    const { body, url } = await get("https://mp.weixin.qq.com/")
    if (typeof body === "string" && /\/cgi-bin\/home/.test(url)) return parseWeixinAccount(body)
    // Signed out, the root serves the QR login page without redirecting.
    return new URL(url).pathname === "/" ? LOGIN_REQUIRED : { state: "unknown" }
  },
  async "51cto-article"(get) {
    const { body } = await get("https://blog.51cto.com/")
    return typeof body === "string" ? parse51ctoAccount(body) : { state: "unknown" }
  },
  async "x-article"() {
    return { state: "unknown" }
  },
  async zhihu(get) {
    const { status, body } = await get("https://www.zhihu.com/api/v4/me")
    if (status === 401 || status === 403) return LOGIN_REQUIRED
    const data = record(body)
    return text(data.name) ? loggedIn(text(data.name), text(data.avatar_url)) : { state: "unknown" }
  },
  async csdn(get) {
    const { status, body } = await get("https://g-api.csdn.net/community/toolbar-api/v1/get-user-info")
    const root = record(body)
    const data = record(root.data)
    if (root.code === 200 && (text(data.nickName) || text(data.userName))) {
      return loggedIn(text(data.nickName) ?? text(data.userName), text(data.avatar))
    }
    return status === 401 || root.code === 401 || root.code === 400101 ? LOGIN_REQUIRED : { state: "unknown" }
  },
  async juejin(get) {
    const { body } = await get("https://api.juejin.cn/user_api/v1/user/get")
    const root = record(body)
    const data = record(root.data)
    if (root.err_no === 0 && text(data.user_name)) return loggedIn(text(data.user_name), text(data.avatar_large))
    return root.err_no === 403 || root.err_no === 1 ? LOGIN_REQUIRED : { state: "unknown" }
  },
  async "bilibili-article"(get) {
    const { body } = await get("https://api.bilibili.com/x/web-interface/nav")
    const root = record(body)
    const data = record(root.data)
    if (data.isLogin === true) return loggedIn(text(data.uname), text(data.face))
    return root.code === -101 || data.isLogin === false ? LOGIN_REQUIRED : { state: "unknown" }
  },
  async toutiao(get) {
    const { body } = await get("https://mp.toutiao.com/mp/agw/media/get_media_info")
    const user = record(record(record(body).data).user)
    if (text(user.screen_name)) return loggedIn(text(user.screen_name), text(user.https_avatar_url))
    return { state: "unknown" }
  },
  async "weibo-article"(get) {
    const { status, body, url } = await get("https://weibo.com/")
    if (typeof body === "string") {
      const account = parseWeiboAccount(body)
      if (account.state === "logged_in") return account
    }
    // Login links/scripts also occur on signed-in pages; only an actual redirect
    // to the authentication site or HTTP 401 confirms a missing session.
    return status === 401 || ["passport.weibo.com", "login.sina.com.cn"].includes(new URL(url).hostname)
      ? LOGIN_REQUIRED : { state: "unknown" }
  }
}

function pathValue(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => record(current)[key], value)
}

/** Generic JSON probe declared in a platform's catalog entry. */
export async function catalogProbe(probe: NonNullable<PlatformDefinition["account"]>, get: Getter = getJson): Promise<AccountRecord> {
  const { status, body } = await get(probe.url)
  const name = probe.name ? text(pathValue(body, probe.name)) : undefined
  if (name) return loggedIn(name, probe.avatar ? text(pathValue(body, probe.avatar)) : undefined)
  const code = probe.loggedOut ? pathValue(body, probe.loggedOut.path) : undefined
  if (code !== undefined && probe.loggedOut?.values.some(value => String(value) === String(code))) return LOGIN_REQUIRED
  return status === 401 || status === 403 ? LOGIN_REQUIRED : { state: "unknown" }
}

const LOGIN_URL_PATTERN = /\/\/(?:passport|upass|accounts?|sso)\.|\/(?:login|signin|sign_in|sign-in|userAuth)(?:[./?#]|$)|\/uas\/login|\/m\/signin|\/login\.html/i

/** Signed-out check: did the site redirect a member-only page to its login page? */
export async function loginRedirectProbe(url: string, get: Getter = getJson): Promise<AccountRecord> {
  const { url: finalUrl } = await get(url)
  return finalUrl !== url && LOGIN_URL_PATTERN.test(finalUrl) ? LOGIN_REQUIRED : { state: "unknown" }
}

/** 微信公众号: the signed-in home page bootstraps `nick_name` and `head_img`; signed out it stays on the login page. */
export function parseWeixinAccount(html: string): AccountRecord {
  const name = text(/\bnick_name\s*:\s*["']([^"']+)["']/.exec(html)?.[1])
  if (name) return loggedIn(name, text(/\bhead_img\s*:\s*["']([^"']+)["']/.exec(html)?.[1]))
  return { state: "unknown" }
}

export interface AccountProbeResult {
  account: AccountRecord
  trace: ProbeTrace
}

const pending = new Map<PlatformId, Promise<AccountProbeResult>>()
const SESSION_PAGE_PLATFORMS: readonly PlatformId[] = ["jike-post", "xiaohongshu", "x-article"]

async function probe(platformId: PlatformId): Promise<AccountProbeResult> {
  const trace: ProbeTrace = { method: "none", steps: [] }
  const done = (account: AccountRecord): AccountProbeResult => ({ account: { ...account, checkedAt: new Date().toISOString() }, trace })
  try {
    // Without site access the extension can neither read the site's cookies nor its open tabs.
    if ((await platformsMissingPermission([platformId])).length) {
      trace.method = "permission"
      return done({ state: "permission_missing" })
    }
    const sessionPage = SESSION_PAGE_PLATFORMS.includes(platformId)
    const page = await (sessionPage ? probeSessionPages(platformId as SessionPagePlatform) : probeOpenPages(platformId))
      .catch(error => {
        trace.note = `读取平台页失败：${error instanceof Error ? error.message : String(error)}`
        return { state: "unknown" } as AccountRecord
      })
    if (page.state !== "unknown") {
      trace.method = sessionPage ? "session-tab" : "open-tab"
      return done(page)
    }
    const definition = findPlatformDefinition(platformId)
    const declared = definition?.account
    const loginCheck = definition?.loginCheckUrl
    const get = tracedGetter(trace)
    const custom = PROBES[platformId]
    let method: ProbeMethod = sessionPage || PAGE_PATTERNS[platformId] ? (sessionPage ? "session-tab" : "open-tab") : "none"
    let fallback: (() => Promise<AccountRecord>) | undefined
    if (custom) fallback = () => custom(get)
    else if (declared) { method = "api"; fallback = () => catalogProbe(declared, get) }
    else if (loginCheck) { method = "login-redirect"; fallback = () => loginRedirectProbe(loginCheck, get) }
    const account = fallback ? await fallback() : { state: "unknown" as const }
    // Site-specific probes read either a JSON endpoint or the server-rendered home page.
    if (custom && trace.steps.length) method = trace.steps.some(step => step.kind === "json") ? "api" : "homepage-html"
    trace.method = method
    if (!fallback && method === "none") trace.note = "该平台没有登录检测器"
    else if (account.state === "unknown" && !trace.note) trace.note = "检测结果不明确（返回内容里没有可识别的登录信息）"
    return done(account)
  } catch (error) {
    trace.note ??= `检测异常：${error instanceof Error ? error.message : String(error)}`
    return done({ state: "unknown" })
  }
}

function hasOwnProbe(platformId: PlatformId): boolean {
  const definition = findPlatformDefinition(platformId)
  return Boolean(PROBES[platformId] || PAGE_PATTERNS[platformId] || definition?.account || definition?.loginCheckUrl)
}

/** A platform that shares its account with another (e.g. 头条动态 and 头条号) reuses that platform's probe. */
function probeSource(platformId: PlatformId): PlatformId {
  if (platformId === "weibo-post") return "weibo-article"
  if (platformId === "x-post") return "x-article"
  if (hasOwnProbe(platformId)) return platformId
  return accountPlatformIds(platformId).find(id => id !== platformId && hasOwnProbe(id)) ?? platformId
}

// The login monitor polls every few seconds; only a changed outcome is worth a diagnostic line.
const lastLogged = new Map<PlatformId, string>()

function logProbe(platformId: PlatformId, result: AccountProbeResult): void {
  const { account, trace } = result
  const step = trace.steps.at(-1)
  const signature = `${account.state}|${trace.method}|${step?.status ?? ""}|${step?.finalUrl ?? ""}|${step?.code ?? ""}`
  if (lastLogged.get(platformId) === signature) return
  lastLogged.set(platformId, signature)
  void recordDiagnostic(account.state === "unknown" ? "warn" : "info", "login", platformId, `登录检测：${account.state}`, {
    method: trace.method,
    source: trace.source,
    steps: trace.steps.map(item => `${item.kind} ${item.status} ${item.url} → ${item.finalUrl}${item.code ? ` ${item.code}` : ""} (${item.ms}ms)`),
    nameRead: Boolean(account.name),
    note: trace.note
  })
}

/** Account state plus how it was decided; used by the diagnostics self-check. */
export async function probeAccountDetailed(platformId: PlatformId): Promise<AccountProbeResult> {
  const source = probeSource(platformId)
  if (source !== platformId) {
    const shared = await probeAccountDetailed(source)
    return { account: shared.account, trace: { ...shared.trace, method: "shared-account", source, note: shared.trace.note ?? `沿用${source}（检测方式：${shared.trace.method}）` } }
  }
  const active = pending.get(platformId)
  if (active) return active
  const result = probe(platformId).then(value => { logProbe(platformId, value); return value })
    .finally(() => pending.delete(platformId))
  pending.set(platformId, result)
  return result
}

const accountPending = new Map<PlatformId, Promise<AccountRecord>>()

/** Concurrent callers (and platforms sharing one account) get the same promise. */
export function probeAccount(platformId: PlatformId): Promise<AccountRecord> {
  const source = probeSource(platformId)
  const active = accountPending.get(source)
  if (active) return active
  const result = probeAccountDetailed(source).then(value => value.account).finally(() => accountPending.delete(source))
  accountPending.set(source, result)
  return result
}
