import { postAssetFile, postVideoAsset } from "~lib/post-media"
import type { POST_CN_PLATFORMS } from "~platforms/catalog/post-cn"
import { PLATFORM_CONFIG } from "~platforms/config"
import { fillEditable, fillTextControl, loginPageDetected, waitForAny } from "~platforms/dom"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

export type PostCnPlatformId = (typeof POST_CN_PLATFORMS)[number]["id"]

/**
 * Declarative description of one 国内动态 composer. Every selector here is
 * semantic (placeholder, aria, role, button text) so it survives hashed class
 * renames; the ones not yet checked against the live page are listed in the
 * batch hand-over note.
 */
export interface PostCnSpec {
  id: PostCnPlatformId
  /** Name used in user-facing messages, e.g. "知乎想法". */
  name: string
  /** Site name used in login messages, e.g. "知乎". */
  site: string
  editor: string[]
  /** Title field selectors. Omitted when the composer has no title. */
  title?: string[]
  titleLimit?: number
  /** Visible texts of buttons that open a collapsed composer. */
  composerLabels?: string[]
  /** Visible texts of the tab that switches the page to image-text mode. */
  modeLabels?: string[]
  /** Image file input selectors. Omitted when images cannot be added automatically. */
  imageInput?: string[]
  /** The text editor only appears after images are chosen (e.g. 抖音图文). */
  imagesFirst?: boolean
  /** The platform rejects image-text posts without at least one image. */
  requiresImages?: boolean
  /** How tags are written into the body: "#话题", "#话题#", or not at all (warning). */
  topics: "hash" | "hash-pair" | "none"
  /** Body text that only appears on the login wall. */
  loginText?: RegExp
  textLimit?: number
}

const IMAGE_FAILURE = /(?:上传失败|图片失败|重试上传|格式不支持|图片过大|超出.{0,6}限制)/
export const IMAGE_INPUTS = ["input[type='file'][accept*='image']", "input[type='file'][accept*='.jpg']", "input[type='file'][accept*='.png']"]
/** Final-action labels the adapters must never click, whatever a spec says. */
const FINAL_ACTIONS = new Set(["发布", "发表", "发送", "提交", "立即发布", "发布动态", "发布作品", "发布想法", "发布沸点","发布笔记", "确认发布", "发微头条", "发广播"])

export function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

export function visible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current instanceof HTMLElement && current.hidden) return false
    if (current.getAttribute("aria-hidden") === "true") return false
    const style = current.ownerDocument.defaultView?.getComputedStyle(current)
    if (style?.display === "none" || style?.visibility === "hidden") return false
  }
  return true
}

function compact(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, "").trim()
}

export function findAction(labels: readonly string[], root: ParentNode = document): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>("button, a, [role='button'], [role='tab'], [tabindex], label, span, div")
  // Prefer the innermost element so a wrapper whose text happens to equal the label is not clicked.
  const matches = Array.from(candidates).filter(element => visible(element) && !isFinalAction(element) && labels.some(label => (
    compact(element.textContent) === compact(label) || element.getAttribute("aria-label") === label
  )))
  return matches.find(element => !matches.some(other => other !== element && element.contains(other))) ?? null
}

/** Whether an element is a final publish control. Mode tabs such as 抖音“发布图文” are role=tab, not buttons. */
export function isFinalAction(element: Element): boolean {
  if (element.getAttribute("role") === "tab" || element.closest("[role='tablist']")) return false
  return FINAL_ACTIONS.has(compact(element.textContent)) || FINAL_ACTIONS.has(element.getAttribute("aria-label") ?? "")
}

function firstVisible<T extends Element>(selectors: readonly string[]): T | null {
  for (const selector of selectors) {
    const match = Array.from(document.querySelectorAll<T>(selector)).find(visible)
    if (match) return match
  }
  return null
}

async function waitForVisible<T extends Element>(selectors: readonly string[], timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = firstVisible<T>(selectors)
    if (found || Date.now() >= deadline) return found
    await delay(200)
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export function composerHtml(content: string): string {
  return `<p>${escapeHtml(content.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>")}</p>`
}

type TextControl = HTMLInputElement | HTMLTextAreaElement | HTMLElement

function controlText(element: TextControl): string {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? ""
}

export function fillControl(element: TextControl, content: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    fillTextControl(element, content)
    return
  }
  element.focus()
  const selection = element.ownerDocument.getSelection()
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  selection?.removeAllRanges()
  selection?.addRange(range)
  fillEditable(element, composerHtml(content), content)
  selection?.removeAllRanges()
}

