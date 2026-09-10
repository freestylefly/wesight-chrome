import { PLATFORM_CONFIG } from "~platforms/config"
import { fillTextControl, loginPageDetected, prepareArticle, waitForAny } from "~platforms/dom"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

const config = PLATFORM_CONFIG.xiaohongshu

const TITLE_SELECTORS = [
  "input[placeholder*='填写标题']",
  "input[placeholder*='标题']",
  "textarea[placeholder*='填写标题']",
  "textarea[placeholder*='标题']",
  "input.d-text"
]

const EDITOR_SELECTORS = [
  ".ql-editor[contenteditable='true']",
  ".tiptap[contenteditable='true']",
  "div[contenteditable='true'][role='textbox']",
  "div[contenteditable='true'][data-placeholder*='正文']",
  "div[contenteditable='true']"
]

const PREVIEW_SELECTORS = [
  ".img-preview-area .img-container",
  ".img-preview-area [class*='preview-item']",
  ".img-preview-area img",
  ".upload-list [class*='item']",
  "[class*='image-list'] [class*='item']",
  "[class*='preview-list'] [class*='item']",
  "[data-testid='image-preview']"
]

let disposed = false

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

function visible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true
  if (element.hidden || element.closest("[aria-hidden='true']")) return false
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return style?.display !== "none" && style?.visibility !== "hidden"
}

function actionable(element: HTMLElement): boolean {
  if (!visible(element)) return false
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  const opacity = Number.parseFloat(style?.opacity || "1")
  const zIndex = Number.parseInt(style?.zIndex || "0", 10)
  if (style?.pointerEvents === "none" || opacity < 0.01 || zIndex < 0) {
    return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0
    && rect.height > 0
    && rect.right > 0
    && rect.bottom > 0
    && rect.left < window.innerWidth
    && rect.top < window.innerHeight
}

function uploadTab(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(".creator-tab, button, [role='tab']")
  return Array.from(candidates).find(element => actionable(element) && element.textContent?.trim() === "上传图文") ?? null
}

function imageUploadInput(): HTMLInputElement | null {
  const candidates = document.querySelectorAll<HTMLInputElement>("input[type='file']")
  return Array.from(candidates).find(input => {
    const accept = input.accept.toLowerCase()
    return visible(input)
      && input.multiple
      && /(?:image\/|\.jpe?g|\.png|\.webp)/.test(accept)
  }) ?? null
}

async function waitForUploadTab(timeoutMs = 15_000): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (disposed) throw new Error("小红书发布任务已取消")
    const tab = uploadTab()
    if (tab) return tab
    await delay(200)
  }
  return null
}

async function waitForImageUploadInput(timeoutMs = 15_000): Promise<HTMLInputElement | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (disposed) throw new Error("小红书发布任务已取消")
    const input = imageUploadInput()
    if (input) return input
    await delay(200)
  }
  return null
}

async function openImageUploader(): Promise<HTMLInputElement> {
  const tab = await waitForUploadTab()
  if (!tab) throw new PlatformPageChangedError(config.label, "上传图文入口")
  if (!tab.classList.contains("active")) {
    tab.click()
  }
  const input = await waitForImageUploadInput()
  if (!input) throw new PlatformPageChangedError(config.label, "批量图片上传控件")
  return input
}

function dataUrlToFile(dataUrl: string, asset: PublishAssetV1): File {
  const [header, payload = ""] = dataUrl.split(",", 2)
  const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new File([bytes], asset.fileName, { type: asset.mimeType })
}

function previewCount(): number {
  return Math.max(0, ...PREVIEW_SELECTORS.map(selector => (
    Array.from(document.querySelectorAll(selector)).filter(visible).length
  )))
}

function uploadFailureMessage(): string | null {
  const containers = document.querySelectorAll<HTMLElement>(
    ".img-preview-area, .upload-list, [class*='image-list'], [class*='preview-list'], [class*='upload']"
  )
  for (const container of containers) {
    const text = container.textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (/(?:上传失败|重新上传|格式不支持|图片过大)/.test(text)) return text.slice(0, 100)
  }
  return null
}

async function loadFiles(context: PrepareDraftContext): Promise<File[]> {
  return Promise.all(context.task.assets.map(async asset => {
    try {
      return dataUrlToFile(await context.getAssetData(asset), asset)
    } catch (error) {
      context.uploadProgress?.fail(asset)
      throw error
    }
  }))
}

