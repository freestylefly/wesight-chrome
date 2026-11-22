import { sanitizePlatformHtml } from "~lib/content"
import { postAssetFile } from "~lib/post-media"
import { fillTextControl } from "~platforms/dom"
import { PlatformPageChangedError, type PrepareDraftContext } from "~platforms/types"
import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"

/**
 * Shared helpers for overseas post and article adapters (批 3). Every adapter
 * stops before the site's final Post / Publish / Share button: `findAction`
 * refuses to return any control whose label looks like a publish action.
 */

export const delay = (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds))

/** Labels of controls that publish or submit; adapters must never click them. */
const PUBLISH_LABEL = /^(?:post|post all|publish|publish now|share|submit|send|tweet|reply|pin|save|done|continue|next|发布|发表|提交|分享)$/i

export function isPublishLabel(label: string): boolean {
  return PUBLISH_LABEL.test(label.replace(/\s+/g, " ").trim())
}

export function visible(element: Element): boolean {
  if (element.closest("[hidden], [aria-hidden='true']")) return false
  let current: Element | null = element
  while (current) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current)
    if (style?.display === "none" || style?.visibility === "hidden") return false
    current = current.parentElement
  }
  return true
}

export function compactText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? ""
}

function controlLabels(element: Element): string[] {
  return [element.getAttribute("aria-label"), element.getAttribute("title"), compactText(element)]
    .filter((label): label is string => !!label && !!label.trim())
    .map(label => label.trim())
}

/**
 * Finds a visible, non-publishing control (button, link, role=button) whose
 * aria-label, title or text matches one of the patterns.
 */
export function findAction(patterns: readonly RegExp[], root: ParentNode = document): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>("button, a, [role='button'], [role='tab'], [role='menuitem'], [role='link']")
  for (const pattern of patterns) {
    for (const element of Array.from(candidates)) {
      if (!visible(element)) continue
      const labels = controlLabels(element)
      if (labels.some(isPublishLabel)) continue
      if (labels.some(label => pattern.test(label))) return element
    }
  }
  return null
}

export async function waitFor<T>(find: () => T | null | undefined, timeoutMs: number, interval = 100): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = find()
    if (found) return found
    if (Date.now() >= deadline) return null
    await delay(interval)
  }
}

/** First visible element matching any selector, trying selectors in order. */
export function queryVisible<T extends Element>(selectors: readonly string[], root: ParentNode = document): T | null {
  for (const selector of selectors) {
    const match = Array.from(root.querySelectorAll<T>(selector)).find(element => visible(element))
    if (match) return match
  }
  return null
}

/** querySelectorAll that also descends into open shadow roots (Reddit's web components). */
export function deepQueryAll<T extends Element>(selector: string, root: ParentNode = document): T[] {
  const results: T[] = []
  const visit = (node: ParentNode) => {
    results.push(...Array.from(node.querySelectorAll<T>(selector)))
    for (const element of Array.from(node.querySelectorAll("*"))) {
      if (element.shadowRoot) visit(element.shadowRoot)
    }
  }
  visit(root)
  return results
}

export function deepQuery<T extends Element>(selectors: readonly string[], root: ParentNode = document): T | null {
  for (const selector of selectors) {
    const match = deepQueryAll<T>(selector, root)[0]
    if (match) return match
  }
  return null
}

export function composerRoot(element: Element): ParentNode {
  return element.closest("[role='dialog']") ?? element.closest("form") ?? element.ownerDocument
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, "")
}

export function editableText(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value
  return element.innerText ?? element.textContent ?? ""
}

function textContains(element: HTMLElement, expected: string): boolean {
  const want = normalizeText(expected).slice(0, 24)
  return !want || normalizeText(editableText(element) || element.textContent || "").includes(want)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function paragraphsHtml(text: string): string {
  return text.replace(/\r\n?/g, "\n").split(/\n{2,}/)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("")
}

function selectContents(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection()
  if (!selection) return
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}

function pasteInto(element: HTMLElement, data: { text: string; html: string }): void {
  if (typeof ClipboardEvent === "undefined" || typeof DataTransfer === "undefined") return
  const clipboardData = new DataTransfer()
  clipboardData.setData("text/plain", data.text)
  if (data.html) clipboardData.setData("text/html", data.html)
  element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }))
}

/**
 * Replaces the contents of a rich-text editor (Lexical, Draft.js, Quill,
 * ProseMirror) through the editor's own paste handling, falling back to the
 * browser's insertText command. Never writes innerHTML directly, because the
 * framework would discard that text on the next render or publish.
 */
export async function insertText(
  element: HTMLElement,
  text: string,
  options: { html?: string; expected?: string } = {}
): Promise<boolean> {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    fillTextControl(element, text)
    return true
  }
  const expected = options.expected ?? text
  element.focus()
  selectContents(element)
  await delay(30)
  pasteInto(element, { text, html: options.html ?? paragraphsHtml(text) })
  await delay(150)
  if (textContains(element, expected)) return true
  element.focus()
  selectContents(element)
  if (typeof element.ownerDocument.execCommand === "function") {
    try { element.ownerDocument.execCommand("insertText", false, text) } catch { /* unsupported */ }
  }
  await delay(150)
  return textContains(element, expected)
}

/** Places the caret inside one block of a larger editor (e.g. Medium's title line). */
export function focusBlock(block: HTMLElement): void {
  const host = block.closest<HTMLElement>("[contenteditable='true']") ?? block
  host.focus()
  selectContents(block)
}