/** Body text for a post: Markdown image tokens are dropped because images go through the uploader. */
export function postBody(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\n{3,}/g, "\n\n").trim()
}

/** Dynamic drafts send "动态" when the user left the title empty. */
export function meaningfulTitle(title: string): string {
  const trimmed = title.trim()
  return trimmed === "动态" ? "" : trimmed
}

export function topicText(tags: readonly string[], style: PostCnSpec["topics"]): string {
  const names = tags.map(tag => tag.replace(/^#+|#+$/g, "").trim()).filter(Boolean)
  if (style === "none" || !names.length) return ""
  return names.map(name => style === "hash" ? `#${name}` : `#${name}#`).join(" ")
}

function imageAssets(context: PrepareDraftContext): PublishAssetV1[] {
  return context.task.assets.filter(asset => asset.mimeType.startsWith("image/"))
}

/** The smallest ancestor of the file input that also holds the editor, so feed images stay out of the count. */
export function uploadRoot(input: HTMLInputElement, editor: Element | null): ParentNode {
  if (editor) {
    for (let ancestor = input.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.contains(editor)) return ancestor
    }
  }
  return input.closest("form, [role='dialog']") ?? input.parentElement ?? document
}

export function previewCount(root: ParentNode): number {
  return Array.from(root.querySelectorAll<HTMLImageElement>("img"))
    .filter(image => visible(image) && Boolean(image.getAttribute("src")))
    .length
}

function failureText(root: ParentNode): string | null {
  const nodes = [root, ...Array.from(root.querySelectorAll("[role='alert']"))]
  for (const node of nodes) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim()
    if (IMAGE_FAILURE.test(text)) return text.slice(0, 160)
  }
  return null
}

