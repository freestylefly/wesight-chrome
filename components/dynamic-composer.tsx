import {
  AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2,
  ExternalLink, Eye, FileVideo2, Hash, ImagePlus, Info, LoaderCircle, Play,
  RefreshCw, RotateCcw, Save, Send, Sparkles, Trash2, Upload, Video, X
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react"

import {
  createDynamicDraft,
  getCurrentDynamicDraft,
  hasDynamicContent,
  nextDynamicDraft,
  importDynamicMedia,
  saveCurrentDynamicDraft,
  getDynamicValidationErrors,
  DYNAMIC_PLATFORM_IDS,
  type DynamicDraft,
  type DynamicMedia,
  type DynamicPlatformId
} from "~lib/dynamic-draft"
import { getStoredAsset } from "~lib/draft-store"
import { buildXPostText, supportedXPostImages, xPostWeightedLength, X_POST_TEXT_LIMIT } from "~lib/x-post-content"
import { STORAGE_KEYS, type AccessRecord, type AccountStateMap, type TaskSummary } from "~lib/storage"
import type { WeSightAuthState } from "~types/auth"
import type { ExtensionResponse } from "~types/messages"
import type { PlatformId, PlatformTaskState } from "~types/protocol"

import "./dynamic-composer.css"

export interface DynamicComposerProps {
  accounts: AccountStateMap
  access: AccessRecord | null
  auth: WeSightAuthState | null
  task: TaskSummary | null
  checkingAccounts?: boolean
  onLogin: () => void
  onRefreshAccounts: () => void
  onPlatformLogin: (platformId: PlatformId) => void
  openingPlatformLogins?: PlatformId[]
  onUpgrade: (wanted?: DynamicPlatformId[]) => void
  onPlatformAction: (platformId: PlatformId, action: "open" | "retry") => void
  onNotice: (notice: { tone: "info" | "error"; text: string } | null) => void
  onTaskStarted?: (task: TaskSummary) => void
}

const BRAND: Record<DynamicPlatformId, { name: string; glyph: string; color: string; caption: string }> = {
  xiaohongshu: { name: "小红书", glyph: "小红书", color: "#ed3658", caption: "把灵感写成一篇笔记" },
  "weibo-post": { name: "微博", glyph: "微", color: "#e94b42", caption: "分享此刻的新鲜事" },
  "jike-post": { name: "即刻", glyph: "J", color: "#e6be1f", caption: "和同好聊聊你的发现" },
  "x-post": { name: "X", glyph: "X", color: "#101419", caption: "标题会合并到正文，话题默认不同步到 X，按 X 规则计数" }
}
const STATUS: Record<PlatformTaskState["status"], string> = {
  queued: "等待中", opening: "打开中", login_required: "需要登录", filling: "同步中", ready: "待发布", failed: "失败", cancelled: "已取消"
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
function durationText(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return ""
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
}
function PlatformMark({ id, small = false }: { id: DynamicPlatformId; small?: boolean }) {
  return <span aria-hidden="true" className={`dc-platform-mark ${small ? "is-small" : ""} ${id === "xiaohongshu" ? "is-word" : ""}`} style={{ background: BRAND[id].color }}>{BRAND[id].glyph}</span>
}

export default function DynamicComposer({ accounts, access, auth, task, checkingAccounts = false, onLogin, onRefreshAccounts, onPlatformLogin, openingPlatformLogins = [], onUpgrade, onPlatformAction, onNotice, onTaskStarted }: DynamicComposerProps) {
  const [draft, setDraft] = useState<DynamicDraft | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [platform, setPlatform] = useState<DynamicPlatformId>("xiaohongshu")
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved">("idle")
  const [importing, setImporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [draggedMedia, setDraggedMedia] = useState<string | null>(null)
  const [assetUrls, setAssetUrls] = useState<Map<string, string>>(new Map())
  const [previewMedia, setPreviewMedia] = useState<DynamicMedia | null>(null)
  const [topicOpen, setTopicOpen] = useState(false)
  const [topic, setTopic] = useState("")
  const [previewOpen, setPreviewOpen] = useState(false)
  const [showTitle, setShowTitle] = useState(false)
  const noticeRef = useRef(onNotice)
  noticeRef.current = onNotice
  const imageInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const bodyInput = useRef<HTMLTextAreaElement>(null)
  const replacingVideo = useRef<string | null>(null)
  const draftRef = useRef<DynamicDraft | null>(null)
  const dirty = useRef(false)
  const urlsRef = useRef<Map<string, string>>(new Map())
  const mounted = useRef(true)
  const draftGeneration = useRef(0)
  const importPending = useRef(false)
  draftRef.current = draft

  const report = useCallback((reason: unknown) => noticeRef.current({ tone: "error", text: messageOf(reason) }), [])
  const load = useCallback(async () => {
    const generation = ++draftGeneration.current
    const current = await getCurrentDynamicDraft()
    if (!mounted.current || generation !== draftGeneration.current) return
    dirty.current = false
    const next = current ?? createDynamicDraft()
    setDraft(next)
    setShowTitle(Boolean(next.title))
    setSaveState(current ? "saved" : "idle")
    setLoaded(true)
    if (next.selected[0]) setPlatform(next.selected[0])
  }, [])

  useEffect(() => {
    mounted.current = true
    void load().catch(report)
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[STORAGE_KEYS.dynamicDraftRevision]) {
        // A newly imported task replaces pending edits from the previous draft.
        dirty.current = false
        void load().catch(report)
      }
    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => {
      mounted.current = false
      draftGeneration.current += 1
      chrome.storage.onChanged.removeListener(onStorage)
      if (dirty.current && draftRef.current) void saveCurrentDynamicDraft(draftRef.current).catch(report)
    }
  }, [load, report])

  useEffect(() => {
    if (!draft || !dirty.current) return
    setSaveState("pending")
    const generation = draftGeneration.current
    const timer = window.setTimeout(() => {
      const value = draftRef.current
      if (!value || !dirty.current || generation !== draftGeneration.current) return
      dirty.current = false
      void saveCurrentDynamicDraft(value).then(() => {
        if (mounted.current && !dirty.current) setSaveState("saved")
      }).catch(reason => { dirty.current = true; report(reason) })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [draft, report])

  const mediaKey = draft?.media.map(item => item.id).join(",") ?? ""
  useEffect(() => {
    let cancelled = false
    void Promise.all((mediaKey ? mediaKey.split(",") : []).map(async id => {
      const stored = await getStoredAsset(id)
      return stored ? [id, URL.createObjectURL(new Blob([stored.bytes], { type: stored.mimeType }))] as const : null
    })).then(entries => {
      const next = new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null))
      if (cancelled) { next.forEach(url => URL.revokeObjectURL(url)); return }
      urlsRef.current.forEach(url => URL.revokeObjectURL(url))
      urlsRef.current = next
      setAssetUrls(next)
    }).catch(report)
    return () => { cancelled = true }
  }, [mediaKey, report])
  useEffect(() => () => { urlsRef.current.forEach(url => URL.revokeObjectURL(url)) }, [])

  useEffect(() => {
    if (!previewMedia && !topicOpen) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPreviewMedia(null); setTopicOpen(false) }
    }
    document.addEventListener("keydown", escape)
    return () => document.removeEventListener("keydown", escape)
  }, [previewMedia, topicOpen])

  const update = (patch: Partial<DynamicDraft>) => {
    dirty.current = true
    setDraft(current => current ? { ...current, ...patch, updatedAt: new Date().toISOString() } : current)
  }
  const content = useMemo(() => {
    if (!draft) return { title: "", body: "", tags: [] as string[] }
    return draft.mode === "per-platform" ? draft.variants[platform] ?? { title: draft.title, body: draft.body, tags: draft.tags } : draft
  }, [draft, platform])
  const updateContent = (patch: { title?: string; body?: string; tags?: string[] }) => {
    if (!draft) return
    if (draft.mode === "per-platform") update({ variants: { ...draft.variants, [platform]: { ...content, ...patch } } })
    else update(patch)
  }
  const switchMode = (mode: DynamicDraft["mode"]) => {
    if (!draft || draft.mode === mode) return
    if (mode === "per-platform") {
      const variants = { ...draft.variants }
      for (const id of DYNAMIC_PLATFORM_IDS) variants[id] ??= { title: draft.title, body: draft.body, tags: [...draft.tags] }
      update({ mode, variants })
    } else update({ mode })
  }
  const media = useMemo(() => {
    if (!draft) return []
    const ids = draft.mode === "per-platform" ? draft.variants[platform]?.mediaIds : undefined
    return ids ? ids.map(id => draft.media.find(item => item.id === id)).filter((item): item is DynamicMedia => Boolean(item)) : draft.media
  }, [draft, platform])

  const flush = async () => {
    const value = draftRef.current
    if (!value) return
    await saveCurrentDynamicDraft(value)
    if (draftRef.current === value) {
      dirty.current = false
      setSaveState("saved")
    }
  }
  const addFiles = async (files: File[]) => {
    if (!files.length || importPending.current || !draftRef.current) return
    importPending.current = true
    const generation = draftGeneration.current
    const replacingId = replacingVideo.current
    replacingVideo.current = null
    setImporting(true)
    onNotice(null)
    try {
      const current = draftRef.current
      const incomingVideo = files.some(file => file.type.startsWith("video/") || /\.(?:mp4|mov|webm|m4v)$/i.test(file.name))
      if ((incomingVideo && (files.length > 1 || current.media.some(item => item.id !== replacingId))) || (!incomingVideo && current.media.some(item => item.kind === "video"))) {
        throw new Error("图片和视频请分开发送，先移除现有素材再添加另一种类型")
      }
      const imported = await importDynamicMedia(files)
      if (!mounted.current || generation !== draftGeneration.current) return
      const applyImport = (value: DynamicDraft): DynamicDraft => {
        const all = value.media.filter(item => item.id !== replacingId)
        for (const item of imported.media) if (!all.some(existing => existing.id === item.id)) all.push(item)
        const next: DynamicDraft = { ...value, media: all, updatedAt: new Date().toISOString(), variants: { ...value.variants } }
        if (replacingId && imported.media[0]) {
          const replacementId = imported.media[0].id
          for (const id of DYNAMIC_PLATFORM_IDS) {
            const variant = next.variants[id]
            if (variant?.mediaIds) next.variants[id] = { ...variant, mediaIds: variant.mediaIds.map(id => id === replacingId ? replacementId : id) }
          }
        }
        if (next.mode === "per-platform") {
          const variant = next.variants[platform]
          if (variant?.mediaIds) next.variants[platform] = { ...variant, mediaIds: [...new Set([...variant.mediaIds, ...imported.media.map(item => item.id)])] }
        }
        return next
      }
      const latest = draftRef.current ?? current
      const next = applyImport(latest)
      await saveCurrentDynamicDraft(next, imported.assets)
      if (!mounted.current || generation !== draftGeneration.current) return
      const latestAfterSave = draftRef.current
      if (latestAfterSave && latestAfterSave !== latest) {
        // Keep text and platform edits made while IndexedDB stored the media.
        dirty.current = true
        setDraft(applyImport(latestAfterSave))
      } else {
        dirty.current = false
        setDraft(next)
        setSaveState("saved")
      }
      if (replacingId) setPreviewMedia(null)
    } catch (reason) { if (mounted.current && generation === draftGeneration.current) report(reason) }
    finally {
      importPending.current = false
      if (mounted.current) setImporting(false)
      if (imageInput.current) imageInput.current.value = ""
      if (videoInput.current) videoInput.current.value = ""
    }
  }
  const removeMedia = (id: string) => {
    if (!draft || importing) return
    if (draft.mode === "per-platform") {
      const variant = draft.variants[platform] ?? { title: draft.title, body: draft.body, tags: draft.tags }
      update({ variants: { ...draft.variants, [platform]: { ...variant, mediaIds: media.filter(item => item.id !== id).map(item => item.id) } } })
      if (previewMedia?.id === id) setPreviewMedia(null)
      return
    }
    const variants = { ...draft.variants }
    for (const key of DYNAMIC_PLATFORM_IDS) {
      const variant = variants[key]
      if (variant?.mediaIds) variants[key] = { ...variant, mediaIds: variant.mediaIds.filter(value => value !== id) }
    }
    update({ media: draft.media.filter(item => item.id !== id), variants })
    if (previewMedia?.id === id) setPreviewMedia(null)
  }
  const moveMedia = (from: string, to: string) => {
    if (!draft || importing || from === to) return
    if (draft.mode === "per-platform") {
      const nextIds = media.map(item => item.id)
      const fromIndex = nextIds.indexOf(from)
      const toIndex = nextIds.indexOf(to)
      if (fromIndex < 0 || toIndex < 0) return
      nextIds.splice(fromIndex, 1)
      nextIds.splice(toIndex, 0, from)
      update({ variants: { ...draft.variants, [platform]: { ...content, mediaIds: nextIds } } })
      return
    }
    const next = [...draft.media]
    const fromIndex = next.findIndex(item => item.id === from)
    const toIndex = next.findIndex(item => item.id === to)
    if (fromIndex < 0 || toIndex < 0) return
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item!)
    update({ media: next })
  }
  const dropFiles = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (!draggedMedia) void addFiles(Array.from(event.dataTransfer.files))
    setDraggedMedia(null)
  }
  const addTopic = () => {
    const value = topic.trim().replace(/^#+|#+$/g, "").trim()
    if (!value) return
    updateContent({ tags: [...new Set([...content.tags, value])] })
    setTopic("")
    setTopicOpen(false)
    bodyInput.current?.focus()
  }
  const limit = access?.maxTargets === null ? null : Math.max(1, access?.maxTargets ?? 1)
  const togglePlatform = (id: DynamicPlatformId) => {
    if (!draft) return
    onNotice(null)
    if (draft.selected.includes(id)) { update({ selected: draft.selected.filter(value => value !== id) }); return }
    const wanted = [...draft.selected, id]
    if (limit !== null && wanted.length > limit) { onUpgrade(wanted); return }
    update({ selected: wanted })
  }
  const selectLoggedIn = () => {
    const selected = DYNAMIC_PLATFORM_IDS.filter(id => accounts?.[id]?.state === "logged_in")
    if (!selected.length) return
    if (limit !== null && selected.length > limit) { onUpgrade(selected); return }
    update({ selected })
  }
  const errors = draft ? getDynamicValidationErrors(draft) : []
  const matchingTask = task?.targets?.some(id => (DYNAMIC_PLATFORM_IDS as readonly string[]).includes(id)) && task.draftId === draft?.id ? task : null
  const start = async () => {
    if (!draft) return
    if (!auth?.user || !access || access.maxTargets === 0) { onLogin(); return }
    if (limit !== null && draft.selected.length > limit) { onUpgrade(draft.selected); return }
    if (errors.length) { onNotice({ tone: "error", text: errors[0]! }); return }
    setSyncing(true)
    onNotice(null)
    try {
      await flush()
      const response = await chrome.runtime.sendMessage({ type: "START_DYNAMIC_SYNC", targets: draft.selected }) as ExtensionResponse<TaskSummary>
      if (!response?.ok || !response.value) throw new Error(response?.error ?? "动态同步启动失败")
      onTaskStarted?.(response.value)
    } catch (reason) { report(reason) }
    finally { setSyncing(false) }
  }
  const startNewContent = async () => {
    const current = draftRef.current
    if (!current || importing || syncing) return
    if (hasDynamicContent(current) && !window.confirm("开始新内容会清空当前文案、话题和素材，已勾选的平台会保留。确定继续吗？")) return
    const next = nextDynamicDraft(current)
    // Invalidate pending saves and imports that belong to the previous draft.
    draftGeneration.current += 1
    dirty.current = false
    setDraft(next)
    setShowTitle(false)
    setPlatform(next.selected[0] ?? "xiaohongshu")
    setPreviewMedia(null)
    setTopic("")
    setTopicOpen(false)
    onNotice(null)
    try {
      await saveCurrentDynamicDraft(next)
      if (mounted.current && draftRef.current === next) setSaveState("idle")
    } catch (reason) { dirty.current = true; report(reason) }
  }
  const characters = Array.from(content.body).length
  const xCharacters = xPostWeightedLength(buildXPostText(content))
  const xSkipped = draft?.selected.includes("x-post") ? supportedXPostImages((draft.mode === "per-platform" && draft.variants["x-post"]?.mediaIds
    ? draft.media.filter(item => draft.variants["x-post"]!.mediaIds!.includes(item.id)) : draft.media).filter(item => item.kind === "image")).skipped.length : 0
  const hasVideo = media.some(item => item.kind === "video")
  const previewItem = media[0]
  const currentAccount = accounts?.[platform]
  const selected = draft?.selected ?? []
  const titleRequired = selected.includes("xiaohongshu") && (draft?.mode === "unified" || platform === "xiaohongshu")

  if (!loaded || !draft) return <section className="dc-loading"><LoaderCircle className="spin" /><span>正在恢复动态草稿…</span></section>

  return <div className="dynamic-composer">
    <div className="dc-intro">
      <div><h1>分享此刻的灵感</h1><p>写一份内容，让每个平台都有合适的表达。</p></div>
      {draft.source.kind === "obsidian" ? <span className="dc-source"><Sparkles />已从 Obsidian 导入<span title={draft.source.vaultPath}>{draft.source.vaultPath.split(/[\\/]/).pop()}</span></span> : <span className="dc-autosave"><span />在浏览器中独立创作 · 自动保存</span>}
    </div>

    <div className={`dc-workspace ${previewOpen ? "has-preview" : ""}`}>
      <section className="dc-editor" aria-label="动态编辑器">
        <div className="dc-editor-header">
          <div className="dc-mode" aria-label="文案编辑方式">
            <button className={draft.mode === "unified" ? "is-active" : ""} onClick={() => switchMode("unified")}>统一文案</button>
            <button className={draft.mode === "per-platform" ? "is-active" : ""} onClick={() => switchMode("per-platform")}>分平台编辑</button>
          </div>
          <div className="dc-editor-header-actions"><span className="dc-editor-hint">{draft.mode === "unified" ? "所有平台共用这份内容" : "各平台文案独立保存"}</span><button className={`dc-preview-toggle ${previewOpen ? "is-active" : ""}`} aria-expanded={previewOpen} onClick={() => setPreviewOpen(value => !value)}><Eye />{previewOpen ? "收起预览" : "效果预览"}</button></div>
        </div>
        {draft.mode === "per-platform" ? <div className="dc-platform-tabs" role="tablist" aria-label="切换平台文案">
          {DYNAMIC_PLATFORM_IDS.map(id => <button key={id} className={platform === id ? "is-active" : ""} role="tab" aria-selected={platform === id} onClick={() => setPlatform(id)}><PlatformMark id={id} small />{BRAND[id].name}</button>)}
        </div> : null}
        <div className="dc-writing">
          {showTitle || content.title || platform === "xiaohongshu" ? <label className="dc-title"><input aria-label="动态标题" value={content.title} onChange={event => updateContent({ title: event.target.value })} placeholder={titleRequired ? "给这条笔记加一个标题" : "加一个标题（选填）"} /><small>{Array.from(content.title).length}{platform === "xiaohongshu" ? " / 20" : ""}</small></label> : <button className="dc-add-title" onClick={() => setShowTitle(true)}>＋ 添加标题</button>}
          <textarea ref={bodyInput} aria-label="动态正文" value={content.body} onChange={event => updateContent({ body: event.target.value })} placeholder={draft.mode === "per-platform" ? `写给${BRAND[platform].name}的朋友们…` : "有什么值得分享的新鲜事？\n写下你的想法，添加图片或视频，让灵感被看见。"} />
          {content.tags.length ? <div className="dc-topics">{content.tags.map(tag => <span key={tag}>#{tag}<button aria-label={`移除话题${tag}`} onClick={() => updateContent({ tags: content.tags.filter(value => value !== tag) })}><X /></button></span>)}</div> : null}
          <div className="dc-writing-meta"><span>{draft.mode === "per-platform" ? BRAND[platform].caption : "文字、图片或视频，自由表达"}</span><span className={draft.mode === "per-platform" && platform === "x-post" && xCharacters > X_POST_TEXT_LIMIT ? "is-over-limit" : ""}>{draft.mode === "per-platform" && platform === "x-post" ? `${xCharacters} / ${X_POST_TEXT_LIMIT} 字符` : `${characters} 字`}</span></div>
        </div>

        <div className={`dc-media-zone ${dragging ? "is-dragging" : ""}`} onDragOver={event => { if (!draggedMedia) { event.preventDefault(); setDragging(true) } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={dropFiles}>
          <div className="dc-media-toolbar">
            <div className="dc-media-actions">
              <button onClick={() => imageInput.current?.click()} disabled={importing || hasVideo} title={hasVideo ? "先移除视频再添加图片" : "添加图片"}><ImagePlus />添加图片</button>
              <button onClick={() => videoInput.current?.click()} disabled={importing || media.length > 0} title={media.length ? "先移除现有素材再添加视频" : "添加视频"}><Video />添加视频</button>
              <div className="dc-topic-anchor"><button aria-expanded={topicOpen} onClick={() => setTopicOpen(value => !value)}><Hash />添加话题</button>
                {topicOpen ? <div className="dc-topic-popover"><label>添加话题<input autoFocus aria-label="话题名称" value={topic} onChange={event => setTopic(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTopic() } }} placeholder="例如：我的创作日常" maxLength={80} /></label><button disabled={!topic.trim()} onClick={addTopic}>添加</button></div> : null}
              </div>
            </div>
            {importing ? <span className="dc-media-count"><LoaderCircle className="spin" />正在读取素材</span> : media.length ? <span className="dc-media-count">{hasVideo ? "1 个视频" : `${media.length} 张图片`}</span> : null}
          </div>
          <input ref={imageInput} hidden type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={event => void addFiles(Array.from(event.target.files ?? []))} />
          <input ref={videoInput} hidden type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" onChange={event => void addFiles(Array.from(event.target.files ?? []))} />
          {!media.length ? <button className="dc-drop-empty" onClick={() => imageInput.current?.click()} disabled={importing}><span><Upload /></span><div><strong>{dragging ? "松开即可添加素材" : "拖入图片或视频，给动态多一点画面"}</strong><small>支持本地素材 · 图片与视频分开发送</small></div></button> : hasVideo ? <div className="dc-video-card">
            {media.map(item => <div className="dc-video-item" key={item.id}>
              <button className="dc-video-thumbnail" onClick={() => setPreviewMedia(item)} aria-label={`预览视频${item.fileName}`}>{assetUrls.get(item.id) ? <video src={assetUrls.get(item.id)} preload="metadata" muted /> : <FileVideo2 />}<span><Play /></span></button>
              <div className="dc-video-copy"><strong title={item.fileName}>{item.fileName}</strong><small>{[durationText(item.duration), fileSize(item.size), item.mimeType.split("/")[1]?.toUpperCase()].filter(Boolean).join(" · ")}</small><span>同步后请在平台编辑页检查视频与封面</span></div>
              <div className="dc-video-controls"><button className="dc-video-replace" disabled={importing} onClick={() => { replacingVideo.current = item.id; videoInput.current?.click() }}><RefreshCw />更换</button><button className="dc-icon-button" aria-label="移除视频" disabled={importing} onClick={() => removeMedia(item.id)}><Trash2 /></button></div>
            </div>)}
          </div> : <div className="dc-image-grid">
            {media.map((item, index) => <div key={item.id} className={`dc-image-item ${draggedMedia === item.id ? "is-moving" : ""}`} draggable onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); setDraggedMedia(item.id) }} onDragEnd={() => setDraggedMedia(null)} onDragOver={event => { if (draggedMedia) { event.preventDefault(); event.dataTransfer.dropEffect = "move" } }} onDrop={event => { if (draggedMedia) { event.preventDefault(); event.stopPropagation(); moveMedia(draggedMedia, item.id); setDraggedMedia(null) } }}>
              <button className="dc-image-preview" onClick={() => setPreviewMedia(item)} aria-label={`预览第${index + 1}张图片`}><img src={assetUrls.get(item.id)} alt={item.fileName} draggable={false} /></button><span className="dc-image-number">{index === 0 ? "封面" : index + 1}</span>
              <button className="dc-image-remove" aria-label={`移除图片${item.fileName}`} onClick={() => removeMedia(item.id)}><X /></button>
              <div className="dc-image-order"><button aria-label={`前移第${index + 1}张图片`} disabled={index === 0} onClick={() => moveMedia(item.id, media[index - 1]!.id)}><ArrowLeft /></button><button aria-label={`后移第${index + 1}张图片`} disabled={index === media.length - 1} onClick={() => moveMedia(item.id, media[index + 1]!.id)}><ArrowRight /></button></div>
            </div>)}
            <button className="dc-image-add" aria-label="继续添加图片" onClick={() => imageInput.current?.click()} disabled={importing}><ImagePlus /><small>添加图片</small></button>
          </div>}
          {media.length && !hasVideo ? <p className="dc-media-help">{draft.mode === "per-platform" ? "仅调整当前平台的素材，拖动图片可排序。" : "拖动图片调整顺序，第一张作为封面。"}</p> : null}
        </div>
      </section>

      {previewOpen ? <aside className="dc-preview" aria-label="动态效果预览">
        <div className="dc-preview-heading"><strong>效果预览</strong><span>以平台实际效果为准</span></div>
        <div className="dc-preview-platforms" role="tablist" aria-label="预览平台">{DYNAMIC_PLATFORM_IDS.map(id => <button key={id} role="tab" aria-selected={platform === id} className={platform === id ? "is-active" : ""} onClick={() => setPlatform(id)}><PlatformMark id={id} small />{BRAND[id].name}</button>)}</div>
        <div className={`dc-preview-card is-${platform}`}>
          {previewItem ? <div className={`dc-preview-visual ${hasVideo ? "is-video" : ""}`} onClick={() => setPreviewMedia(previewItem)} role="button" tabIndex={0} onKeyDown={event => { if (event.key === "Enter") setPreviewMedia(previewItem) }} aria-label="预览动态素材">{hasVideo ? <><video src={assetUrls.get(previewItem.id)} muted preload="metadata" /><span className="dc-preview-play"><Play /></span><small>{durationText(previewItem.duration) || "视频"}</small></> : <><img src={assetUrls.get(previewItem.id)} alt="动态封面预览" />{media.length > 1 ? <span className="dc-preview-image-count">1 / {media.length}</span> : null}</>}</div> : <div className="dc-preview-placeholder"><span><ImagePlus /></span><small>你的内容，即将在这里呈现</small></div>}
          <div className="dc-preview-body"><div className="dc-preview-author">{currentAccount?.avatar ? <img src={currentAccount.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="dc-preview-avatar">{(currentAccount?.name || auth?.user?.nickname || "我").slice(0, 1)}</span>}<strong>{currentAccount?.name || auth?.user?.nickname || "你的账号"}</strong><span>刚刚</span></div>{content.title ? <h3>{content.title}</h3> : null}<p className={!content.body ? "is-placeholder" : ""}>{content.body || "在左侧写下你的想法，预览会实时更新。"}</p>{content.tags.length ? <div className="dc-preview-tags">{content.tags.map(tag => <span key={tag}>#{tag}</span>)}</div> : null}</div>
        </div>
        <p className="dc-preview-note"><Info />预览帮助你检查内容与图片，发布前仍可在平台编辑页调整。</p>
      </aside> : null}
    </div>

    <section className="dc-platform-section" aria-label="选择动态发布平台">
      <div className="dc-platform-heading"><div><h2>发布到哪里<span>已选 {selected.length} 个</span></h2><p>使用浏览器中已登录的账号，轻松同步。</p></div><div className="dc-platform-tools"><button onClick={() => void startNewContent()} disabled={importing || syncing} title="清空当前内容，开始写一条新动态"><RotateCcw />新内容</button><button onClick={onRefreshAccounts} disabled={checkingAccounts}><RefreshCw className={checkingAccounts ? "spin" : ""} />{checkingAccounts ? "检测中" : "检测登录"}</button><button onClick={selectLoggedIn}>全选已登录</button></div></div>
      <div className="dc-platform-grid">{DYNAMIC_PLATFORM_IDS.map(id => {
        const account = accounts?.[id] ?? { state: "unknown" }
        const active = selected.includes(id)
        const state = matchingTask?.targets?.includes(id) ? matchingTask.platforms[id] : null
        const openingLogin = openingPlatformLogins.includes(id)
        const hasCircle = id === "jike-post" && active
        const loginButton = <button disabled={openingLogin} onClick={() => onPlatformLogin(id)}>{openingLogin ? "正在打开…" : "去登录"}{openingLogin ? <LoaderCircle className="spin" /> : <ExternalLink />}</button>
        return <div key={id} className={`dc-platform ${active ? "is-selected" : ""}`}><div className={`dc-platform-row ${hasCircle ? "has-circle" : ""}`}><label className="dc-platform-account"><input type="checkbox" checked={active} onChange={() => togglePlatform(id)} /><span className="dc-check">{active ? <Check /> : null}</span><PlatformMark id={id} /><span className="dc-platform-name"><strong>{BRAND[id].name}</strong><small>{account.state === "logged_in" ? account.name ? `@${account.name}` : "已登录账号" : account.state === "login_required" ? "未登录" : "暂未确认登录状态"}</small></span></label>{hasCircle ? <label className="dc-circle"><span>发布圈子</span><input aria-label="即刻发布圈子" value={draft.jikeCircle} placeholder="选填圈子名称" onChange={event => update({ jikeCircle: event.target.value })} /></label> : null}<div className="dc-platform-status">{state ? <span className={`is-${state.status}`}>{state.status === "ready" ? <CheckCircle2 /> : ["failed", "login_required"].includes(state.status) ? <AlertCircle /> : <LoaderCircle className="spin" />}{STATUS[state.status]}</span> : account.state === "logged_in" ? <span className="is-online"><i />已登录</span> : loginButton}</div></div>
          {state ? <div className="dc-task-detail">{state.message ? <p className={`is-${state.status}`}>{state.message}</p> : null}{state.warnings.length ? <p>{state.warnings.join("；")}</p> : null}<div>{state.status === "login_required" ? loginButton : ["ready", "filling", "failed"].includes(state.status) ? <button onClick={() => onPlatformAction(id, "open")}>打开编辑页<ExternalLink /></button> : null}{state.status === "failed" && account.state !== "logged_in" ? loginButton : null}{["failed", "login_required"].includes(state.status) ? <button onClick={() => onPlatformAction(id, "retry")}>重试</button> : null}</div></div> : null}
        </div>
      })}</div>
      {selected.includes("x-post") ? <div className="dc-x-hint"><Info /><span>X 动态支持最多 4 张图片，单张不超过 5 MB；普通动态最多 280 字符（中文通常计 2）；话题默认不同步到 X，需要的话可直接在正文里写 #话题。{xSkipped ? `已自动跳过 X 不支持格式的 ${xSkipped} 张图片，其他平台仍保留。` : "支持 PNG、JPEG、WebP 图片。"}</span></div> : null}
      {errors.length && (content.body.trim() || media.length) ? <div className="dc-validation" role="status"><Info /><span>{errors.join("；")}</span></div> : null}
      <div className="dc-publish-note"><Info />同步后在各平台编辑页确认发布，扩展不会自动点击发布。</div>
    </section>

    <footer className="dc-action-bar"><div className="dc-selected-summary"><span>已选择 <strong>{selected.length}</strong> 个平台</span><div>{selected.map(id => <button key={id} onClick={() => togglePlatform(id)}>{BRAND[id].name}<X /></button>)}</div></div><div className="dc-footer-actions"><span className="dc-save-status">{saveState === "pending" ? "正在自动保存…" : saveState === "saved" ? "草稿已保存在本地" : "灵感随时记录"}</span><button className="dc-save-button" disabled={importing || syncing} onClick={() => void flush().catch(report)}><Save />保存草稿</button><button className="dc-sync-button" disabled={syncing || importing} onClick={() => void start()}>{syncing ? <LoaderCircle className="spin" /> : <Send />}{syncing ? "正在准备…" : `开始同步${selected.length ? ` · ${selected.length} 个平台` : ""}`}</button></div></footer>

    {previewMedia ? <div className="dc-media-modal" role="dialog" aria-modal="true" aria-label="素材预览" onClick={() => setPreviewMedia(null)}><button className="dc-media-modal-close" aria-label="关闭素材预览" autoFocus onClick={() => setPreviewMedia(null)}><X /></button><div onClick={event => event.stopPropagation()}>{previewMedia.kind === "video" ? <video src={assetUrls.get(previewMedia.id)} controls autoPlay /> : <img src={assetUrls.get(previewMedia.id)} alt={previewMedia.fileName} />}<p>{previewMedia.fileName}</p></div></div> : null}
  </div>
}
