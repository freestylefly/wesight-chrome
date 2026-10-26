import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  CircleUserRound,
  Gem,
  LayoutDashboard,
  WalletCards,
  Crown,
  ExternalLink,
  FileText,
  ImagePlus,
  Info,
  Link2,
  LogIn,
  LogOut,
  UserRound,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Trash2,
  Upload,
  X
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react"

import logo from "data-base64:~assets/icon.png"
import DynamicComposer from "~components/dynamic-composer"

import "./publish.css"
import "./canghe-green.css"

import { normalizeDraft, xImageWarning, xUnsupportedImageWarning } from "~lib/article-preparation"
import { membershipCheckoutUrl } from "~lib/cloud-auth"
import { cangheGreenPreview } from "~lib/preview-theme"

import { getCurrentDraft, getStoredAsset, pruneAssets, saveCurrentDraft, type ComposeDraft } from "~lib/draft-store"
import { importArticleUrl, importCoverImage, importMarkdownFiles, type ImportedArticle } from "~lib/importers"
import { articleStats, markdownToHtml, referencedAssetIds } from "~lib/markdown"
import {
  STORAGE_KEYS,
  type AccessRecord,
  type AccountRecord,
  type AccountStateMap,
  type PublishPreferences,
  type TaskSummary
} from "~lib/storage"
import type { WeSightAuthState, WeSightUser } from "~types/auth"
import { PLATFORM_CONFIG } from "~platforms/config"
import type { ExtensionRequest, ExtensionResponse, PublishCenterState } from "~types/messages"
import { ARTICLE_PLATFORM_IDS, type ArticlePlatformId, type PlatformId, type PlatformTaskState } from "~types/protocol"

const PLATFORM_BRAND: Record<ArticlePlatformId, { glyph: string; color: string }> = {
  zhihu: { glyph: "知", color: "#1772f6" },
  csdn: { glyph: "C", color: "#fc5531" },
  juejin: { glyph: "掘", color: "#1e80ff" },
  "bilibili-article": { glyph: "B", color: "#00aeec" },
  toutiao: { glyph: "头条", color: "#f04142" },
  "weibo-article": { glyph: "微", color: "#e6162d" },
  "x-article": { glyph: "X", color: "#0f1419" }
}

const STATUS_LABEL: Record<PlatformTaskState["status"], string> = {
  queued: "等待中",
  opening: "打开中",
  login_required: "需要登录",
  filling: "填充中",
  ready: "待发布",
  failed: "失败",
  cancelled: "已取消"
}

const URL_PERMISSION: chrome.permissions.Permissions = { origins: ["https://*/*", "http://*/*"] }

