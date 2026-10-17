import { SESSION_KEYS, STORAGE_KEYS } from "~lib/storage"

const user = { userId: "user-1", nickname: "测试用户", avatarUrl: "https://example.com/avatar.png" }
const local = new Map<string, unknown>()
const session = new Map<string, unknown>()
const storage = (map: Map<string, unknown>) => ({
  get: vi.fn(async (key: string) => ({ [key]: map.get(key) })),
  set: vi.fn(async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) map.set(key, value) }),
  remove: vi.fn(async (key: string) => { map.delete(key) })
})

const envelope = (data: unknown, status = 200) => new Response(JSON.stringify({ code: status === 200 ? 0 : 1, data }), { status })

beforeEach(() => {
  vi.resetModules()
  local.clear(); session.clear()
  vi.stubGlobal("chrome", {
    storage: { local: storage(local), session: storage(session) },
    declarativeNetRequest: { updateSessionRules: vi.fn(async () => {}), RuleActionType: { REDIRECT: "redirect" }, ResourceType: { MAIN_FRAME: "main_frame" } },
    tabs: { create: vi.fn(async () => ({ id: 42 })), update: vi.fn(async () => ({ id: 42 })) },
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` }
  })
})
afterEach(() => vi.unstubAllGlobals())

describe("same WeSight authentication system", () => {
  test("does not accept a cached display profile without a credential", async () => {
    local.set(STORAGE_KEYS.auth, { user, source: "cloud", loginPending: false })
    const { verifyCloudIdentity } = await import("~lib/cloud-auth")
    expect(await verifyCloudIdentity(true)).toBeNull()
  })

  test("restores and rotates tokens using the same cloud endpoints as Obsidian", async () => {
    local.set(STORAGE_KEYS.refreshToken, "old-refresh")
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push(url)
      if (url.endsWith("/api/auth/refresh")) {
        expect(JSON.parse(String(init.body))).toEqual({ refreshToken: "old-refresh" })
        return envelope({ accessToken: "new-access", refreshToken: "new-refresh" })
      }
      expect(init.headers).toEqual({ Authorization: "Bearer new-access" })
      if (url.endsWith("/api/user/profile")) return envelope(user)
      return envelope({ membership: { active: true } })
    }))
    const { verifyCloudIdentity } = await import("~lib/cloud-auth")
    const [first, second] = await Promise.all([verifyCloudIdentity(true), verifyCloudIdentity(true)])
    expect(first).toEqual(second)
    expect(first?.user).toEqual(user)
    expect(first?.access.maxTargets).toBeNull()
    expect(local.get(STORAGE_KEYS.refreshToken)).toBe("new-refresh")
    expect(calls).toEqual([
      "https://api.wesight.ai/api/auth/refresh", "https://api.wesight.ai/api/user/profile", "https://api.wesight.ai/api/billing/summary"
    ])
  })

  test("clears expired credentials instead of authorizing sync with stale membership", async () => {
    local.set(STORAGE_KEYS.refreshToken, "expired")
    vi.stubGlobal("fetch", vi.fn(async () => envelope(null, 401)))
    const { verifyCloudIdentity } = await import("~lib/cloud-auth")
    expect(await verifyCloudIdentity(true)).toBeNull()
    expect(local.has(STORAGE_KEYS.refreshToken)).toBe(false)
  })

  test("binds the one-use OAuth code to the extension's own login tab", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/api/auth/exchange")) {
        expect(JSON.parse(String(init.body))).toEqual({ authCode: "one-use-code" })
        return envelope({ accessToken: "access", refreshToken: "refresh", user })
      }
      if (url.endsWith("/api/user/profile")) return envelope(user)
      return envelope({ membership: { active: false } })
    }))
    const { startWeSightLogin, completeWeSightLogin } = await import("~lib/cloud-auth")
    await startWeSightLogin()
    expect(chrome.tabs.update).toHaveBeenCalledWith(42, { url: "https://api.wesight.ai/login?source=electron" })
    expect(chrome.declarativeNetRequest.updateSessionRules).toHaveBeenCalledWith(expect.objectContaining({ addRules: [expect.objectContaining({ condition: expect.objectContaining({ tabIds: [42] }) })] }))
    const callback = "chrome-extension://test/tabs/auth-callback.html?code=one-use-code"
    expect(await completeWeSightLogin(43, callback)).toBe(false)
    expect(await completeWeSightLogin(42, "https://example.com/oauth/desktop/complete?code=one-use-code")).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(await completeWeSightLogin(42, callback)).toBe(true)
    expect(local.get(STORAGE_KEYS.auth)).toMatchObject({ user, source: "cloud", loginPending: false })
    expect(local.get(STORAGE_KEYS.access)).toMatchObject({ maxTargets: 1 })
    expect(await completeWeSightLogin(42, callback)).toBe(false)
  })

  test("signs out without clearing platform preferences or the article", async () => {
    local.set(STORAGE_KEYS.refreshToken, "refresh")
    local.set(STORAGE_KEYS.publishPreferences, { selected: ["x-article", "juejin"], keepImages: true })
    session.set(SESSION_KEYS.cloudSession, { accessToken: "access", user })
    vi.stubGlobal("fetch", vi.fn(async () => envelope({ loggedOut: true })))
    const { signOutWeSight } = await import("~lib/cloud-auth")
    await signOutWeSight()
    expect(local.has(STORAGE_KEYS.refreshToken)).toBe(false)
    expect(session.has(SESSION_KEYS.cloudSession)).toBe(false)
    expect(local.get(STORAGE_KEYS.signedOut)).toBe(true)
    expect(local.get(STORAGE_KEYS.auth)).toMatchObject({ user: null })
    expect(local.get(STORAGE_KEYS.publishPreferences)).toEqual({ selected: ["x-article", "juejin"], keepImages: true })
  })
})
