/**
 * Shared DOM-level draft filler for 国内自媒体号 article editors (批 1b).
 *
 * Every site is described by an `ArticleEditorSpec`: semantic selectors for
 * the title, body, digest, tags and cover controls, plus the reminders the
 * user must handle by hand. The filler never clicks a final 发布 / 发表 /
 * 提交 / 群发 control and never toggles 原创 (that usually means accepting a
 * declaration). Images go only through the editor's own file input or paste
 * handler; when that cannot be confirmed the image becomes a visible
 * placeholder and a warning.
 */
import { platformPlainText, replaceAssetTokens, sanitizePlatformHtml, truncateTitle } from "~lib/content"
import type { ARTICLE_MEDIA_PLATFORMS } from "~platforms/catalog/article-media"
import { PLATFORM_CONFIG } from "~platforms/config"
import { fillTextControl, loginPageDetected, referencedAssets } from "~platforms/dom"
import {
  PlatformPageChangedError,
  type AccountDetection,
  type PlatformAdapter,
  type PrepareDraftContext,
  type PrepareDraftResult
} from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

export type ArticleMediaId = (typeof ARTICLE_MEDIA_PLATFORMS)[number]["id"]

export interface ArticleEditorSpec {
  id: ArticleMediaId
  /** Shown when the page is a login page or the session has expired. */
  loginMessage: string
  /** Elements that only exist while signed out (QR panels, login buttons). */
  loginSelectors?: string[]
  /** Visible button/link texts that only appear while signed out. */
  loginTexts?: string[]
  /** Hostnames that only ever serve a login page. */
  loginHosts?: string[]
  /** Site-specific signed-out check, combined with the generic ones. */
  isLoggedOut?: () => boolean
  title: string[]
  /** Contenteditable roots, or iframe selectors whose document body is the editor (UEditor). */
  body: string[]
  digest?: string[]
  tags?: string[]
  /** File inputs owned by the editor's image tool; scoped so a cover input never matches. */
  imageInputs?: string[]
  /** Toolbar buttons that reveal `imageInputs` when they are created lazily. */
  imageTriggers?: string[]
  /** The editor uploads image files pasted into the body. */
  pasteImages?: boolean
  /** File inputs that set the article cover. */
  coverInputs?: string[]
  /** Reminders always returned, e.g. 分类 / 声明 / 发布设置. */
  notes: string[]
  /** How long to wait for the editor before reporting a page change. */
  editorTimeoutMs?: number
  /** Friendlier message when the editor never appears (e.g. a manual entry step). */
  missingEditorMessage?: string
  /** Runs first; returning a result (e.g. navigate to the real editor) skips filling. */
  beforeFill?: (context: PrepareDraftContext) => Promise<PrepareDraftResult | null>
}

/** Text of controls that would publish; the filler never clicks these. */
export const FINAL_ACTION_PATTERN = /发布|发表|提交|群发|投稿|定时/

const DEFAULT_IMAGE_TIMEOUT_MS = 15_000
const DEFAULT_PASTE_SETTLE_MS = 800

let imageTimeoutMs = DEFAULT_IMAGE_TIMEOUT_MS
let pasteSettleMs = DEFAULT_PASTE_SETTLE_MS

/** Test hook: shorten image upload and paste settle waits; `null` restores the defaults. */
export function setArticleMediaTimings(value: { image: number; paste: number } | null): void {
  imageTimeoutMs = value?.image ?? DEFAULT_IMAGE_TIMEOUT_MS
  pasteSettleMs = value?.paste ?? DEFAULT_PASTE_SETTLE_MS
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function waitFor<T>(probe: () => T | null | undefined, timeoutMs: number, interval = 250): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() >= deadline) return null
    await sleep(interval)
  }
}

function isHidden(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (!(current instanceof HTMLElement)) continue
    if (current.hidden || current.getAttribute("aria-hidden") === "true") return true
    const display = current.style.display.trim().toLowerCase()
    const visibility = current.style.visibility.trim().toLowerCase()
    if (display === "none" || visibility === "hidden") return true
  }
  return false
}

function first<T extends Element>(selectors: readonly string[], root: ParentNode = document, exclude?: Element | null): T | null {
  for (const selector of selectors) {
    let candidates: T[]
    try {
      candidates = Array.from(root.querySelectorAll<T>(selector))
    } catch {
      continue
    }
    const found = candidates.find(candidate => !isHidden(candidate)
      && !(exclude && (exclude === candidate || exclude.contains(candidate) || candidate.contains(exclude))))
    if (found) return found
  }
  return null
}

