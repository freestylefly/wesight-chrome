import { PlatformLoginMonitor } from "~lib/platform-login"
import type { AccountRecord } from "~lib/storage"

const mocks = vi.hoisted(() => ({
  probeAccount: vi.fn(),
  getSession: vi.fn(),
  setSession: vi.fn()
}))

vi.mock("~lib/accounts", () => ({ probeAccount: mocks.probeAccount }))
vi.mock("~lib/storage", () => ({
  getSession: mocks.getSession,
  setSession: mocks.setSession,
  SESSION_KEYS: { platformLogins: "platform-login-watches" }
}))

const query = vi.fn()
const create = vi.fn()
const update = vi.fn()
const get = vi.fn()
const focusWindow = vi.fn()
let persisted: unknown[]
let tabs: Map<number, chrome.tabs.Tab>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-15T03:00:00Z"))
  persisted = []
  tabs = new Map()
  vi.resetAllMocks()
  mocks.getSession.mockImplementation(async () => structuredClone(persisted))
  mocks.setSession.mockImplementation(async (_key, value) => { persisted = structuredClone(value) })
  mocks.probeAccount.mockResolvedValue({ state: "unknown" })
  query.mockImplementation(async () => [...tabs.values()])
  create.mockImplementation(async options => {
    const tab = { id: 40 + tabs.size, windowId: 2, ...options } as chrome.tabs.Tab
    tabs.set(tab.id!, tab)
    return tab
  })
  get.mockImplementation(async id => {
    if (!tabs.has(id)) throw new Error("No tab")
    return tabs.get(id)
  })
  update.mockImplementation(async id => tabs.get(id))
  focusWindow.mockResolvedValue({})
  vi.stubGlobal("chrome", { tabs: { query, create, update, get }, windows: { update: focusWindow } })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("platform login monitor", () => {
  test("keeps polling through unknown and logged-out states until an SPA reports its account", async () => {
    const onAccount = vi.fn(async () => undefined)
    mocks.probeAccount.mockResolvedValueOnce({ state: "unknown" })
      .mockResolvedValueOnce({ state: "login_required" })
      .mockResolvedValueOnce({ state: "logged_in", name: "创作者" })
    const monitor = new PlatformLoginMonitor(onAccount)

    await monitor.open("xiaohongshu")
    await vi.advanceTimersByTimeAsync(0)
    expect(onAccount).not.toHaveBeenCalled()
    expect(persisted).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(onAccount).toHaveBeenCalledWith("xiaohongshu", { state: "login_required" })
    expect(persisted).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(onAccount).toHaveBeenLastCalledWith("xiaohongshu", { state: "logged_in", name: "创作者" })
    expect(persisted).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(mocks.probeAccount).toHaveBeenCalledTimes(3)
  })

  test("deduplicates concurrent opens and creates a single login tab in the caller window", async () => {
    const queried = deferred<chrome.tabs.Tab[]>()
    query.mockReturnValue(queried.promise)
    const monitor = new PlatformLoginMonitor(vi.fn(async () => undefined))
    const first = monitor.open("xiaohongshu", 7)
    const second = monitor.open("xiaohongshu", 7)
    expect(first).toBe(second)
    queried.resolve([])
    expect(await first).toBe(await second)
    await monitor.poll()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ active: true, windowId: 7, url: expect.stringContaining("creator.xiaohongshu.com") }))
  })

  test("focuses an existing platform tab without navigating away from an unfinished page", async () => {
    tabs.set(9, { id: 9, windowId: 3, url: "https://creator.xiaohongshu.com/publish/publish?draft=unfinished" } as chrome.tabs.Tab)
    const monitor = new PlatformLoginMonitor(vi.fn(async () => undefined))
    expect(await monitor.open("xiaohongshu")).toBe(9)
    await monitor.poll()
    expect(create).not.toHaveBeenCalled()
    expect(focusWindow).toHaveBeenCalledWith(3, { focused: true })
    expect(update).toHaveBeenCalledWith(9, { active: true })
    expect(update.mock.calls.every(([, options]) => !("url" in options))).toBe(true)
  })

  test.each([
    ["x-post", "https://x.com/compose/articles/edit/unfinished"],
    ["x-article", "https://twitter.com/compose/post"]
  ] as const)("reuses the signed-in X session for %s without replacing an unfinished sibling editor", async (platformId, url) => {
    tabs.set(9, { id: 9, windowId: 3, url } as chrome.tabs.Tab)
    mocks.probeAccount.mockResolvedValue({ state: "logged_in", name: "same_account" })
    const onAccount = vi.fn(async () => undefined)
    const monitor = new PlatformLoginMonitor(onAccount)
    expect(await monitor.open(platformId)).toBe(9)
    await monitor.poll()
    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(9, { active: true })
    expect(update.mock.calls.every(([, options]) => !("url" in options))).toBe(true)
    expect(onAccount).toHaveBeenCalledWith(platformId, { state: "logged_in", name: "same_account" })
  })

  test("resumes a persisted login watch after the background instance restarts", async () => {
    const first = new PlatformLoginMonitor(vi.fn(async () => undefined))
    await first.open("jike-post")
    await vi.advanceTimersByTimeAsync(0)
    expect(persisted).toHaveLength(1)
    vi.clearAllTimers()
    vi.setSystemTime(new Date("2026-10-15T03:00:00Z"))

    const onAccount = vi.fn(async () => undefined)
    mocks.probeAccount.mockResolvedValue({ state: "logged_in", name: "即刻用户" })
    const resumed = new PlatformLoginMonitor(onAccount)
    await resumed.resume()
    expect(mocks.getSession).toHaveBeenCalledTimes(2)
    expect(onAccount).toHaveBeenCalledWith("jike-post", { state: "logged_in", name: "即刻用户" })
    expect(create).toHaveBeenCalledTimes(1)
    expect(persisted).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  test("stops watching a closed tab and ignores an account result already in flight", async () => {
    const account = deferred<AccountRecord>()
    mocks.probeAccount.mockReturnValue(account.promise)
    const onAccount = vi.fn(async () => undefined)
    const monitor = new PlatformLoginMonitor(onAccount)
    const tabId = await monitor.open("xiaohongshu")
    const pending = monitor.poll()
    tabs.delete(tabId)
    await monitor.tabClosed(tabId)
    expect(persisted).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    account.resolve({ state: "logged_in", name: "迟到的结果" })
    await pending
    expect(onAccount).not.toHaveBeenCalled()
  })

  test("clears a watch if its tab disappeared without a close notification", async () => {
    const monitor = new PlatformLoginMonitor(vi.fn(async () => undefined))
    const tabId = await monitor.open("weibo-post")
    await vi.advanceTimersByTimeAsync(0)
    tabs.delete(tabId)
    await monitor.poll()
    expect(persisted).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.probeAccount).toHaveBeenCalledTimes(1)
  })

  test("expires a login watch after ten minutes without another account probe", async () => {
    const monitor = new PlatformLoginMonitor(vi.fn(async () => undefined))
    await monitor.open("weibo-post")
    await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(Date.now() + 10 * 60_000)
    await monitor.poll()
    expect(persisted).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.probeAccount).toHaveBeenCalledTimes(1)
  })

  test("does not overlap a slow probe when polling and tab events arrive together", async () => {
    const account = deferred<AccountRecord>()
    mocks.probeAccount.mockReturnValueOnce(account.promise)
    const monitor = new PlatformLoginMonitor(vi.fn(async () => undefined))
    const tabId = await monitor.open("xiaohongshu")
    const polled = monitor.poll()
    const changed = monitor.tabChanged(tabId)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(mocks.probeAccount).toHaveBeenCalledTimes(1)
    account.resolve({ state: "unknown" })
    await Promise.all([polled, changed])
    await monitor.poll()
    expect(mocks.probeAccount).toHaveBeenCalledTimes(2)
  })

  test("continues on the next poll after an account probe throws", async () => {
    mocks.probeAccount.mockRejectedValueOnce(new Error("Temporary network failure"))
      .mockResolvedValueOnce({ state: "logged_in", name: "恢复后的账号" })
    const onAccount = vi.fn(async () => undefined)
    const monitor = new PlatformLoginMonitor(onAccount)
    await monitor.open("jike-post")
    await vi.advanceTimersByTimeAsync(0)
    expect(onAccount).not.toHaveBeenCalled()
    expect(persisted).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(onAccount).toHaveBeenCalledWith("jike-post", { state: "logged_in", name: "恢复后的账号" })
    expect(persisted).toEqual([])
  })
})
