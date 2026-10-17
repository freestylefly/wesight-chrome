import { normalizeDraft, stripLeadingDecoration } from "~lib/article-preparation"
import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"

import { sanitizePlatformHtml } from "~lib/content"
import { sha256 } from "~lib/crypto"
import type { ComposeDraft, DraftSource, StoredAsset } from "~lib/draft-store"
import { assetToken, markdownToHtml } from "~lib/markdown"
import { MAX_ASSET_BYTES, MAX_TASK_BYTES, type PublishAssetV1 } from "~types/protocol"

export interface ImportedArticle {
  draft: ComposeDraft
  assets: StoredAsset[]
}

interface AssetCollector {
  assets: Map<string, { meta: PublishAssetV1; stored: StoredAsset }>
  warnings: string[]
  totalBytes: number
}

const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif)$/i
const MARKDOWN_EXTENSIONS = /\.(?:md|markdown|mdown|txt)$/i
const IMAGE_FETCH_CONCURRENCY = 4

function createCollector(): AssetCollector {
  return { assets: new Map(), warnings: [], totalBytes: 0 }
}

function newDraftId(): string {
  return crypto.randomUUID()
}

export function sniffImageMime(bytes: ArrayBuffer, fallback = ""): string {
  const head = new Uint8Array(bytes.slice(0, 12))
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png"
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg"
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image/gif"
  if (head[0] === 0x52 && head[1] === 0x49 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
    return "image/webp"
  }
  if (fallback.startsWith("image/")) return fallback
  return ""
}

function extensionFor(mimeType: string): string {
  const subtype = mimeType.split("/")[1] ?? "png"
  return subtype === "jpeg" ? "jpg" : subtype.replace(/\+.*$/, "")
}

/** Adds image bytes to the collector, returning the asset id or null when the image is rejected. */
async function addAsset(
  collector: AssetCollector,
  bytes: ArrayBuffer,
  declaredMime: string,
  fileName: string
): Promise<string | null> {
  const mimeType = sniffImageMime(bytes, declaredMime)
  if (!mimeType) {
    collector.warnings.push(`“${fileName}”不是可识别的图片，已跳过`)
    return null
  }
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    collector.warnings.push(`图片“${fileName}”超过 10 MB，已跳过`)
    return null
  }
  const id = await sha256(bytes)
  if (collector.assets.has(id)) return id
  if (collector.totalBytes + bytes.byteLength > MAX_TASK_BYTES) {
    collector.warnings.push("图片总大小超过 100 MB，其余图片已跳过")
    return null
  }
  const name = IMAGE_EXTENSIONS.test(fileName) ? fileName : `${fileName || "image"}.${extensionFor(mimeType)}`
  collector.totalBytes += bytes.byteLength
  collector.assets.set(id, {
    meta: { id, fileName: name, mimeType, size: bytes.byteLength, sha256: id },
    stored: { id, mimeType, bytes }
  })
  return id
}

function remoteFileName(url: URL): string {
  const format = url.searchParams.get("wx_fmt")
  const base = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "image")
  return format && !IMAGE_EXTENSIONS.test(base) ? `${base}.${format === "jpeg" ? "jpg" : format}` : base
}

async function downloadImage(collector: AssetCollector, rawUrl: string): Promise<string | null> {
  try {
    const url = new URL(rawUrl)
    const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const bytes = await response.arrayBuffer()
    return await addAsset(collector, bytes, response.headers.get("Content-Type") ?? "", remoteFileName(url))
  } catch {
    return null
  }
}

async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