function controlText(element: Element): string {
  return `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`.trim()
}

/** Clicks a helper control (image tool, tab) unless it looks like a final publish action. */
export function safeClick(element: HTMLElement | null): boolean {
  if (!element || FINAL_ACTION_PATTERN.test(controlText(element))) return false
  element.click()
  return true
}

export function articleLoggedOut(spec: Pick<ArticleEditorSpec, "loginSelectors" | "loginTexts" | "loginHosts" | "isLoggedOut">): boolean {
  if (loginPageDetected()) return true
  if (spec.loginHosts?.includes(location.hostname)) return true
  if (spec.loginSelectors && first(spec.loginSelectors)) return true
  if (spec.loginTexts?.length) {
    const texts = spec.loginTexts
    const controls = document.querySelectorAll<HTMLElement>("button, a, [role='button'], [role='tab']")
    if (Array.from(controls).some(control => !isHidden(control) && texts.includes(control.textContent?.trim() ?? ""))) return true
  }
  return spec.isLoggedOut?.() ?? false
}

/** Resolves an editor selector to the element that actually takes input (iframe → body). */
function editableFor(element: Element): HTMLElement | null {
  if (element instanceof HTMLIFrameElement) {
    try {
      const body = element.contentDocument?.body
      return body ?? null
    } catch {
      return null
    }
  }
  return element instanceof HTMLElement ? element : null
}

function findBody(spec: ArticleEditorSpec, title: Element | null): HTMLElement | null {
  for (const selector of spec.body) {
    const element = first([selector], document, title)
    const editable = element ? editableFor(element) : null
    if (editable) return editable
  }
  return null
}

function selectContents(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView
  const selection = view?.getSelection?.()
  if (!selection) return
  try {
    const range = element.ownerDocument.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
  } catch {
    // Selection is best effort; the editor still receives the paste.
  }
}

function dispatchInput(element: HTMLElement): void {
  const EventConstructor = element.ownerDocument.defaultView?.Event ?? Event
  element.dispatchEvent(new EventConstructor("input", { bubbles: true }))
  element.dispatchEvent(new EventConstructor("change", { bubbles: true }))
}

function dispatchPaste(element: HTMLElement, fill: (transfer: DataTransfer) => void): boolean {
  const view = element.ownerDocument.defaultView as (Window & typeof globalThis) | null
  const ClipboardConstructor = view?.ClipboardEvent ?? globalThis.ClipboardEvent
  if (typeof ClipboardConstructor === "undefined" || typeof DataTransfer === "undefined") return false
  const transfer = new DataTransfer()
  fill(transfer)
  element.dispatchEvent(new ClipboardConstructor("paste", { bubbles: true, cancelable: true, clipboardData: transfer }))
  return true
}

function textProbe(html: string, fallback: string): string {
  const plain = (platformPlainText(html) || fallback).replace(/\s+/g, "")
  return Array.from(plain).slice(0, 8).join("")
}

/**
 * Replaces the editor contents with HTML. Same-document editors get the HTML
 * through their own paste handler first (which keeps their document model in
 * sync); some handlers finish asynchronously, so wait briefly before falling
 * back to a direct DOM write to avoid inserting the body twice. UEditor iframe
 * bodies keep their model in the DOM and are written directly.
 */
export async function fillRichBody(element: HTMLElement, html: string, textFallback: string): Promise<void> {
  const safeHtml = sanitizePlatformHtml(html)
  const probe = textProbe(safeHtml, textFallback)
  const filled = () => Boolean(probe) && (element.textContent ?? "").replace(/\s+/g, "").includes(probe)
  element.focus()
  if (element.ownerDocument === document) {
    selectContents(element)
    const pasted = dispatchPaste(element, transfer => {
      transfer.setData("text/html", safeHtml)
      transfer.setData("text/plain", platformPlainText(safeHtml) || textFallback)
    })
    if (pasted) await waitFor(() => filled() || null, pasteSettleMs, 100)
  }
  if (!filled()) element.innerHTML = safeHtml
  dispatchInput(element)
}

/** Fills a title that may be an input, a textarea or a contenteditable block. */
export function fillTitleControl(element: HTMLElement, title: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    fillTextControl(element, title)
    return
  }
  element.focus()
  selectContents(element)
  dispatchPaste(element, transfer => transfer.setData("text/plain", title))
  if ((element.textContent ?? "").trim() !== title) element.textContent = title
  dispatchInput(element)
}

