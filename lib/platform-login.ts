import { probeAccount } from "~lib/accounts"
import { getSession, setSession, SESSION_KEYS, type AccountRecord } from "~lib/storage"
import { accountPlatformIds, PLATFORM_CONFIG, platformFromUrl } from "~platforms/config"
import { PLATFORM_IDS, type PlatformId } from "~types/protocol"

interface LoginWatch { platformId: PlatformId; tabId: number; expiresAt: number }

const WATCH_TTL_MS = 10 * 60_000
const POLL_MS = 2_000

/** Watches only explicit platform-login requests; never submits or edits content. */
export class PlatformLoginMonitor {
  private watches = new Map<PlatformId, LoginWatch>()
  private opening = new Map<PlatformId, Promise<number>>()
  private checking = new Map<PlatformId, Promise<void>>()
  private loading: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  private saving: Promise<void> = Promise.resolve()

  constructor(private onAccount: (platformId: PlatformId, account: AccountRecord) => Promise<void>) {}

  private restore(): Promise<void> {
    this.loading ??= (async () => {
      const stored = await getSession<LoginWatch[]>(SESSION_KEYS.platformLogins)
      if (Array.isArray(stored)) for (const watch of stored) {
        if (watch && PLATFORM_IDS.includes(watch.platformId) && Number.isSafeInteger(watch.tabId)
          && watch.tabId >= 0 && Number.isFinite(watch.expiresAt) && watch.expiresAt > Date.now()) {
          this.watches.set(watch.platformId, watch)
        }
      }
      this.schedule()
    })().catch(error => { this.loading = null; throw error })
    return this.loading
  }

  private persist(): Promise<void> {
    const snapshot = [...this.watches.values()]
    const saved = this.saving.then(() => setSession(SESSION_KEYS.platformLogins, snapshot))
    this.saving = saved.catch(() => undefined)
    this.schedule()
    return saved
  }

  private schedule(): void {
    if (this.watches.size && !this.timer) {
      this.timer = setInterval(() => { void this.poll().catch(() => undefined) }, POLL_MS)
    } else if (!this.watches.size && this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  async resume(): Promise<void> {
    await this.restore()
    await this.poll()
  }

  open(platformId: PlatformId, windowId?: number): Promise<number> {
    if (!PLATFORM_IDS.includes(platformId)) return Promise.reject(new Error("不支持的平台"))
    const pending = this.opening.get(platformId)
    if (pending) return pending
    const opened = this.openTab(platformId, windowId).finally(() => this.opening.delete(platformId))
    this.opening.set(platformId, opened)
    return opened
  }

  private async openTab(platformId: PlatformId, windowId?: number): Promise<number> {
    await this.restore()
    const tabs = await chrome.tabs.query({})
    const watched = this.watches.get(platformId)
    const existing = (watched ? tabs.find(tab => tab.id === watched.tabId) : undefined)
      ?? tabs.find(tab => {
        if (tab.id === undefined || tab.discarded || !tab.url) return false
        try {
          const found = platformFromUrl(tab.url)
          return found !== null && accountPlatformIds(platformId).includes(found)
        } catch { return false }
      })
    let tab = existing
    if (tab?.id !== undefined) {
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
      await chrome.tabs.update(tab.id, { active: true })
    } else {
      tab = await chrome.tabs.create({ url: PLATFORM_CONFIG[platformId].editorUrl, active: true,
        ...(windowId === undefined ? {} : { windowId }) })
    }
    if (tab.id === undefined) throw new Error("无法打开平台登录页，请重试")
    this.watches.set(platformId, { platformId, tabId: tab.id, expiresAt: Date.now() + WATCH_TTL_MS })
    await this.persist()
    void this.check(platformId).catch(() => undefined)
    return tab.id
  }

  private check(platformId: PlatformId): Promise<void> {
    const pending = this.checking.get(platformId)
    if (pending) return pending
    const result = this.checkAccount(platformId).finally(() => this.checking.delete(platformId))
    this.checking.set(platformId, result)
    return result
  }

  private async checkAccount(platformId: PlatformId): Promise<void> {
    const watch = this.watches.get(platformId)
    if (!watch) return
    const tab = await chrome.tabs.get(watch.tabId).catch(() => null)
    if (!tab || watch.expiresAt <= Date.now()) {
      if (this.watches.get(platformId) === watch) { this.watches.delete(platformId); await this.persist() }
      return
    }
    const account = await probeAccount(platformId)
    if (this.watches.get(platformId) !== watch || watch.expiresAt <= Date.now()) return
    if (account.state !== "unknown") await this.onAccount(platformId, account)
    if (account.state === "logged_in" && this.watches.get(platformId) === watch) {
      this.watches.delete(platformId)
      await this.persist()
    }
  }

  async poll(): Promise<void> {
    await this.restore()
    await Promise.allSettled([...this.watches.keys()].map(platformId => this.check(platformId)))
  }

  async tabChanged(tabId: number): Promise<void> {
    await this.restore()
    await Promise.allSettled([...this.watches.values()].filter(watch => watch.tabId === tabId)
      .map(watch => this.check(watch.platformId)))
  }

  async tabClosed(tabId: number): Promise<void> {
    await this.restore()
    let changed = false
    for (const [platformId, watch] of this.watches) if (watch.tabId === tabId) {
      this.watches.delete(platformId)
      changed = true
    }
    if (changed) await this.persist()
  }
}