function finishDraft(
  collector: AssetCollector,
  input: {
    source: DraftSource
    title: string
    digest: string
    markdown: string
    html: string
    coverAssetId: string | null
    tags?: string[]
    original?: boolean
  }
): ImportedArticle {
  const now = new Date().toISOString()
  const assets = Array.from(collector.assets.values())
  return {
    draft: normalizeDraft({
      id: newDraftId(),
      source: input.source,
      title: input.title.trim(),
      digest: input.digest.trim(),
      markdown: input.markdown,
      html: input.html,
      coverAssetId: input.coverAssetId,
      tags: input.tags ?? [],
      ...(input.original === undefined ? {} : { original: input.original }),
      assets: assets.map(asset => asset.meta),
      warnings: Array.from(new Set(collector.warnings)),
      importedAt: now,
      updatedAt: now
    }),
    assets: assets.map(asset => asset.stored)
  }
}

type FrontmatterValue = string | string[]

export function parseFrontmatter(source: string): { data: Record<string, FrontmatterValue>; body: string } {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized)
  if (!match) return { data: {}, body: normalized }
  const data: Record<string, FrontmatterValue> = {}
  let listKey: string | null = null
  const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, "$2")
  for (const line of match[1]!.split("\n")) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && listKey) {
      const current = data[listKey]
      data[listKey] = [...(Array.isArray(current) ? current : []), unquote(item[1]!)]
      continue
    }
    const pair = /^([^:\s][^:]*):\s*(.*)$/.exec(line)
    if (!pair) continue
    const key = pair[1]!.trim()
    const value = pair[2]!.trim()
    if (!value) {
      data[key] = []
      listKey = key
      continue
    }
    listKey = null
    const inline = /^\[(.*)\]$/.exec(value)
    data[key] = inline ? inline[1]!.split(",").map(unquote).filter(Boolean) : unquote(value)
  }
  return { data, body: normalized.slice(match[0].length) }
}

