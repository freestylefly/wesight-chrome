import { sha256 } from "~lib/crypto"
import { buildXPostText, supportedXPostImages, xPostTextError, X_POST_IMAGE_LIMIT, X_POST_IMAGE_BYTES } from "~lib/x-post-content"
import type { StoredAsset } from "~lib/draft-store"
import { DYNAMIC_PLATFORM_IDS, MAX_ASSET_BYTES, MAX_TASK_BYTES, MAX_VIDEO_BYTES, TASK_TTL_MS, type DynamicPlatformId, type PublishAssetV1, type PublishTaskV1 } from "~types/protocol"

export { DYNAMIC_PLATFORM_IDS, type DynamicPlatformId } from "~types/protocol"
export { getCurrentDynamicDraft, saveCurrentDynamicDraft } from "~lib/draft-store"

export interface DynamicMedia extends PublishAssetV1 {
  kind: "image" | "video"
  duration?: number
  width?: number
  height?: number
}
export interface DynamicCopy { title: string; body: string; tags: string[]; mediaIds?: string[] }
export interface DynamicDraft {
  id: string
  source: { kind: "manual" } | { kind: "obsidian"; vaultPath: string }
  mode: "unified" | "per-platform"
  title: string
  body: string
  tags: string[]
  media: DynamicMedia[]
  variants: Partial<Record<DynamicPlatformId, DynamicCopy>>
  selected: DynamicPlatformId[]
  jikeCircle: string
  updatedAt: string
  importedAt?: string
}

export function createDynamicDraft(): DynamicDraft {
  return { id: crypto.randomUUID(), source: { kind: "manual" }, mode: "unified", title: "", body: "", tags: [], media: [], variants: {}, selected: [], jikeCircle: "", updatedAt: new Date().toISOString() }
}

/** Starts a blank draft for the next post while keeping the chosen platforms. */
export function nextDynamicDraft(previous: DynamicDraft): DynamicDraft {
  return { ...createDynamicDraft(), selected: [...previous.selected] }
}

export function hasDynamicContent(draft: DynamicDraft): boolean {
  const copies = [draft, ...Object.values(draft.variants)]
  return draft.media.length > 0 || copies.some(copy => copy && (copy.title.trim() || copy.body.trim() || copy.tags.length))
}

export function dynamicVariant(draft: DynamicDraft, platformId: DynamicPlatformId): DynamicCopy {
  const shared = { title: draft.title, body: draft.body, tags: draft.tags, mediaIds: draft.media.map(item => item.id) }
  return draft.mode === "per-platform" ? draft.variants[platformId] ?? shared : shared
}

