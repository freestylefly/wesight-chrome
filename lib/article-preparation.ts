import type { ComposeDraft } from "~lib/draft-store"
import { supportedXImages } from "~lib/x-image-policy"

export const X_IMAGE_LIMIT = 15

/** Only remove leading publication badges, never HTML examples later in the article. */
export function stripLeadingDecoration(markdown: string): string {
  let result = markdown.replace(/^\uFEFF/, "").trimStart()
  const badge = /^(?:<center\b[^>]*>[\s\S]*?<\/center>|<p\b[^>]*(?:text-align\s*:\s*center|align=["']?center)[^>]*>[\s\S]*?<\/p>|<span\b[^>]*style=["'][^"']*background[^"']*["'][^>]*>[\s\S]*?<\/span>)\s*/i
  while (true) {
    const match = badge.exec(result)
    if (!match) break
    const plain = match[0].replace(/<[^>]+>/g, "").trim()
    const styled = /<span\b[^>]*style=["'][^"']*background/i.test(match[0])
    const originalCount = /第\s*\d+\s*篇.*原创/.test(plain)
    if (!originalCount && !(styled && plain.length <= 120)) break
    result = result.slice(match[0].length).trimStart()
  }
  return result
}

export function stripLeadingHtmlDecoration(html: string): string {
  let result = stripLeadingDecoration(html)
  let prefix = ""
  // Link extractors often wrap the article in sections before its first badge.
  while (true) {
    const wrapper = /^\s*<(?:div|section|article)\b[^>]*>\s*/i.exec(result)
    if (!wrapper) break
    prefix += wrapper[0]
    result = result.slice(wrapper[0].length)
  }
  result = stripLeadingDecoration(result)
  // Obsidian's platform renderer escapes raw HTML. Remove the same leading
  // badge if it is wrapped as an escaped paragraph instead of a live element.
  while (true) {
    const paragraph = /^\s*<p\b[^>]*>([\s\S]*?)<\/p>\s*/i.exec(result)
    if (!paragraph || !/^\s*(?:&lt;|<)(?:center|span|p)\b/i.test(paragraph[1]!)) break
    const decoded = paragraph[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    const clean = stripLeadingDecoration(decoded)
    if (clean === decoded.trimStart()) break
    if (clean.trim()) {
      result = `<p>${clean.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>${result.slice(paragraph[0].length)}`
      break
    }
    result = result.slice(paragraph[0].length)
  }
  return prefix + result
}

export function imageSources(html: string): string[] {
  return Array.from(html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi), match => match[1] ?? match[2] ?? match[3] ?? "")
}

export function firstBodyAssetId(draft: Pick<ComposeDraft, "html" | "assets">): string | null {
  for (const source of imageSources(draft.html)) {
    const id = /^wesight-asset:\/\/([A-Za-z0-9_-]+)$/.exec(source)?.[1]
    if (id && draft.assets.some(asset => asset.id === id)) return id
  }
  return null
}

export function normalizeDraft(draft: ComposeDraft): ComposeDraft {
  const clean = {
    ...draft,
    markdown: stripLeadingDecoration(draft.markdown),
    html: stripLeadingHtmlDecoration(draft.html)
  }
  const coverSelection = draft.coverSelection ?? (draft.coverAssetId ? "custom" : "auto")
  return {
    ...clean, coverSelection,
    coverAssetId: coverSelection === "auto" ? firstBodyAssetId(clean) : coverSelection === "none" ? null : draft.coverAssetId
  }
}

export function xImagePlan(sources: readonly string[], cover: string | null) {
  const total = sources.length + (cover && !sources.includes(cover) ? 1 : 0)
  // A cover outside the retained body images needs its own upload slot.
  const separateCover = !!cover && !sources.slice(0, X_IMAGE_LIMIT).includes(cover)
  const bodyLimit = X_IMAGE_LIMIT - (separateCover ? 1 : 0)
  return { total, bodyLimit, separateCover, skipped: Math.max(0, sources.length - bodyLimit) }
}

export function xImageWarning(draft: ComposeDraft | null, selected: readonly string[], keepImages: boolean, skipExcessImages = false): string | null {
  if (!draft || !selected.includes("x-article")) return null
  const sources = keepImages ? imageSources(stripLeadingHtmlDecoration(draft.html)) : []
  const cover = draft.coverAssetId ? `wesight-asset://${draft.coverAssetId}` : null
  const supported = supportedXImages(sources, cover, draft.assets)
  const plan = xImagePlan(supported.sources, supported.cover)
  if (plan.total <= X_IMAGE_LIMIT) return null
  if (skipExcessImages) {
    return `X 将保留前 ${plan.bodyLimit} 张正文图片${plan.separateCover ? "和封面" : ""}，跳过其余 ${plan.skipped} 张，全部文字保留。`
  }
  return `X 文章最多上传 ${X_IMAGE_LIMIT} 张图片，当前有 ${plan.total} 张。可勾选右侧选项继续同步${plan.separateCover ? "（封面占用 1 个名额）" : ""}。`
}

export function xUnsupportedImageWarning(draft: ComposeDraft | null, selected: readonly string[], keepImages: boolean): string | null {
  if (!draft || !selected.includes("x-article")) return null
  const sources = keepImages ? imageSources(stripLeadingHtmlDecoration(draft.html)) : []
  const cover = draft.coverAssetId ? `wesight-asset://${draft.coverAssetId}` : null
  const supported = supportedXImages(sources, cover, draft.assets)
  if (!supported.skipped.size) return null
  return `X 将自动跳过 ${supported.skipped.size} 张不支持格式的图片（如 GIF），仅上传 PNG、JPEG、WebP，全部文字保留。${cover && !supported.cover ? "当前封面也将跳过，可更换为支持的图片。" : ""}`
}