export function createPostCnAdapter(spec: PostCnSpec): PlatformAdapter & { spec: PostCnSpec; loginRequired(): boolean } {
  const config = PLATFORM_CONFIG[spec.id]
  let disposed = false

  const checkCancelled = () => {
    if (disposed) throw new Error(`${spec.name}发布任务已取消`)
  }

  function loginRequired(): boolean {
    if (loginPageDetected()) return true
    if (!spec.loginText) return false
    const body = document.body?.textContent?.replace(/\s+/g, " ") ?? ""
    return spec.loginText.test(body) && !firstVisible(spec.editor)
  }

  async function switchMode(): Promise<void> {
    if (!spec.modeLabels?.length) return
    if (firstVisible(spec.editor) || (spec.imagesFirst && firstVisible(spec.imageInput ?? IMAGE_INPUTS))) return
    const tab = await waitForVisibleAction(spec.modeLabels, 6_000)
    if (!tab) throw new PlatformPageChangedError(spec.name, `“${spec.modeLabels[0]}”入口`)
    if (tab.getAttribute("aria-selected") !== "true") tab.click()
    await delay(400)
  }

  async function waitForVisibleAction(labels: readonly string[], timeoutMs: number): Promise<HTMLElement | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = findAction(labels)
      if (found || Date.now() >= deadline) return found
      await delay(200)
    }
  }

  async function waitForEditor(): Promise<TextControl | null> {
    let editor = await waitForVisible<TextControl>(spec.editor, spec.composerLabels?.length ? 1_500 : 12_000)
    if (editor || !spec.composerLabels?.length) return editor
    // The opener lives on the page; a matching control inside an open composer
    // (dialog or form) may be that composer's own submit button.
    const opener = findAction(spec.composerLabels)
    if (opener && !opener.closest("[role='dialog'], dialog, form, [aria-modal='true']")) opener.click()
    editor = await waitForVisible<TextControl>(spec.editor, 12_000)
    return editor
  }

  async function uploadImages(context: PrepareDraftContext, editor: Element | null, warnings: string[]): Promise<void> {
    const images = imageAssets(context)
    if (!images.length) return
    if (!spec.imageInput) {
      images.forEach(asset => context.uploadProgress?.skip?.(asset))
      warnings.push(`${spec.name}暂不支持自动添加图片，请在编辑页手动添加 ${images.length} 张图片`)
      return
    }
    const input = await waitForAny<HTMLInputElement>(spec.imageInput, 15_000)
    if (!input) throw new PlatformPageChangedError(spec.name, "图片上传控件")
    const root = uploadRoot(input, editor)
    const baseline = previewCount(root)
    // A multi-select input takes every image in order; otherwise feed them one by one.
    const batches = input.multiple ? [images] : images.map(asset => [asset])
    let reported = 0
    for (const batch of batches) {
      checkCancelled()
      const transfer = new DataTransfer()
      for (const asset of batch) transfer.items.add(await postAssetFile(context, asset))
      input.files = transfer.files
      input.dispatchEvent(new Event("change", { bubbles: true }))
      input.dispatchEvent(new Event("input", { bubbles: true }))
      const target = reported + batch.length
      const deadline = Date.now() + 60_000
      while (reported < target) {
        checkCancelled()
        const failure = failureText(root)
        if (failure) {
          context.uploadProgress?.fail(images[reported]!)
          throw new Error(`${spec.name}图片上传失败：${failure}`)
        }
        const completed = Math.min(target, previewCount(root) - baseline)
        while (reported < completed) context.uploadProgress?.complete(images[reported++]!)
        if (reported >= target) break
        if (Date.now() >= deadline) {
          images.slice(reported).forEach(asset => context.uploadProgress?.skip?.(asset))
          warnings.push(`未能确认${spec.name}图片全部上传完成（识别到 ${reported}/${images.length} 张），请在编辑页检查`)
          return
        }
        await delay(250)
      }
    }
  }

  async function fillTitle(title: string, warnings: string[]): Promise<void> {
    if (!title) return
    if (!spec.title) {
      warnings.push(`${spec.name}没有标题栏，标题未同步`)
      return
    }
    const field = await waitForVisible<TextControl>(spec.title, 3_000)
    if (!field) {
      warnings.push(`未找到${spec.name}标题输入框，标题未填写`)
      return
    }
    const limit = spec.titleLimit ?? config.titleLimit
    const chars = Array.from(title)
    if (chars.length > limit) warnings.push(`标题超过${spec.name}上限，已按 ${limit} 个字符填充`)
    fillControl(field, chars.slice(0, limit).join(""))
  }

  async function prepareDraft(context: PrepareDraftContext): Promise<PrepareDraftResult> {
    disposed = false
    const warnings: string[] = []
    if (postVideoAsset(context.task)) throw new Error(`${spec.name}当前不支持同步视频，请改用图片或取消勾选`)
    if (loginRequired()) throw new Error(`请先登录${spec.site}，登录完成后从发布助手重试`)
    if (spec.requiresImages && !imageAssets(context).length) throw new Error(`${spec.name}至少需要一张图片，请添加图片后重试`)

    await switchMode()
    if (spec.imagesFirst) await uploadImages(context, null, warnings)

    const editor = await waitForEditor()
    if (!editor) throw new PlatformPageChangedError(spec.name, "正文编辑器")
    checkCancelled()

    const { article } = context.task
    const topics = topicText(article.tags, spec.topics)
    if (spec.topics === "none" && article.tags.some(tag => tag.trim())) {
      warnings.push(`${spec.name}的话题需要在编辑页手动选择，标签未同步`)
    }
    const content = [postBody(article.markdown), topics].filter(Boolean).join("\n\n")
    if (spec.textLimit && Array.from(content).length > spec.textLimit) {
      throw new Error(`${spec.name}正文${topics ? "和话题合计" : ""}超过 ${spec.textLimit} 个字，请精简文案后重试`)
    }

    await fillTitle(meaningfulTitle(article.title), warnings)
    if (content) {
      fillControl(editor, content)
      await delay(300)
      const expected = compact(content).slice(0, 16)
      if (!compact(controlText(editor)).includes(expected)) throw new Error(`${spec.name}正文填充失败，请重试`)
    }

    if (!spec.imagesFirst) await uploadImages(context, editor, warnings)
    checkCancelled()
    return { draftUrl: location.href, warnings }
  }

  return {
    id: spec.id,
    title: config.label,
    editorUrl: config.editorUrl,
    titleLimit: config.titleLimit,
    spec,
    loginRequired,
    async detectAccount() {
      return loginRequired()
        ? { loggedIn: false, message: `请先登录${spec.site}，登录完成后重试` }
        : { loggedIn: true }
    },
    prepareDraft,
    retry: prepareDraft,
    dispose() {
      disposed = true
    }
  }
}