export function getDynamicValidationErrors(draft: DynamicDraft, targets = draft.selected): string[] {
  const errors: string[] = []
  if (!targets.length) errors.push("请至少选择一个同步平台")
  if (targets.some(target => !DYNAMIC_PLATFORM_IDS.includes(target))) errors.push("包含不支持的动态平台")
  const ids = new Set(draft.media.map(item => item.id))
  if (ids.size !== draft.media.length) errors.push("附件重复，请移除重复附件")
  const videos = draft.media.filter(item => item.kind === "video")
  if (videos.length > 1 || (videos.length && draft.media.length !== 1)) errors.push("一次动态可添加多张图片或一个视频，请分别同步")
  if (draft.media.some(item => !item.size || item.size > (item.kind === "video" ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES))) errors.push("附件大小超限：图片不超过 10 MB，视频不超过 200 MB")
  if (!videos.length && draft.media.reduce((sum, item) => sum + item.size, 0) > MAX_TASK_BYTES) errors.push("图片总大小不能超过 100 MB")
  for (const platformId of new Set(targets)) {
    const copy = dynamicVariant(draft, platformId)
    const media = copy.mediaIds ? copy.mediaIds.map(id => draft.media.find(item => item.id === id)).filter((item): item is DynamicMedia => !!item) : draft.media
    if (copy.mediaIds?.some(id => !ids.has(id))) errors.push("平台引用的附件不存在，请重新选择")
    if (copy.mediaIds && new Set(copy.mediaIds).size !== copy.mediaIds.length) errors.push("平台图片不能重复选择")
    if (platformId !== "x-post" && media.filter(item => item.kind === "image").length > 9) errors.push("每个平台当前最多同步 9 张图片")
    if (!copy.body.trim() && !media.length && (platformId !== "x-post" || !buildXPostText(copy))) errors.push("请填写动态正文或添加附件")
    if (platformId === "x-post") {
      const text = buildXPostText(copy)
      const textError = xPostTextError(text)
      if (textError) errors.push(textError)
      if (media.some(item => item.kind === "video")) errors.push("X 动态当前支持文字和图片；视频请取消勾选 X 后同步")
      const plan = supportedXPostImages(media.filter(item => item.kind === "image"))
      if (plan.images.length > X_POST_IMAGE_LIMIT) errors.push(`X 动态最多 ${X_POST_IMAGE_LIMIT} 张图片，请在分平台编辑中为 X 调整图片`)
      if (plan.images.some(item => item.size > X_POST_IMAGE_BYTES)) errors.push("X 动态单张图片不能超过 5 MB")
      if (!text && !plan.images.length) errors.push("X 动态需要文字或支持格式的图片")
    }
    if (platformId === "xiaohongshu") {
      if (!copy.title.trim()) errors.push("小红书需要填写标题")
      if (Array.from(copy.title).length > 20) errors.push("小红书标题最多 20 字")
      if (!media.length) errors.push("小红书需要添加图片或视频")
      const xhsText = [copy.body.trim(), copy.tags.map(tag => tag.replace(/^#+|#+$/g, "").trim()).filter(Boolean).map(tag => `#${tag}`).join(" ")].filter(Boolean).join("\n\n")
      if (Array.from(xhsText).length > 1000) errors.push("小红书正文最多 1000 字")
    }
    const weiboText = [copy.body.trim(), copy.tags.map(tag => tag.replace(/^#+|#+$/g, "").trim()).filter(Boolean).map(tag => `#${tag}#`).join(" ")].filter(Boolean).join("\n\n")
    if (platformId === "weibo-post" && Array.from(weiboText).length > 2000) errors.push("微博正文和话题合计最多 2000 字")
    if (platformId === "jike-post" && Array.from(copy.body).length > 2000) errors.push("即刻正文最多 2000 字")
  }
  return [...new Set(errors)]
}

function readVideoMetadata(file: File): Promise<Pick<DynamicMedia, "duration" | "width" | "height">> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    const cleanup = () => { clearTimeout(timer); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url) }
    const timer = setTimeout(() => { cleanup(); reject(new Error("无法读取视频信息，请使用浏览器可播放的视频")) }, 15_000)
    video.preload = "metadata"
    video.onloadedmetadata = () => { const info = { duration: video.duration, width: video.videoWidth, height: video.videoHeight }; cleanup(); Number.isFinite(info.duration) && info.duration > 0 ? resolve(info) : reject(new Error("视频时长无效")) }
    video.onerror = () => { cleanup(); reject(new Error("无法读取视频，请更换为浏览器可播放的 MP4 文件")) }
    video.src = url
  })
}

export async function importDynamicMedia(files: File[]): Promise<{ media: DynamicMedia[]; assets: StoredAsset[] }> {
  if (!files.length) return { media: [], assets: [] }
  const isVideo = (file: File) => file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name)
  if (files.some(isVideo) && files.length !== 1) throw new Error("请单独选择一个视频，或选择多张图片")
  const media: DynamicMedia[] = [], assets: StoredAsset[] = []
  for (const file of files) {
    const kind = isVideo(file) ? "video" : "image"
    if (!file.size || file.size > (kind === "video" ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES)) throw new Error(kind === "video" ? "视频需大于 0 且不超过 200 MB" : "图片需大于 0 且不超过 10 MB")
    if (kind === "image" && !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("请选择 PNG、JPEG、WebP、GIF 图片或视频")
    const metadata = kind === "video" ? await readVideoMetadata(file) : {}
    const bytes = await file.arrayBuffer()
    const id = await sha256(bytes)
    const mimeType = file.type || (/\.webm$/i.test(file.name) ? "video/webm" : /\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4")
    if (media.some(item => item.id === id)) continue
    media.push({ id, sha256: id, fileName: file.name, mimeType, size: bytes.byteLength, kind, ...metadata })
    assets.push({ id, mimeType, bytes })
  }
  return { media, assets }
}

export function dynamicDraftFromTask(task: PublishTaskV1): DynamicDraft {
  const draft = createDynamicDraft()
  const textBody = (html: string, fallback: string) => {
    // This conversion is also used in a service worker without DOMParser.
    const withoutImages = fallback.replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim()
    return withoutImages || html.replace(/<img\b[^>]*>/gi, "").replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim()
  }
  const selected = task.targets.filter((id): id is DynamicPlatformId => DYNAMIC_PLATFORM_IDS.includes(id as DynamicPlatformId))
  const variants: DynamicDraft["variants"] = {}
  for (const id of selected) {
    const payload = task.targetPayloads?.[id]
    const article = payload?.article ?? task.article
    const title = id === "x-post" && (payload?.targetOptions ?? task.targetOptions)?.xPost?.includeTitle === false ? "" : article.title
    variants[id] = { title, body: textBody(article.html, article.markdown), tags: [...article.tags], mediaIds: payload?.assetIds ?? task.assets.map(asset => asset.id) }
  }
  return { ...draft, source: { kind: "obsidian", vaultPath: task.source.vaultPath }, mode: "per-platform", title: task.article.title,
    body: textBody(task.article.html, task.article.markdown), tags: task.article.tags, selected, variants,
    media: task.assets.map(asset => ({ ...asset, kind: asset.mimeType.startsWith("video/") ? "video" : "image" })),
    jikeCircle: task.targetPayloads?.["jike-post"]?.targetOptions?.jikePost?.circle ?? task.targetOptions?.jikePost?.circle ?? "", importedAt: new Date().toISOString() }
}

export function buildDynamicTask(draft: DynamicDraft, targets: DynamicPlatformId[], maxTargets: number | null, taskId = crypto.randomUUID()): PublishTaskV1 {
  // Share the membership gate while accepting the dynamic platform set.
  if (maxTargets === 0) throw new Error("请先登录 WeSight 后再同步平台")
  if (maxTargets !== null && new Set(targets).size > maxTargets) throw new Error("非会员仅支持一个平台")
  const errors = getDynamicValidationErrors(draft, targets)
  if (errors.length) throw new Error(errors[0])
  const selected = [...new Set(targets)]
  const payloads: NonNullable<PublishTaskV1["targetPayloads"]> = {}
  const used = new Set<string>()
  for (const id of selected) {
    const copy = dynamicVariant(draft, id)
    const media = copy.mediaIds ? copy.mediaIds.map(id => draft.media.find(item => item.id === id)).filter((item): item is DynamicMedia => !!item) : draft.media
    media.forEach(asset => used.add(asset.id))
    const imageIds = media.filter(asset => asset.kind === "image").map(asset => asset.id)
    const markdown = copy.body.trim()
    const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    const html = `<p>${escape(markdown).replace(/\n/g, "<br>")}</p>` + imageIds.map(assetId => `<p><img src="wesight-asset://${escape(assetId)}" alt="图片"></p>`).join("")
    payloads[id] = { article: { title: copy.title.trim() || "动态", digest: "", markdown, html, tags: [...copy.tags], coverAssetId: imageIds[0] ?? null },
      assetIds: media.map(asset => asset.id), ...(id === "jike-post" && draft.jikeCircle.trim() ? { targetOptions: { jikePost: { circle: draft.jikeCircle.trim() } } } : id === "x-post" ? { targetOptions: { xPost: { includeTitle: Boolean(copy.title.trim()) } } } : {}) }
  }
  const now = Date.now(), video = draft.media.find(asset => asset.kind === "video")
  return { protocolVersion: 1, taskId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + TASK_TTL_MS).toISOString(),
    source: { vaultPath: draft.source.kind === "obsidian" ? draft.source.vaultPath : "动态", contentHash: draft.id }, article: payloads[selected[0]!]!.article,
    assets: draft.media.filter(asset => used.has(asset.id)).map(({ kind: _kind, duration: _duration, width: _width, height: _height, ...asset }) => asset),
    targets: selected, targetPayloads: payloads, ...(video && used.has(video.id) ? { media: { videoAssetId: video.id } } : {}), behavior: { finalAction: "manual", groupTabs: true } }
}