function frontmatterString(data: Record<string, FrontmatterValue>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function frontmatterTags(data: Record<string, FrontmatterValue>): string[] {
  const value = data.tags ?? data["标签"]
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[，,\s]+/) : []
  return list.map(tag => tag.replace(/^#/, "").trim()).filter(Boolean)
}

function frontmatterBoolean(data: Record<string, FrontmatterValue>): boolean | undefined {
  const value = frontmatterString(data, ["original", "原创"])
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  return undefined
}

function baseName(value: string): string {
  const clean = value.split(/[?#]/)[0] ?? value
  let decoded = clean
  try {
    decoded = decodeURIComponent(clean)
  } catch {
    // Keep the raw path when it is not valid URI encoding.
  }
  return (decoded.split(/[\\/]/).pop() ?? decoded).trim().toLowerCase()
}

function firstParagraph(markdown: string): string {
  for (const block of markdown.split(/\n{2,}/)) {
    const text = block.trim()
    if (!text || /^(?:#|!\[|```|>|[-*+]\s|\d+\.\s|\||<)/.test(text)) continue
    const plain = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").trim()
    if (plain) return Array.from(plain.replace(/\s+/g, " ")).slice(0, 120).join("")
  }
  return ""
}

/** Imports a Markdown file plus any images selected alongside it. Relative images are matched by file name. */
export async function importMarkdownFiles(files: File[]): Promise<ImportedArticle> {
  const markdownFile = files.find(file => MARKDOWN_EXTENSIONS.test(file.name))
  if (!markdownFile) throw new Error("请选择 .md 文件")
  const imageFiles = new Map<string, File>()
  for (const file of files) {
    if (file !== markdownFile && (file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name))) {
      imageFiles.set(file.name.toLowerCase(), file)
    }
  }

  const { data, body } = parseFrontmatter(await markdownFile.text())
  const collector = createCollector()
  const resolved = new Map<string, string | null>()
  const missing = new Set<string>()

  const resolve = async (reference: string): Promise<string | null> => {
    const key = reference.trim()
    if (resolved.has(key)) return resolved.get(key)!
    let assetId: string | null = null
    if (/^https?:\/\//i.test(key)) {
      assetId = await downloadImage(collector, key)
      if (!assetId) collector.warnings.push("部分外链图片未能下载，将保留原链接")
    } else if (/^data:image\//i.test(key)) {
      const response = await fetch(key)
      assetId = await addAsset(collector, await response.arrayBuffer(), response.headers.get("Content-Type") ?? "", "image")
    } else {
      const file = imageFiles.get(baseName(key))
      if (file) assetId = await addAsset(collector, await file.arrayBuffer(), file.type, file.name)
      else missing.add(baseName(key))
    }
    resolved.set(key, assetId)
    return assetId
  }

  const embedPattern = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g
  const imagePattern = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g
  const references = [
    ...Array.from(body.matchAll(embedPattern), match => match[1]!).filter(name => IMAGE_EXTENSIONS.test(name)),
    ...Array.from(body.matchAll(imagePattern), match => match[2]!.replace(/^<|>$/g, ""))
  ]
  for (const reference of references) await resolve(reference)

  let markdown = stripLeadingDecoration(body).replace(embedPattern, (full, name: string) => {
    if (!IMAGE_EXTENSIONS.test(name)) return full
    const id = resolved.get(name.trim())
    return id ? `![](${assetToken(id)})` : full
  })
  markdown = markdown.replace(imagePattern, (full, alt: string, rawSource: string) => {
    const id = resolved.get(rawSource.replace(/^<|>$/g, "").trim())
    return id ? `![${alt}](${assetToken(id)})` : full
  })

  let title = frontmatterString(data, ["title", "标题"])
  const heading = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(markdown)
  if (heading && (!title || heading[1]!.trim() === title)) {
    title ||= heading[1]!.trim()
    markdown = markdown.slice(heading[0].length)
  }
  title ||= markdownFile.name.replace(MARKDOWN_EXTENSIONS, "")
  markdown = markdown.trim()

  const coverReference = frontmatterString(data, ["cover", "封面", "image", "banner"])
    .replace(/^!?\[\[|\]\]$/g, "")
  const coverAssetId = coverReference ? await resolve(coverReference) : null
  if (missing.size) {
    collector.warnings.push(`有 ${missing.size} 张本地图片未找到，请与 .md 文件一起选择：${Array.from(missing).slice(0, 3).join("、")}`)
  }

  return finishDraft(collector, {
    source: { kind: "file", fileName: markdownFile.name },
    title,
    digest: frontmatterString(data, ["description", "digest", "summary", "excerpt", "摘要"]) || firstParagraph(markdown),
    markdown,
    html: markdownToHtml(markdown),
    coverAssetId,
    tags: frontmatterTags(data),
    original: frontmatterBoolean(data)
  })
}

function metaContent(document: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const value = document.querySelector<HTMLMetaElement>(selector)?.content?.trim()
    if (value) return value
  }
  return ""
}

function absoluteUrl(value: string | null, base: string): string | null {
  if (!value || /^(?:data:|javascript:)/i.test(value.trim())) return value?.trim() || null
  try {
    return new URL(value.trim(), base).toString()
  } catch {
    return null
  }
}

function promoteLazyImages(root: ParentNode, base: string): void {
  for (const image of Array.from(root.querySelectorAll("img"))) {
    const source = image.getAttribute("data-src")
      ?? image.getAttribute("data-original")
      ?? image.getAttribute("data-actualsrc")
      ?? image.getAttribute("data-lazy-src")
      ?? image.getAttribute("src")
    const resolved = absoluteUrl(source, base)
    if (resolved) image.setAttribute("src", resolved)
    else image.remove()
    image.removeAttribute("srcset")
  }
  for (const link of Array.from(root.querySelectorAll("a[href]"))) {
    const resolved = absoluteUrl(link.getAttribute("href"), base)
    if (resolved) link.setAttribute("href", resolved)
  }
}

function extractArticle(html: string, url: URL): { title: string; digest: string; content: string; cover: string } {
  const document = new DOMParser().parseFromString(html, "text/html")
  const cover = absoluteUrl(metaContent(document, ['meta[property="og:image"]', 'meta[name="twitter:image"]']), url.href) ?? ""
  const metaTitle = metaContent(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]'])
  const metaDigest = metaContent(document, ['meta[property="og:description"]', 'meta[name="description"]'])

  if (url.hostname === "mp.weixin.qq.com") {
    const content = document.querySelector("#js_content")
    if (content) {
      promoteLazyImages(content, url.href)
      return {
        title: document.querySelector("#activity-name")?.textContent?.trim() || metaTitle || document.title,
        digest: metaDigest,
        content: content.innerHTML,
        cover
      }
    }
  }

  promoteLazyImages(document, url.href)
  const parsed = new Readability(document.cloneNode(true) as Document, { keepClasses: false }).parse()
  return {
    title: parsed?.title?.trim() || metaTitle || document.title,
    digest: metaDigest || parsed?.excerpt?.trim() || "",
    content: parsed?.content ?? document.body.innerHTML,
    cover
  }
}

export function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*"
  })
  service.remove(["script", "style", "noscript"])
  return service
}

/** Fetches an article link with the browser's own session and converts it into a draft. */
export async function importArticleUrl(rawUrl: string): Promise<ImportedArticle> {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new Error("请输入有效的文章链接")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("仅支持 http 或 https 链接")

  let response: Response
  try {
    response = await fetch(url, { credentials: "include", redirect: "follow" })
  } catch {
    throw new Error("无法读取该链接，请确认已授权扩展访问网页")
  }
  if (!response.ok) throw new Error(`读取链接失败（HTTP ${response.status}）`)
  const contentType = response.headers.get("Content-Type") ?? ""
  if (contentType && !/html|xml/i.test(contentType)) throw new Error("该链接不是网页文章")
  const article = extractArticle(await response.text(), new URL(response.url || url.href))

  const container = new DOMParser().parseFromString(`<body>${sanitizePlatformHtml(article.content)}</body>`, "text/html").body
  const collector = createCollector()
  const images = Array.from(container.querySelectorAll("img"))
  const sources = Array.from(new Set(images.map(image => image.getAttribute("src") ?? "").filter(source => /^https?:/i.test(source))))
  const downloaded = new Map<string, string | null>()
  await mapLimited(sources, IMAGE_FETCH_CONCURRENCY, async source => {
    downloaded.set(source, await downloadImage(collector, source))
  })
  let failed = 0
  for (const image of images) {
    const id = downloaded.get(image.getAttribute("src") ?? "")
    if (id) image.setAttribute("src", assetToken(id))
    else if (id === null) failed += 1
  }
  if (failed) collector.warnings.push(`${failed} 张图片未能下载，将保留原链接，部分平台可能无法显示`)
  const coverAssetId = article.cover ? await downloadImage(collector, article.cover) : null

  const html = sanitizePlatformHtml(container.innerHTML)
  const markdown = createTurndown().turndown(html).trim()
  if (!markdown) throw new Error("未能从该链接提取正文")

  return finishDraft(collector, {
    source: { kind: "url", url: url.href },
    title: article.title,
    digest: Array.from(article.digest).slice(0, 120).join(""),
    markdown,
    html,
    coverAssetId
  })
}

/** Adds a user-picked cover image to an existing draft. */
export async function importCoverImage(draft: ComposeDraft, file: File): Promise<{ draft: ComposeDraft; asset: StoredAsset }> {
  const collector = createCollector()
  collector.totalBytes = draft.assets.reduce((total, asset) => total + asset.size, 0)
  const id = await addAsset(collector, await file.arrayBuffer(), file.type, file.name)
  const added = id ? collector.assets.get(id) : undefined
  if (!id) throw new Error(collector.warnings[0] ?? "封面图片无效")
  const existing = draft.assets.find(asset => asset.id === id)
  const stored = added?.stored ?? { id, mimeType: existing?.mimeType ?? file.type, bytes: await file.arrayBuffer() }
  return {
    draft: {
      ...draft,
      coverAssetId: id,
      coverSelection: "custom",
      assets: existing || !added ? draft.assets : [...draft.assets, added.meta],
      updatedAt: new Date().toISOString()
    },
    asset: stored
  }
}