function dataUrlToFile(dataUrl: string, asset: PublishAssetV1): File {
  const [header, payload = ""] = dataUrl.split(",", 2)
  const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new File([bytes], asset.fileName, { type: asset.mimeType })
}

function remoteImages(root: ParentNode): Set<string> {
  return new Set(Array.from(root.querySelectorAll<HTMLImageElement>("img"))
    .map(image => image.currentSrc || image.src)
    .filter(url => /^https?:\/\//i.test(url)))
}

function imageRoots(editor: HTMLElement): ParentNode[] {
  return editor.ownerDocument === document ? [document] : [document, editor.ownerDocument]
}

function snapshotImages(editor: HTMLElement): Set<string> {
  const urls = new Set<string>()
  for (const root of imageRoots(editor)) for (const url of remoteImages(root)) urls.add(url)
  return urls
}

async function waitForNewImage(editor: HTMLElement, previous: ReadonlySet<string>): Promise<string | null> {
  return waitFor(() => {
    for (const root of imageRoots(editor)) {
      const added = Array.from(remoteImages(root)).find(url => !previous.has(url))
      if (added) return added
    }
    return null
  }, imageTimeoutMs, 200)
}

async function uploadThroughEditor(
  spec: ArticleEditorSpec,
  editor: HTMLElement,
  context: PrepareDraftContext,
  asset: PublishAssetV1
): Promise<string | null> {
  if (spec.imageInputs?.length) {
    let input = first<HTMLInputElement>(spec.imageInputs)
    if (!input && spec.imageTriggers?.length) {
      safeClick(first<HTMLElement>(spec.imageTriggers))
      input = await waitFor(() => first<HTMLInputElement>(spec.imageInputs!), 3_000, 150)
    }
    if (input) {
      const previous = snapshotImages(editor)
      const transfer = new DataTransfer()
      transfer.items.add(dataUrlToFile(await context.getAssetData(asset), asset))
      input.files = transfer.files
      input.dispatchEvent(new Event("change", { bubbles: true }))
      input.dispatchEvent(new Event("input", { bubbles: true }))
      const url = await waitForNewImage(editor, previous)
      if (url) return url
    }
  }
  if (spec.pasteImages) {
    const previous = snapshotImages(editor)
    const file = dataUrlToFile(await context.getAssetData(asset), asset)
    editor.focus()
    const pasted = dispatchPaste(editor, transfer => transfer.items.add(file))
    if (pasted) return waitForNewImage(editor, previous)
  }
  return null
}

function withPlaceholders(html: string, missing: ReadonlyMap<string, PublishAssetV1>): string {
  if (!missing.size) return html
  const parsed = new DOMParser().parseFromString(html, "text/html")
  for (const image of Array.from(parsed.images)) {
    const match = /^wesight-asset:\/\/([^?#]+)/.exec(image.getAttribute("src") ?? "")
    const asset = match?.[1] ? missing.get(match[1]) : undefined
    if (!asset) continue
    const note = parsed.createElement("p")
    note.textContent = `［图片：${asset.fileName}，请在此处手动插入］`
    image.replaceWith(note)
  }
  return parsed.body.innerHTML
}

function markdownPlaceholders(markdown: string, missing: ReadonlyMap<string, PublishAssetV1>): string {
  let result = markdown
  for (const [id, asset] of missing) {
    result = result.replace(new RegExp(`!\\[[^\\]]*\\]\\(wesight-asset://${id}\\)`, "g"), `［图片：${asset.fileName}，请在此处手动插入］`)
  }
  return result
}

function pressEnter(element: HTMLElement): void {
  const KeyboardConstructor = element.ownerDocument.defaultView?.KeyboardEvent ?? KeyboardEvent
  for (const type of ["keydown", "keypress", "keyup"]) {
    element.dispatchEvent(new KeyboardConstructor(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit))
  }
}

async function fillTags(spec: ArticleEditorSpec, tags: readonly string[], label: string): Promise<string[]> {
  if (!tags.length) return []
  const input = spec.tags ? first<HTMLInputElement>(spec.tags) : null
  if (!input) return [`标签（${tags.join("、")}）请在${label}编辑页手动添加`]
  for (const tag of tags) {
    fillTextControl(input, tag)
    pressEnter(input)
    await sleep(50)
  }
  return [`已尝试填写标签：${tags.join("、")}，请确认平台已识别`]
}

async function fillCover(spec: ArticleEditorSpec, context: PrepareDraftContext, label: string): Promise<string[]> {
  const coverId = context.task.article.coverAssetId
  const cover = coverId ? context.task.assets.find(asset => asset.id === coverId) : undefined
  if (!cover) return []
  const input = spec.coverInputs ? first<HTMLInputElement>(spec.coverInputs) : null
  if (!input) return [`封面“${cover.fileName}”请在${label}编辑页手动上传`]
  const transfer = new DataTransfer()
  transfer.items.add(dataUrlToFile(await context.getAssetData(cover), cover))
  input.files = transfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  input.dispatchEvent(new Event("input", { bubbles: true }))
  return [`已选择封面“${cover.fileName}”，如出现裁剪框请手动确认`]
}

async function prepareArticleDraft(spec: ArticleEditorSpec, context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const config = PLATFORM_CONFIG[spec.id]
  const early = await spec.beforeFill?.(context)
  if (early) return early

  const timeout = spec.editorTimeoutMs ?? 20_000
  const title = await waitFor(() => first<HTMLElement>(spec.title), timeout)
  if (!title) {
    if (spec.missingEditorMessage) throw new Error(spec.missingEditorMessage)
    throw new PlatformPageChangedError(config.label, "标题输入框")
  }
  const body = await waitFor(() => findBody(spec, title), timeout)
  if (!body) {
    if (spec.missingEditorMessage) throw new Error(spec.missingEditorMessage)
    throw new PlatformPageChangedError(config.label, "正文编辑器")
  }

  const warnings: string[] = []
  const limited = truncateTitle(context.task.article.title, config.titleLimit)
  if (limited.truncated) warnings.push(`标题超过${config.shortLabel}上限，已按 ${config.titleLimit} 个字符填充`)

  const urls = new Map<string, string>()
  const missing = new Map<string, PublishAssetV1>()
  const assets = referencedAssets(context)
  if (assets.length) context.reportProgress?.(`正在通过${config.shortLabel}编辑器上传图片`)
  for (const asset of assets) {
    let url: string | null = null
    try {
      url = await uploadThroughEditor(spec, body, context, asset)
    } catch {
      url = null
    }
    if (url) {
      urls.set(asset.id, url)
      context.uploadProgress?.complete(asset)
    } else {
      missing.set(asset.id, asset)
      context.uploadProgress?.skip?.(asset)
    }
  }
  if (missing.size) {
    warnings.push(`${missing.size} 张正文图片未能通过${config.shortLabel}编辑器上传，已在正文中留下“［图片：…］”占位，请手动插入`)
  }

  const html = sanitizePlatformHtml(replaceAssetTokens(withPlaceholders(context.task.article.html, missing), urls))
  const markdown = replaceAssetTokens(markdownPlaceholders(context.task.article.markdown, missing), urls)
  fillTitleControl(title, limited.title)
  await fillRichBody(body, html, markdown)

  const digest = context.task.article.digest.trim()
  if (digest) {
    const digestControl = spec.digest ? first<HTMLInputElement | HTMLTextAreaElement>(spec.digest) : null
    if (digestControl) fillTextControl(digestControl, digest)
    else warnings.push(`摘要请在${config.shortLabel}编辑页手动填写`)
  }
  warnings.push(...await fillTags(spec, context.task.article.tags, config.shortLabel))
  warnings.push(...await fillCover(spec, context, config.shortLabel))
  if (context.task.article.original !== false) warnings.push(`原创声明请在${config.shortLabel}编辑页手动确认`)
  warnings.push(...spec.notes)
  return { draftUrl: location.href, warnings }
}

export function createArticleAdapter(spec: ArticleEditorSpec): PlatformAdapter {
  const config = PLATFORM_CONFIG[spec.id]
  const prepare = (context: PrepareDraftContext) => prepareArticleDraft(spec, context)
  return {
    id: spec.id,
    title: config.label,
    editorUrl: config.editorUrl,
    titleLimit: config.titleLimit,
    async detectAccount(): Promise<AccountDetection> {
      return articleLoggedOut(spec) ? { loggedIn: false, message: spec.loginMessage } : { loggedIn: true }
    },
    prepareDraft: prepare,
    retry: prepare,
    dispose() {}
  }
}