async function waitForUploadedPreviews(
  context: PrepareDraftContext,
  baseline: number,
  timeoutMs = 90_000
): Promise<void> {
  const expected = context.task.assets.length
  const deadline = Date.now() + timeoutMs
  let reported = 0
  while (Date.now() < deadline) {
    if (disposed) throw new Error("小红书发布任务已取消")
    const failure = uploadFailureMessage()
    if (failure) {
      for (const asset of context.task.assets.slice(reported)) context.uploadProgress?.fail(asset)
      throw new Error(`小红书图片上传失败：${failure}`)
    }
    const completed = Math.min(expected, Math.max(0, previewCount() - baseline))
    while (reported < completed) {
      context.uploadProgress?.complete(context.task.assets[reported]!)
      reported += 1
    }
    if (completed >= expected) {
      await delay(400)
      const finalFailure = uploadFailureMessage()
      if (finalFailure) throw new Error(`小红书图片上传失败：${finalFailure}`)
      return
    }
    await delay(250)
  }
  for (const asset of context.task.assets.slice(reported)) context.uploadProgress?.fail(asset)
  throw new Error(`小红书图片上传超时，仅识别到 ${reported}/${expected} 张图片`)
}

async function uploadImages(context: PrepareDraftContext): Promise<void> {
  if (!context.task.assets.length) throw new Error("小红书图文至少需要一张图片")
  const input = await openImageUploader()
  const files = await loadFiles(context)
  const baseline = previewCount()
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await waitForUploadedPreviews(context, baseline)
}

async function fillPlainEditable(editor: HTMLElement, value: string): Promise<void> {
  editor.focus()
  if (typeof ClipboardEvent !== "undefined" && typeof DataTransfer !== "undefined") {
    const clipboardData = new DataTransfer()
    clipboardData.setData("text/plain", value)
    editor.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData
    }))
    await delay(80)
  }
  const expectedPrefix = value.replace(/\s+/g, " ").trim().slice(0, 16)
  const current = editor.textContent?.replace(/\s+/g, " ").trim() ?? ""
  if (!expectedPrefix || !current.includes(expectedPrefix)) {
    editor.textContent = value
    const InputEventConstructor = editor.ownerDocument.defaultView?.InputEvent ?? InputEvent
    editor.dispatchEvent(new InputEventConstructor("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    }))
  }
  editor.dispatchEvent(new Event("change", { bubbles: true }))
  editor.dispatchEvent(new Event("blur", { bubbles: true }))
}

function formattedContent(context: PrepareDraftContext, body: string): string {
  const tags = context.task.article.tags
    .map(tag => tag.replace(/^#+|#+$/g, "").trim())
    .filter(Boolean)
    .map(tag => `#${tag}`)
    .join(" ")
  return [body.trim(), tags].filter(Boolean).join("\n\n")
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  disposed = false
  const article = prepareArticle(context, new Map(), config.titleLimit, config.shortLabel)
  await uploadImages(context)

  const title = await waitForAny<HTMLInputElement | HTMLTextAreaElement>(TITLE_SELECTORS, 20_000)
  if (!title) throw new PlatformPageChangedError(config.label, "标题输入框")
  fillTextControl(title, article.title)

  const editor = await waitForAny<HTMLElement>(EDITOR_SELECTORS, 20_000)
  if (!editor) throw new PlatformPageChangedError(config.label, "正文编辑器")
  await fillPlainEditable(editor, formattedContent(context, article.markdown))

  return {
    draftUrl: location.href,
    warnings: article.warnings
  }
}

function xiaohongshuLoginRequired(): boolean {
  if (loginPageDetected() || /\/login(?:[/?#]|$)/i.test(location.href)) return true
  const pageText = document.body.textContent?.replace(/\s+/g, " ") ?? ""
  const hasEditorEntry = Boolean(uploadTab() || imageUploadInput())
  return !hasEditorEntry && /(?:扫码登录|手机号登录|登录后创作)/.test(pageText)
}

export const xiaohongshuAdapter: PlatformAdapter = {
  id: "xiaohongshu",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return xiaohongshuLoginRequired()
      ? { loggedIn: false, message: "请先登录小红书创作服务平台" }
      : { loggedIn: true }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {
    disposed = true
  }
}

export const xiaohongshuFixtureHelpers = {
  actionable,
  formattedContent,
  previewCount,
  xiaohongshuLoginRequired
}