async function request<T>(message: ExtensionRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse<T>>(message)
  if (!response?.ok) throw new Error(response?.error ?? "扩展后台响应失败")
  return response.value as T
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function replaceTokens(html: string, urls: ReadonlyMap<string, string>): string {
  return html.replace(/wesight-asset:\/\/([A-Za-z0-9_-]+)/g, (full, id: string) => urls.get(id) ?? full)
}

const ACCOUNT_URL = "https://pay.wesight.ai/account"
const ADMIN_URL = "https://pay.wesight.ai/admin"
const TUTORIAL_URL = "https://my.feishu.cn/docx/Vy7wdUzhkoZpPhxgix4cYHELnie?from=from_copylink"

function openWeSightPage(rawUrl: string): void {
  const url = new URL(rawUrl)
  if (url.hostname.endsWith("wesight.ai")) url.searchParams.set("source", "chrome-extension")
  void chrome.tabs.create({ url: url.toString(), active: true })
}

function formatDate(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}

function Avatar({ user, className }: { user: WeSightUser; className: string }) {
  const [failed, setFailed] = useState(false)
  return user.avatarUrl && !failed
    ? <img className={`${className} user-avatar`} src={user.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className={`${className} user-avatar fallback`}><UserRound /></span>
}

function AccountMenu({ user, source, access, onCheckout, onLogout }: {
  user: WeSightUser
  source: WeSightAuthState["source"]
  access: AccessRecord | null
  onCheckout: () => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const member = access?.billing?.active ?? access?.state === "multi-platform"
  const billing = access?.billing
  const plan = member ? (billing?.planName || "创作者会员") : "免费用户"
  const expiry = member ? formatDate(billing?.expiresAt ?? null) : ""
  const run = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return <div className="account" ref={root}>
    <button
      className={`account-button ${open ? "is-open" : ""}`}
      aria-label={`${user.nickname}，打开账户菜单`}
      aria-haspopup="menu"
      aria-expanded={open}
      title={user.nickname}
      onClick={() => setOpen(value => !value)}
    >
      <Avatar user={user} className="account-avatar" />
      {member ? <span className="account-crown" aria-hidden="true"><Crown /></span> : null}
    </button>
    {open ? <div className="account-menu" role="menu">
      <div className="account-profile">
        <Avatar user={user} className="account-menu-avatar" />
        <div>
          <strong>{user.nickname}</strong>
          <small>{source === "obsidian" ? "与 Obsidian 共用登录" : "WeSight 账号"}</small>
        </div>
      </div>
      <div className={`account-plan ${member ? "is-member" : ""}`}>
        <Gem />
        <span>{plan}{billing ? ` · ${billing.credits} 积分` : ""}</span>
        {expiry ? <small>有效至 {expiry}</small> : null}
        {!member ? <small>每次同步 1 个平台</small> : <small>不限同步平台</small>}
      </div>
      {!member ? <button className="account-upgrade" role="menuitem" onClick={run(onCheckout)}><Crown />开通会员 · 不限平台</button> : null}
      <hr />
      <button role="menuitem" onClick={run(() => openWeSightPage(ACCOUNT_URL))}><CircleUserRound />账户详情</button>
      {user.isAdmin ? <button role="menuitem" onClick={run(() => openWeSightPage(ADMIN_URL))}><LayoutDashboard />管理后台</button> : null}
      <button role="menuitem" onClick={run(onCheckout)}><WalletCards />会员与积分</button>
      <button role="menuitem" onClick={run(() => openWeSightPage(TUTORIAL_URL))}><BookOpen />使用教程</button>
      <hr />
      <button role="menuitem" className="is-danger" onClick={run(onLogout)}><LogOut />退出登录</button>
    </div> : null}
  </div>
}

function ObsidianMark() {
  return <svg className="obsidian-mark" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M12.4 2.6 6 9.8l2.6 11.6 7.2 8 8.6-4.8 1.8-7.8-6-12.8z" fill="#7c5ce0" />
    <path d="m12.4 2.6 7.8 1.4 6 12.8-8.4-3.4z" fill="#a88bfa" />
    <path d="M8.6 21.4 17.8 13.4l-2 16z" fill="#5b3fc4" />
  </svg>
}

function PlatformLogo({ platformId }: { platformId: ArticlePlatformId }) {
  const brand = PLATFORM_BRAND[platformId]
  return <span className={`platform-logo ${brand.glyph.length > 1 ? "is-wide" : ""}`} style={{ background: brand.color }}>
    {brand.glyph}
  </span>
}

function sourceCopy(draft: ComposeDraft): { title: string; detail: string; icon: ReactNode } {
  if (draft.source.kind === "obsidian") {
    return {
      title: "已从 Obsidian 导入",
      detail: draft.source.vaultPath.split("/").pop() ?? draft.source.vaultPath,
      icon: <ObsidianMark />
    }
  }
  if (draft.source.kind === "file") {
    return { title: "已导入本地 Markdown", detail: draft.source.fileName, icon: <FileText /> }
  }
  return {
    title: "已从链接导入",
    detail: draft.source.url,
    icon: <Link2 />
  }
}

function App() {
  const [mode, setMode] = useState<"article" | "dynamic">("dynamic")
  const [draft, setDraft] = useState<ComposeDraft | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [assetUrls, setAssetUrls] = useState<Map<string, string>>(new Map())
  const [center, setCenter] = useState<PublishCenterState | null>(null)
  const [selected, setSelected] = useState<ArticlePlatformId[]>([])
  const [keepImages, setKeepImages] = useState(true)
  const [xSkipExcessImages, setXSkipExcessImages] = useState(false)
  const [query, setQuery] = useState("")
  const [linkInput, setLinkInput] = useState("")
  const [bodyTab, setBodyTab] = useState<"preview" | "markdown">("preview")
  const [importing, setImporting] = useState<"url" | "file" | null>(null)
  const [checkingAccounts, setCheckingAccounts] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [busyPlatform, setBusyPlatform] = useState("")
  const [openingPlatformLogins, setOpeningPlatformLogins] = useState<PlatformId[]>([])
  const platformLoginPending = useRef(new Set<PlatformId>())
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved">("idle")
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null)
  const [dragTarget, setDragTarget] = useState<"import" | "cover" | null>(null)
  // Platforms the user tried to add beyond the one-platform limit.
  const [upgradePrompt, setUpgradePrompt] = useState<{ wanted: PlatformId[]; checkoutOpened: boolean } | null>(null)
  const dirty = useRef(false)
  const draftRef = useRef<ComposeDraft | null>(null)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const markdownInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  draftRef.current = draft

  const showError = (reason: unknown) => setNotice({ tone: "error", text: errorText(reason) })

  const loadDraft = useCallback(async () => {
    dirty.current = false
    const stored = await getCurrentDraft()
    const next = stored ? normalizeDraft(stored) : null
    if (next && JSON.stringify(next) !== JSON.stringify(stored)) await saveCurrentDraft(next)
    setDraft(next)
    setLoaded(true)
  }, [])

  const refreshCenter = useCallback(async (refreshAccess = false) => {
    try {
      setCenter(await request<PublishCenterState>({ type: "GET_PUBLISH_STATE", refreshAccess }))
    } catch (reason) {
      showError(reason)
    }
  }, [])

  const refreshAccounts = useCallback(async () => {
    setCheckingAccounts(true)
    try {
      const accounts = await request<AccountStateMap>({ type: "REFRESH_ACCOUNTS" })
      setCenter(current => current ? { ...current, accounts } : current)
    } catch (reason) {
      showError(reason)
    } finally {
      setCheckingAccounts(false)
    }
  }, [])

  useEffect(() => {
    document.title = "WeSight 发布中心"
    void chrome.storage.local.get(STORAGE_KEYS.publishMode).then(result => setMode(result[STORAGE_KEYS.publishMode] === "article" ? "article" : "dynamic"))
    void loadDraft().catch(showError)
    void refreshCenter(true)
    void refreshAccounts()
    void chrome.storage.local.get(STORAGE_KEYS.publishPreferences).then(result => {
      const preferences = result[STORAGE_KEYS.publishPreferences] as PublishPreferences | undefined
      if (preferences) {
        setSelected(preferences.selected.filter((id): id is ArticlePlatformId => ARTICLE_PLATFORM_IDS.includes(id as ArticlePlatformId)))
        setKeepImages(preferences.keepImages)
        setXSkipExcessImages(preferences.xSkipExcessImages === true)
      }
      setPreferencesLoaded(true)
    })
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return
      if (changes[STORAGE_KEYS.publishMode]) setMode(changes[STORAGE_KEYS.publishMode]!.newValue === "article" ? "article" : "dynamic")
      if (changes[STORAGE_KEYS.draftRevision]) {
        void loadDraft()
        setNotice({ tone: "info", text: "已从 Obsidian 导入最新文章" })
        void refreshCenter()
      }
      if (changes[STORAGE_KEYS.currentTask] || changes[STORAGE_KEYS.accountStates] || changes[STORAGE_KEYS.access] || changes[STORAGE_KEYS.auth]) {
        setCenter(current => current ? {
          ...current,
          ...(changes[STORAGE_KEYS.currentTask] ? { currentTask: (changes[STORAGE_KEYS.currentTask]!.newValue as TaskSummary | undefined) ?? null } : {}),
          ...(changes[STORAGE_KEYS.accountStates] ? { accounts: { ...current.accounts, ...(changes[STORAGE_KEYS.accountStates]!.newValue as AccountStateMap) } } : {}),
          ...(changes[STORAGE_KEYS.auth] ? { auth: changes[STORAGE_KEYS.auth]!.newValue } : {}),
          ...(changes[STORAGE_KEYS.access] ? { access: changes[STORAGE_KEYS.access]!.newValue ?? null } : {})
        } : current)
      }
    }
    // Returning from a platform login tab should update the account badges.
    const onVisible = () => {
      if (document.visibilityState === "visible") { void refreshAccounts(); void refreshCenter(true) }
    }
    chrome.storage.onChanged.addListener(onStorage)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      chrome.storage.onChanged.removeListener(onStorage)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [loadDraft, refreshAccounts, refreshCenter])

  useEffect(() => {
    if (!preferencesLoaded) return
    void chrome.storage.local.set({ [STORAGE_KEYS.publishPreferences]: { selected, keepImages, xSkipExcessImages } satisfies PublishPreferences })
  }, [selected, keepImages, xSkipExcessImages, preferencesLoaded])

  useEffect(() => {
    if (!center?.auth.loginPending) return
    const timer = window.setInterval(() => void refreshCenter(true), 2_000)
    return () => window.clearInterval(timer)
  }, [center?.auth.loginPending, refreshCenter])

  const login = async () => {
    try { await request({ type: "WESIGHT_LOGIN" }); await refreshCenter() } catch (reason) { showError(reason) }
  }
  const logout = async () => {
    try { await request({ type: "WESIGHT_LOGOUT" }); await refreshCenter() } catch (reason) { showError(reason) }
  }

  // Object URLs let the preview show IndexedDB images without exposing them to any page.
  const assetKey = draft?.assets.map(asset => asset.id).join(",") ?? ""
  useEffect(() => {
    let cancelled = false
    const ids = assetKey ? assetKey.split(",") : []
    void Promise.all(ids.map(async id => {
      const stored = await getStoredAsset(id)
      return stored ? [id, URL.createObjectURL(new Blob([stored.bytes], { type: stored.mimeType }))] as const : null
    })).then(entries => {
      const next = new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null))
      if (cancelled) {
        next.forEach(url => URL.revokeObjectURL(url))
        return
      }
      setAssetUrls(previous => {
        previous.forEach(url => URL.revokeObjectURL(url))
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [assetKey])

  useEffect(() => {
    if (!draft || !dirty.current) return
    setSaveState("pending")
    const timer = window.setTimeout(() => {
      dirty.current = false
      void saveCurrentDraft(draft).then(() => setSaveState("saved")).catch(showError)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [draft])

  const flushSave = async () => {
    if (!draftRef.current) return
    dirty.current = false
    await saveCurrentDraft(draftRef.current)
    setSaveState("saved")
  }

  const updateDraft = (patch: Partial<ComposeDraft>) => {
    dirty.current = true
    setDraft(current => current ? normalizeDraft({ ...current, ...patch, updatedAt: new Date().toISOString() }) : current)
  }

  const adoptImport = async (imported: ImportedArticle) => {
    imported.draft = normalizeDraft(imported.draft)
    await saveCurrentDraft(imported.draft, imported.assets)
    await pruneAssets()
    dirty.current = false
    setDraft(imported.draft)
    setBodyTab("preview")
    setSaveState("saved")
    setNotice(imported.draft.warnings.length ? { tone: "info", text: imported.draft.warnings[0]! } : null)
  }

  const importLink = async () => {
    const value = linkInput.trim()
    if (!value) {
      setNotice({ tone: "error", text: "请先粘贴文章链接" })
      return
    }
    setImporting("url")
    setNotice(null)
    try {
      // Must run first so the click still counts as the user gesture Chrome requires.
      const granted = await chrome.permissions.request(URL_PERMISSION)
      if (!granted) throw new Error("需要授权读取网页，才能从链接导入文章")
      await adoptImport(await importArticleUrl(value))
      setLinkInput("")
    } catch (reason) {
      showError(reason)
    } finally {
      setImporting(null)
    }
  }

  const importFiles = async (files: File[]) => {
    if (!files.length) return
    setImporting("file")
    setNotice(null)
    try {
      await adoptImport(await importMarkdownFiles(files))
    } catch (reason) {
      showError(reason)
    } finally {
      setImporting(null)
      if (markdownInput.current) markdownInput.current.value = ""
    }
  }

  const setCover = async (file: File | undefined) => {
    const current = draftRef.current
    if (!file || !current) return
    try {
      const result = await importCoverImage(current, file)
      await saveCurrentDraft(result.draft, [result.asset])
      dirty.current = false
      setDraft(result.draft)
    } catch (reason) {
      showError(reason)
    } finally {
      if (coverInput.current) coverInput.current.value = ""
    }
  }

  const onDrop = (target: "import" | "cover") => (event: DragEvent) => {
    event.preventDefault()
    setDragTarget(null)
    const files = Array.from(event.dataTransfer.files)
    if (target === "cover") void setCover(files.find(file => file.type.startsWith("image/")))
    else void importFiles(files)
  }

  const onDragOver = (target: "import" | "cover") => (event: DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return
    event.preventDefault()
    setDragTarget(target)
  }

  const auth = center?.auth
  const access = center?.access ?? null
  const limit = access?.maxTargets === undefined ? 1 : access.maxTargets === 0 ? 1 : access.maxTargets
  const accounts = center?.accounts
  // Sync status belongs to the article it was started from; a new import starts clean.
  const task = center?.currentTask?.origin === "compose" && center.currentTask.draftId === draft?.id
    ? center.currentTask
    : null

  useEffect(() => {
    if (!upgradePrompt) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUpgradePrompt(null)
    }
    document.addEventListener("keydown", onKey)
    // After checkout or login in another tab, pick up the new membership automatically.
    const timer = upgradePrompt.checkoutOpened || center?.auth.loginPending
      ? window.setInterval(() => void refreshCenter(true), 4_000)
      : undefined
    return () => {
      document.removeEventListener("keydown", onKey)
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [upgradePrompt, center?.auth.loginPending, refreshCenter])

  useEffect(() => {
    if (!upgradePrompt || center?.access?.maxTargets !== null || !center.auth.user) return
    if (mode === "article") setSelected(upgradePrompt.wanted.filter((id): id is ArticlePlatformId => ARTICLE_PLATFORM_IDS.includes(id as ArticlePlatformId)))
    setUpgradePrompt(null)
    setNotice({ tone: "info", text: "会员已生效，可同时同步多个平台" })
  }, [center?.access?.maxTargets, center?.auth.user, upgradePrompt])

  const openUpgrade = (wanted: PlatformId[]) => setUpgradePrompt({ wanted, checkoutOpened: false })

  const toggle = (platformId: ArticlePlatformId) => {
    setNotice(null)
    if (selected.includes(platformId)) {
      setSelected(selected.filter(id => id !== platformId))
      return
    }
    if (limit !== null && selected.length >= limit) {
      openUpgrade([...selected, platformId])
      return
    }
    setSelected([...selected, platformId])
  }

  const openCheckout = () => {
    void chrome.tabs.create({ url: membershipCheckoutUrl(access), active: true })
    setUpgradePrompt(current => current ? { ...current, checkoutOpened: true } : current)
  }

  const loggedInPlatforms = ARTICLE_PLATFORM_IDS.filter(id => accounts?.[id]?.state === "logged_in")
  const allLoggedInSelected = loggedInPlatforms.length > 0 && loggedInPlatforms.every(id => selected.includes(id))
  const toggleAllLoggedIn = () => {
    if (allLoggedInSelected) {
      setSelected(selected.filter(id => !loggedInPlatforms.includes(id)))
      return
    }
    if (limit !== null && loggedInPlatforms.length > limit) {
      openUpgrade(loggedInPlatforms)
      return
    }
    setSelected(loggedInPlatforms)
  }

  const visiblePlatforms = ARTICLE_PLATFORM_IDS.filter(id => {
    const keyword = query.trim().toLowerCase()
    return !keyword || PLATFORM_CONFIG[id].label.toLowerCase().includes(keyword) || PLATFORM_CONFIG[id].shortLabel.toLowerCase().includes(keyword)
  })

  const titleWarnings = useMemo(() => {
    const length = Array.from(draft?.title.trim() ?? "").length
    return selected
      .filter(id => length > PLATFORM_CONFIG[id].titleLimit)
      .map(id => `${PLATFORM_CONFIG[id].shortLabel}标题最多 ${PLATFORM_CONFIG[id].titleLimit} 字，将自动截断`)
  }, [draft?.title, selected])

  const imageWarning = xImageWarning(draft, selected, keepImages, xSkipExcessImages)
  const unsupportedImageWarning = xUnsupportedImageWarning(draft, selected, keepImages)

  const startBlocker = !preferencesLoaded
    ? "正在恢复平台选择"
    : !draft
    ? "请先导入文章"
    : !draft.title.trim()
      ? "请填写标题"
      : !selected.length
        ? "请选择平台"
        : !auth?.user || !access
            ? "请先登录 WeSight"
            : access.maxTargets === 0
              ? "请先登录 WeSight"
              : access.maxTargets !== null && selected.length > access.maxTargets
                ? "非会员仅支持一个平台"
                : xSkipExcessImages ? "" : imageWarning ?? ""

  const overLimit = limit !== null && selected.length > limit
  const needsLogin = !auth?.user || !access || access.maxTargets === 0
  // Login and membership limits are handled by prompts, so they keep the button clickable.
  const hardBlocker = overLimit || (needsLogin && startBlocker === "请先登录 WeSight") ? "" : startBlocker

  const startSync = async () => {
    if (overLimit) {
      openUpgrade(selected)
      return
    }
    if (needsLogin && startBlocker === "请先登录 WeSight") {
      await login()
      return
    }
    if (startBlocker) {
      setNotice({ tone: "error", text: startBlocker })
      return
    }
    setSyncing(true)
    setNotice(null)
    try {
      await flushSave()
      const summary = await request<TaskSummary>({ type: "START_COMPOSE_SYNC", targets: selected, keepImages, xSkipExcessImages })
      setCenter(current => current ? { ...current, currentTask: summary } : current)
    } catch (reason) {
      showError(reason)
      void refreshCenter(true)
    } finally {
      setSyncing(false)
    }
  }

  const platformAction = async (platformId: PlatformId, action: "open" | "retry") => {
    const activeTask = mode === "dynamic" ? center?.currentTask : task
    if (!activeTask) return
    setBusyPlatform(platformId)
    try {
      await request(action === "open"
        ? { type: "OPEN_PLATFORM_TAB", taskId: activeTask.taskId, platformId }
        : { type: "RETRY_PLATFORM", taskId: activeTask.taskId, platformId })
    } catch (reason) {
      showError(reason)
    } finally {
      setBusyPlatform("")
    }
  }

  const openLogin = async (platformId: PlatformId) => {
    if (platformLoginPending.current.has(platformId)) return
    platformLoginPending.current.add(platformId)
    setOpeningPlatformLogins([...platformLoginPending.current])
    try {
      await request<{ tabId: number }>({ type: "OPEN_PLATFORM_LOGIN", platformId })
      setNotice({ tone: "info", text: `请在${PLATFORM_CONFIG[platformId].shortLabel}完成登录，账号会自动更新。` })
    } catch (reason) {
      showError(reason)
    } finally {
      platformLoginPending.current.delete(platformId)
      setOpeningPlatformLogins([...platformLoginPending.current])
    }
  }

  const previewHtml = useMemo(
    () => draft ? replaceTokens(cangheGreenPreview(draft.html), assetUrls) : "",
    [draft?.html, assetUrls]
  )
  const stats = useMemo(() => draft ? articleStats(draft.html) : { characters: 0, images: 0 }, [draft?.html])
  const bodyImages = useMemo(() => {
    if (!draft) return []
    const used = referencedAssetIds(draft.html)
    return Array.from(used).map(id => draft.assets.find(asset => asset.id === id)).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
  }, [draft])
  const coverUrl = draft?.coverAssetId ? assetUrls.get(draft.coverAssetId) : undefined
  const source = draft ? sourceCopy(draft) : null
  const taskProgress = task
    ? { ready: (task.targets ?? []).filter(id => task.platforms[id].status === "ready").length, total: task.targets?.length ?? 0 }
    : null

  return <div className="publish-shell">
    <header className="topbar">
      <div className="brand">
        <img src={logo} alt="" />
        <strong>WeSight 发布助手</strong>
        <span className="brand-tab">发布中心</span>
      </div>
      <div className="topbar-status">
        <a className="button ghost small" href="https://github.com/freestylefly/wesight-chrome/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">隐私政策</a>
        <span className={`pill ${center?.connected ? "is-online" : ""}`}>
          <i />{center?.connected ? "Obsidian 已连接" : center?.paired ? "Obsidian 未运行" : "未与 Obsidian 配对"}
        </span>
        {auth?.user ? <AccountMenu
          user={auth.user}
          source={auth.source}
          access={access}
          onCheckout={openCheckout}
          onLogout={() => void logout()}
        /> : auth?.loginPending ? <button className="button primary small" disabled>
          <LoaderCircle className="spin" />等待登录…
        </button> : <button className="button primary small" onClick={() => void login()}><LogIn />去登录</button>}
      </div>
    </header>

    <main className="page">
      <nav className="publish-mode-switch" aria-label="发布内容类型">
        <button className={mode === "dynamic" ? "is-active" : ""} aria-pressed={mode === "dynamic"} onClick={() => { setMode("dynamic"); void chrome.storage.local.set({ [STORAGE_KEYS.publishMode]: "dynamic" }) }}><MessageSquare />动态</button>
        <button className={mode === "article" ? "is-active" : ""} aria-pressed={mode === "article"} onClick={() => { setMode("article"); void chrome.storage.local.set({ [STORAGE_KEYS.publishMode]: "article" }) }}><FileText />文章</button>
      </nav>

      <div hidden={mode !== "dynamic"}>
        {notice ? <div className={`notice is-${notice.tone}`} role="status"><Info /><span>{notice.text}</span><button aria-label="关闭提示" onClick={() => setNotice(null)}><X /></button></div> : null}
        <DynamicComposer accounts={accounts ?? {} as AccountStateMap} access={access} auth={auth ?? null}
          task={center?.currentTask?.contentKind === "dynamic" ? center.currentTask : null} checkingAccounts={checkingAccounts}
          onLogin={() => void login()} onRefreshAccounts={() => void refreshAccounts()} onUpgrade={wanted => openUpgrade(wanted ?? [])}
          onPlatformLogin={id => void openLogin(id)} openingPlatformLogins={openingPlatformLogins}
          onPlatformAction={(id, action) => void platformAction(id, action)} onNotice={setNotice}
          onTaskStarted={summary => setCenter(current => current ? { ...current, currentTask: summary } : current)} />
      </div>
      <div hidden={mode !== "article"}>

      {!auth?.user && loaded ? <section className="login-banner">
        <LogIn /><div><strong>登录 WeSight，继续多平台同步</strong><p>使用与 Obsidian 相同的 WeSight 账号，平台选择和草稿会保留。</p>{auth?.error ? <p className="auth-error">{auth.error}</p> : null}</div>
        <button className="button outline" onClick={() => void login()} disabled={auth?.loginPending}>{auth?.loginPending ? "等待登录完成" : "去登录"}</button>
      </section> : null}

      <section
        className={`card import-card reveal ${dragTarget === "import" ? "is-dragging" : ""}`}
        onDragOver={onDragOver("import")}
        onDragLeave={() => setDragTarget(null)}
        onDrop={onDrop("import")}
      >
        <div className="card-heading">
          <h2>导入文章</h2>
          <span>支持 Obsidian、本地 Markdown 或文章链接</span>
        </div>
        <div className="import-row">
          <label className="link-field">
            <Link2 />
            <input
              value={linkInput}
              onChange={event => setLinkInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") void importLink()
              }}
              placeholder="粘贴文章链接，如：https://mp.weixin.qq.com/s/xxxx"
            />
          </label>
          <button className="button outline" disabled={importing !== null} onClick={() => void importLink()}>
            {importing === "url" ? <LoaderCircle className="spin" /> : null}导入链接
          </button>
          <span className="or">或</span>
          <button className="button outline upload" disabled={importing !== null} onClick={() => markdownInput.current?.click()}>
            {importing === "file" ? <LoaderCircle className="spin" /> : <FileText />}
            <span><strong>上传 Markdown</strong><small>.md 文件，可连同图片一起选择</small></span>
          </button>
          <input
            ref={markdownInput}
            type="file"
            hidden
            multiple
            accept=".md,.markdown,.txt,image/*"
            onChange={event => void importFiles(Array.from(event.target.files ?? []))}
          />
        </div>
        {draft && source ? <div className={`source-banner is-${draft.source.kind}`}>
          <span className="source-icon">{source.icon}</span>
          <strong>{source.title}</strong>
          <span className="source-name" title={source.detail}>{source.detail}</span>
          <span className="source-meta">标题、正文与 {draft.assets.length} 张图片已带入</span>
          {draft.source.kind === "obsidian"
            ? <span className="source-hint">在 Obsidian 再次点击「多平台发布」可重新导入</span>
            : <button className="button ghost small" onClick={() => {
              if (draft.source.kind === "url") {
                setLinkInput(draft.source.url)
              } else {
                markdownInput.current?.click()
              }
            }}><RotateCcw />重新导入</button>}
        </div> : null}
        {dragTarget === "import" ? <div className="drop-hint">松开即可导入 Markdown 文件及其图片</div> : null}
      </section>

      {notice ? <div className={`notice is-${notice.tone}`} role="status">
        {notice.tone === "error" ? <AlertCircle /> : <Info />}
        <span>{notice.text}</span>
        <button aria-label="关闭提示" onClick={() => setNotice(null)}><X /></button>
      </div> : null}

      <section className="card content-card reveal">
        {!loaded ? <div className="empty"><LoaderCircle className="spin" />正在读取草稿…</div> : !draft ? <div className="empty">
          <h3>还没有文章</h3>
          <p>在 Obsidian 点击「多平台发布」，或在上方粘贴链接、上传 Markdown 文件。</p>
        </div> : <>
          <div className="content-form">
            <div className="card-heading">
              <h2>文章内容</h2>
              <span>仅修改本次发布副本</span>
            </div>
            <label className="field">
              <span>标题</span>
              <div className="input-wrap">
                <input value={draft.title} onChange={event => updateDraft({ title: event.target.value })} placeholder="文章标题" />
                <small>{Array.from(draft.title).length}</small>
              </div>
            </label>
            <label className="field">
              <span>摘要（选填）</span>
              <textarea value={draft.digest} rows={3} onChange={event => updateDraft({ digest: event.target.value })} placeholder="一两句话介绍文章" />
            </label>
            <div className="field">
              <span>文章封面</span>
              <div
                className={`cover-zone ${dragTarget === "cover" ? "is-dragging" : ""}`}
                onDragOver={event => {
                  event.stopPropagation()
                  onDragOver("cover")(event)
                }}
                onDragLeave={() => setDragTarget(null)}
                onDrop={event => {
                  event.stopPropagation()
                  onDrop("cover")(event)
                }}
              >
                {coverUrl ? <img className="cover-preview" src={coverUrl} alt="封面预览" /> : null}
                <div className="cover-actions">
                  {!coverUrl ? <button className="cover-empty" onClick={() => coverInput.current?.click()}>
                    <Upload />
                    <span>点击或拖入封面图片</span>
                  </button> : <>
                    <button className="button ghost small" onClick={() => coverInput.current?.click()}><ImagePlus />更换封面</button>
                    <button className="button ghost small" onClick={() => updateDraft({ coverAssetId: null, coverSelection: "none" })}><Trash2 />移除</button>
                  </>}
                  {draft.coverSelection === "custom" || draft.coverSelection === "none" ? <button className="button ghost small" onClick={() => updateDraft({ coverSelection: "auto" })}><RotateCcw />使用正文首图</button> : <small className="auto-cover-hint">默认使用正文第一张图片</small>}
                  {bodyImages.length ? <div className="cover-picks">
                    <small>使用正文图片</small>
                    <div>
                      {bodyImages.map(asset => assetUrls.get(asset.id) ? <button
                        key={asset.id}
                        title={asset.fileName}
                        onClick={() => updateDraft({ coverAssetId: asset.id, coverSelection: "custom" })}
                      ><img src={assetUrls.get(asset.id)} alt={asset.fileName} /></button> : null)}
                    </div>
                  </div> : null}
                </div>
                <input ref={coverInput} type="file" hidden accept="image/*" onChange={event => void setCover(event.target.files?.[0])} />
              </div>
            </div>
          </div>

          <div className="content-body">
            <div className="body-tabs">
              <button className={bodyTab === "preview" ? "is-active" : ""} onClick={() => setBodyTab("preview")}>正文预览</button>
              <button className={bodyTab === "markdown" ? "is-active" : ""} onClick={() => setBodyTab("markdown")}>Markdown</button>
              <span className="tab-hint">{bodyTab === "markdown" ? "修改后预览自动更新" : "切换到 Markdown 可编辑正文"}</span>
            </div>
            {bodyTab === "preview"
              ? <article className="preview" dangerouslySetInnerHTML={{ __html: previewHtml || "<p class=\"muted\">正文为空</p>" }} />
              : <textarea
                className="markdown-editor"
                value={draft.markdown}
                spellCheck={false}
                onChange={event => updateDraft({ markdown: event.target.value, html: markdownToHtml(event.target.value) })}
              />}
            <div className="body-meta"><span className="preview-theme-label">苍绿主题</span> · {stats.characters.toLocaleString("zh-CN")} 字 · {stats.images} 张图片{draft.tags.length ? ` · ${draft.tags.map(tag => `#${tag}`).join(" ")}` : ""}</div>
          </div>
        </>}
      </section>

      <section className="card platform-card reveal">
        <div className="platform-heading">
          <div>
            <div className="card-heading">
              <h2>选择发布平台</h2>
              <span className="count-badge">已选 {selected.length} 个</span>
              {taskProgress ? <span className="progress-badge">本次同步 {taskProgress.ready}/{taskProgress.total} 已就绪</span> : null}
            </div>
            <p>勾选要同步的平台，使用浏览器中已登录的账号</p>
          </div>
          <div className="platform-tools">
            <label className="search-field">
              <Search />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索平台" />
            </label>
            <button className="button ghost small" disabled={checkingAccounts} onClick={() => void refreshAccounts()}>
              <RefreshCw className={checkingAccounts ? "spin" : ""} />检测登录
            </button>
            <label className="check-label">
              <input type="checkbox" checked={allLoggedInSelected} disabled={!loggedInPlatforms.length} onChange={toggleAllLoggedIn} />
              全选已登录
            </label>
          </div>
        </div>

        <div className="platform-grid">
          {visiblePlatforms.map(platformId => {
            const account: AccountRecord = accounts?.[platformId] ?? { state: "unknown" }
            const isSelected = selected.includes(platformId)
            const state = task?.targets?.includes(platformId) ? task.platforms[platformId] : null
            return <div key={platformId} className={`platform ${isSelected ? "is-selected" : ""}`}>
              <label className="platform-main">
                <input type="checkbox" checked={isSelected} disabled={!preferencesLoaded || !center} onChange={() => toggle(platformId)} />
                <span className="fake-check">{isSelected ? <Check /> : null}</span>
                <PlatformLogo platformId={platformId} />
                <span className="platform-copy">
                  <strong>{PLATFORM_CONFIG[platformId].label}</strong>
                  <small>{account.state === "logged_in" ? (account.name ? `@${account.name}` : "已登录账号") : account.state === "login_required" ? "未登录" : checkingAccounts ? "正在检测账号…" : "暂时无法确认登录状态"}</small>
                </span>
              </label>
              <div className="platform-side">
                {state ? <>
                  <span className={`task-status is-${state.status}`} title={state.message}>
                    {state.status === "ready" ? <CheckCircle2 /> : state.status === "failed" || state.status === "login_required" ? <AlertCircle /> : <LoaderCircle className="spin" />}
                    {STATUS_LABEL[state.status]}
                  </span>
                  {state.status === "login_required"
                    ? <button className="link" disabled={openingPlatformLogins.includes(platformId)} onClick={() => void openLogin(platformId)}>{openingPlatformLogins.includes(platformId) ? "正在打开…" : "去登录"}<ExternalLink /></button>
                    : ["ready", "filling", "failed"].includes(state.status)
                    ? <button className="link" disabled={busyPlatform === platformId} onClick={() => void platformAction(platformId, "open")}>打开<ExternalLink /></button>
                    : null}
                  {state.status === "failed" && account.state !== "logged_in"
                    ? <button className="link" disabled={openingPlatformLogins.includes(platformId)} onClick={() => void openLogin(platformId)}>{openingPlatformLogins.includes(platformId) ? "正在打开…" : "去登录"}</button>
                    : null}
                  {["failed", "login_required"].includes(state.status)
                    ? <button className="link" disabled={busyPlatform === platformId} onClick={() => void platformAction(platformId, "retry")}>重试</button>
                    : null}
                </> : account.state === "logged_in"
                  ? <span className="account-dot is-online"><i />已登录</span>
                  : <button className="link" disabled={openingPlatformLogins.includes(platformId)} onClick={() => void openLogin(platformId)}>{openingPlatformLogins.includes(platformId) ? "正在打开…" : "去登录"}</button>}
              </div>
              {state?.message && ["failed", "login_required", "filling"].includes(state.status)
                ? <p className={`platform-message is-${state.status}`} role={state.status === "failed" ? "alert" : "status"}>{state.message}</p>
                : null}
              {state?.status === "ready" && state.warnings.length
                ? <p className="platform-message" role="status">{state.warnings.join("；")}</p>
                : null}
            </div>
          })}
          {!visiblePlatforms.length ? <div className="empty small">没有匹配的平台</div> : null}
        </div>

        {unsupportedImageWarning ? <div className="notice is-info x-format-warning" role="status">
          <Info /><span>{unsupportedImageWarning}</span>
        </div> : null}
        {imageWarning ? <div className={`notice ${xSkipExcessImages ? "is-info" : "is-error"} x-image-warning`} role="status">
          <AlertCircle /><span>{imageWarning}</span>
          <label className="x-image-limit-option">
            <input type="checkbox" checked={xSkipExcessImages} onChange={event => setXSkipExcessImages(event.target.checked)} />
            <span>自动跳过超出图片，保留全部文字</span>
          </label>
        </div> : null}

        <div className="platform-options">
          <label className="switch">
            <input type="checkbox" checked={keepImages} onChange={event => setKeepImages(event.target.checked)} />
            <span />
            保留文章图片
          </label>
          {titleWarnings.length ? <span className="warning-inline"><AlertCircle />{titleWarnings.join("；")}</span> : null}
          <span className="option-note"><Info />同步后在各平台编辑页确认发布，扩展不会自动点击发布</span>
        </div>
      </section>
      </div>
    </main>

    {mode === "article" ? <footer className="action-bar">
      <div className="selected-summary">
        <span>已选择 <b>{selected.length}</b> 个平台</span>
        <div className="chips">
          {selected.map(id => <span key={id} className="chip">
            {PLATFORM_CONFIG[id].shortLabel}
            <button aria-label={`移除${PLATFORM_CONFIG[id].shortLabel}`} onClick={() => toggle(id)}><X /></button>
          </span>)}
        </div>
      </div>
      <div className="actions">
        {startBlocker && draft ? <span className="blocker">{startBlocker}</span> : null}
        <button className="button ghost" disabled={!draft} onClick={() => void flushSave().catch(showError)}>
          <Save />{saveState === "pending" ? "保存中…" : saveState === "saved" ? "草稿已保存" : "保存草稿"}
        </button>
        <button className="button primary" disabled={syncing || Boolean(hardBlocker)} onClick={() => void startSync()}>
          {syncing ? <LoaderCircle className="spin" /> : <Send />}开始同步{selected.length ? ` · ${selected.length} 个平台` : ""}
        </button>
      </div>
    </footer> : null}

    {upgradePrompt ? <div className="modal-backdrop" onClick={() => setUpgradePrompt(null)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" onClick={event => event.stopPropagation()}>
        <button className="modal-close" aria-label="关闭" onClick={() => setUpgradePrompt(null)}><X /></button>
        <span className="modal-icon"><Crown /></span>
        <h3 id="upgrade-title">{auth?.user ? "开通会员，一次同步多个平台" : "登录并开通会员，一次同步多个平台"}</h3>
        <p>
          {auth?.user ? "普通用户每次只能同步 1 个平台。" : "未登录时每次只能同步 1 个平台。"}
          你想同步到 {upgradePrompt.wanted.map(id => PLATFORM_CONFIG[id].shortLabel).join("、")}，开通 WeSight 会员后不限平台数量。
        </p>
        <ul className="modal-perks">
          <li><Check />一次勾选多个平台，同步一键完成</li>
          <li><Check />与 Obsidian 共用同一个 WeSight 会员</li>
          <li><Check />月卡 ¥15.9 · 年卡 ¥128</li>
        </ul>
        {upgradePrompt.checkoutOpened ? <p className="modal-state"><LoaderCircle className="spin" />支付完成后会自动更新会员状态</p> : null}
        <div className="modal-actions">
          <button className="button ghost" onClick={() => setUpgradePrompt(null)}>稍后再说</button>
          {!auth?.user ? <button className="button outline" disabled={auth?.loginPending} onClick={() => void login()}>
            {auth?.loginPending ? <LoaderCircle className="spin" /> : <LogIn />}{auth?.loginPending ? "等待登录…" : "去登录"}
          </button> : null}
          <button className="button primary" onClick={openCheckout}><Crown />充会员</button>
        </div>
      </div>
    </div> : null}
  </div>
}

export default App