export function countGraphemes(text: string): number {
  const Segmenter = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => { segment(input: string): Iterable<unknown> } }).Segmenter
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text)).length
  return Array.from(text).length
}

/** The dynamic composer stores "动态" when the user left the title empty. */
export function postTitle(task: PublishTaskV1): string {
  const title = task.article.title.trim()
  return title === "动态" ? "" : title
}

export function postBody(task: PublishTaskV1): string {
  return task.article.markdown.replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/\n{3,}/g, "\n\n").trim()
}

export function normalizedTags(task: PublishTaskV1): string[] {
  return task.article.tags
    .map(tag => tag.replace(/^#+|#+$/g, "").replace(/\s+/g, "").trim())
    .filter(Boolean)
}

/** Body followed by a blank line and "#tag #tag", the convention on most overseas networks. */
export function bodyWithHashtags(task: PublishTaskV1): string {
  const tags = normalizedTags(task).map(tag => `#${tag}`).join(" ")
  return [postBody(task), tags].filter(Boolean).join("\n\n")
}

export function imageAssets(task: PublishTaskV1): PublishAssetV1[] {
  return task.assets.filter(asset => asset.mimeType.startsWith("image/"))
}

export function videoAssets(task: PublishTaskV1): PublishAssetV1[] {
  return task.assets.filter(asset => asset.mimeType.startsWith("video/"))
}

export function skippedVideoWarning(task: PublishTaskV1, platform: string): string[] {
  return videoAssets(task).length || task.media ? [`${platform} 暂不支持自动同步视频，已跳过视频，请在编辑页手动添加`] : []
}

function mediaCount(root: ParentNode): number {
  return root.querySelectorAll("img[src], video").length
}

function fileInput(selectors: readonly string[], root: ParentNode): HTMLInputElement | null {
  for (const selector of selectors) {
    const input = deepQueryAll<HTMLInputElement>(selector, root).find(candidate => candidate.type === "file" && !candidate.disabled)
    if (input) return input
  }
  return null
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  const transfer = new DataTransfer()
  files.forEach(file => transfer.items.add(file))
  input.files = transfer.files
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

function pasteFiles(editor: HTMLElement, files: File[]): void {
  if (typeof ClipboardEvent === "undefined" || typeof DataTransfer === "undefined") return
  const clipboardData = new DataTransfer()
  files.forEach(file => clipboardData.items.add(file))
  editor.focus()
  editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }))
}

export interface AttachImagesInput {
  context: PrepareDraftContext
  assets: PublishAssetV1[]
  platform: string
  /** Where to look for the file input and count previews. */
  root: ParentNode
  inputSelectors: readonly string[]
  /** Controls that reveal the file input without opening a native file dialog. */
  revealLabels?: readonly RegExp[]
  /** Paste the files into this editor when no file input exists. */
  pasteTarget?: HTMLElement
  /** Throw instead of warning when the upload control is missing. */
  required?: boolean
  previewTimeoutMs?: number
}

/**
 * Hands images to the site's own file input in their original order. Inputs
 * without `multiple` receive one file per change event. Returns warnings;
 * never clicks a publish control.
 */
export async function attachImages(input: AttachImagesInput): Promise<string[]> {
  const { context, assets, platform, root } = input
  if (!assets.length) return []
  const files: File[] = []
  for (const asset of assets) files.push(await postAssetFile(context, asset))
  const before = mediaCount(root)

  let control = await waitFor(() => fileInput(input.inputSelectors, root) ?? fileInput(input.inputSelectors, document), 1_500)
  if (!control && input.revealLabels?.length) {
    findAction(input.revealLabels, root)?.click()
    control = await waitFor(() => fileInput(input.inputSelectors, root) ?? fileInput(input.inputSelectors, document), 4_000)
  }
  if (control) {
    if (control.multiple || files.length === 1) setInputFiles(control, files)
    else {
      for (const file of files) {
        const current = fileInput(input.inputSelectors, root) ?? fileInput(input.inputSelectors, document) ?? control
        setInputFiles(current, [file])
        await delay(400)
      }
    }
  } else if (input.pasteTarget) {
    for (const file of files) {
      pasteFiles(input.pasteTarget, [file])
      await delay(300)
    }
  } else {
    if (input.required) throw new PlatformPageChangedError(platform, "图片上传控件")
    for (const asset of assets) context.uploadProgress?.skip?.(asset)
    return [`未找到 ${platform} 的图片上传控件，请在编辑页手动添加 ${assets.length} 张图片（按原顺序）`]
  }

  const shown = await waitFor(() => mediaCount(root) - before >= assets.length || null, input.previewTimeoutMs ?? 20_000, 250)
  for (const asset of assets) context.uploadProgress?.complete(asset)
  return shown ? [] : [`已把 ${assets.length} 张图片交给 ${platform}，但未确认预览，请检查图片是否全部上传`]
}

/** Article HTML without platform-unreachable asset images, plus how many were removed. */
export function articleHtmlWithoutAssets(task: PublishTaskV1): { html: string; removed: number } {
  let removed = 0
  const html = task.article.html.replace(/<img\b[^>]*src=["']wesight-asset:\/\/[^"']*["'][^>]*>/gi, () => {
    removed += 1
    return ""
  })
  return { html: sanitizePlatformHtml(html).replace(/<p>\s*<\/p>/g, ""), removed }
}

export function overLimitError(platform: string, limit: number, count: number, unit = "字"): Error {
  return new Error(`${platform} 正文（含话题）最多 ${limit} ${unit}，当前 ${count} ${unit}，请精简后重试`)
}
