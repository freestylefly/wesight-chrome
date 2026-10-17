import { PLATFORM_CONFIG } from "~platforms/config"
import { postVideoAsset } from "~lib/post-media"
import { fillEditable, fillTextControl, loginPageDetected, waitForAny } from "~platforms/dom"
import { uploadPostVideo } from "~platforms/post-video"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

const config = PLATFORM_CONFIG["jike-post"]

const EDITOR_SELECTORS = [
  "[role='dialog'] [contenteditable='true'][role='textbox']",
  "textarea[placeholder*='分享']",
  "textarea[placeholder*='动态']",
  "[contenteditable='true'][role='textbox']",
  "[contenteditable='true'][data-placeholder*='分享']",
  "[contenteditable='true'][data-placeholder*='动态']",
  "[class*='composer'] [contenteditable='true']",
  "[class*='Editor'] [contenteditable='true']"
]

const IMAGE_INPUT_SELECTORS = [
  "input[type='file'][accept*='image']",
  "input[type='file'][accept*='.jpg']",
  "input[type='file'][accept*='.png']"
]

const PREVIEW_SELECTORS = [
  "[class*='preview'] img",
  "[class*='upload'] img",
  "[class*='image-list'] img",
  "[class*='ImageList'] img",
  "[data-testid*='media'] img"
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

function compactText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? ""
}

function loginRequired(): boolean {
  if (location.pathname.startsWith("/login") || loginPageDetected()) return true
  const body = document.body?.textContent?.replace(/\s+/g, " ") ?? ""
  return /(?:登录即刻|即刻 App 扫码|可使用即刻 App 扫码|扫码登录)/.test(body)
    && !EDITOR_SELECTORS.some(selector => document.querySelector(selector))
}

function findComposerAction(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>("button, a, [role='button']")
  return Array.from(candidates).find(element => {
    if (!visible(element)) return false
    const text = compactText(element).replace(/\s+/g, "")
    return ["创建动态", "发布动态", "写动态", "发动态", "分享动态"].includes(text)
  }) ?? null
}

async function waitForEditor(): Promise<HTMLInputElement | HTMLTextAreaElement | HTMLElement | null> {
  let editor = await waitForAny<HTMLInputElement | HTMLTextAreaElement | HTMLElement>(EDITOR_SELECTORS, 1_500)
  if (editor) return editor
  findComposerAction()?.click()
  editor = await waitForAny<HTMLInputElement | HTMLTextAreaElement | HTMLElement>(EDITOR_SELECTORS, 12_000)
  return editor
}

function editorText(element: HTMLInputElement | HTMLTextAreaElement | HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value
  return element.textContent ?? ""
}

function fillComposer(
  editor: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
  content: string
): void {
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    fillTextControl(editor, content)
    return
  }

  editor.focus()
  const selection = editor.ownerDocument.getSelection()
  const range = editor.ownerDocument.createRange()
  range.selectNodeContents(editor)
  selection?.removeAllRanges()
  selection?.addRange(range)
  fillEditable(editor, composerHtml(content), content)
  selection?.removeAllRanges()
}

function composerHtml(content: string): string {
  const normalized = content.replace(/\r\n?/g, "\n")
  return `<p>${escapeHtml(normalized).replace(/\n/g, "<br>")}</p>`
}

function dataUrlToFile(dataUrl: string, asset: PublishAssetV1): File {
  const [header, payload = ""] = dataUrl.split(",", 2)
  const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new File([bytes], asset.fileName, { type: asset.mimeType })
}

function findUploadRoot(input: HTMLInputElement): ParentNode {
  return input.closest(
    "[class*='Dropzone-root'], [class*='postForm'], [role='dialog'], form"
  ) ?? input.parentElement ?? document
}

function previewCount(root: ParentNode = document): number {
  const matched = new Set<Element>()
  for (const selector of PREVIEW_SELECTORS) {
    for (const element of root.querySelectorAll(selector)) {
      if (visible(element)) matched.add(element)
    }
  }
  if (matched.size) return matched.size

  // Jike currently hashes the media-preview class names. When no semantic
  // selector matches, use the upload control's own Dropzone as the boundary
  // and exclude the smaller avatar and sponsor icons rendered in that box.
  for (const image of root.querySelectorAll("img[src]")) {
    if (!visible(image)) continue
    const rect = image.getBoundingClientRect()
    const style = image.ownerDocument.defaultView?.getComputedStyle(image)
    const width = Math.max(rect.width, Number.parseFloat(style?.width ?? "0") || 0)
    const height = Math.max(rect.height, Number.parseFloat(style?.height ?? "0") || 0)
    if (width >= 48 && height >= 48) matched.add(image)
  }
  return matched.size
}

function uploadFailureMessage(): string | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    "[class*='composer'], [class*='Editor'], [class*='upload'], [role='alert']"
  )
  for (const candidate of candidates) {
    const text = compactText(candidate)
    if (/(?:上传失败|图片失败|重试上传|格式不支持|图片过大)/.test(text)) return text.slice(0, 160)
  }
  return null
}

async function uploadImages(context: PrepareDraftContext): Promise<void> {
  if (!context.task.assets.length) return
  const input = await waitForAny<HTMLInputElement>(IMAGE_INPUT_SELECTORS, 15_000)
  if (!input) throw new PlatformPageChangedError(config.label, "图片上传控件")
  const files = await Promise.all(context.task.assets.map(async asset => (
    dataUrlToFile(await context.getAssetData(asset), asset)
  )))
  const uploadRoot = findUploadRoot(input)
  const transfer = new DataTransfer()
  files.forEach(file => transfer.items.add(file))
  input.files = transfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  input.dispatchEvent(new Event("input", { bubbles: true }))

  const deadline = Date.now() + 90_000
  let reported = 0
  while (Date.now() < deadline) {
    if (disposed) throw new Error("即刻发布任务已取消")
    const failure = uploadFailureMessage()
    if (failure) {
      context.uploadProgress?.fail(context.task.assets[Math.min(reported, context.task.assets.length - 1)]!)
      throw new Error(`即刻图片上传失败：${failure}`)
    }
    const completed = Math.min(
      context.task.assets.length,
      previewCount(uploadRoot)
    )
    while (reported < completed) {
      context.uploadProgress?.complete(context.task.assets[reported]!)
      reported += 1
    }
    if (completed >= context.task.assets.length) return
    await delay(250)
  }
  throw new Error(`即刻图片上传超时，仅识别到 ${reported}/${context.task.assets.length} 张图片`)
}

async function chooseCircle(circle: string): Promise<boolean> {
  if (!circle.trim()) return false
  const triggers = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']"))
  const trigger = triggers.find(element => {
    if (!visible(element)) return false
    return /(?:选择圈子|发布到|选择话题|选择一个圈子)/.test(compactText(element))
  })
  if (!trigger) return false
  trigger.click()
  await delay(300)
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    "[role='option'], [role='menuitem'], [role='dialog'] button, [role='dialog'] [role='button'], [class*='topic'] button, [class*='circle'] button"
  ))
  const option = candidates.find(element => visible(element) && compactText(element) === circle.trim())
  if (!option) return false
  option.click()
  await delay(250)
  return true
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

async function prepareDraft(context: PrepareDraftContext) {
  disposed = false
  const video = postVideoAsset(context.task)
  if (loginRequired()) throw new Error("请先登录即刻，登录完成后从发布助手重试")
  const editor = await waitForEditor()
  if (!editor) throw new PlatformPageChangedError(config.label, "动态正文编辑器")

  const content = context.task.article.markdown.trim()
  if (Array.from(content).length > config.titleLimit) {
    throw new Error(`即刻动态正文超过 ${config.titleLimit} 个字符，请精简文案后重试`)
  }
  fillComposer(editor, content)
  await delay(450)
  const expected = content.replace(/\s+/g, "").slice(0, 16)
  const actual = editorText(editor).replace(/\s+/g, "")
  if (expected && !actual.includes(expected)) throw new Error("即刻动态正文填充失败，请重试")

  if (video) {
    await uploadPostVideo({
      context,
      asset: video,
      platform: "即刻",
      editor,
      cancelled: () => disposed
    })
  } else {
    await uploadImages(context)
  }
  const circle = context.task.targetOptions?.jikePost?.circle?.trim() ?? ""
  const circleSelected = circle ? await chooseCircle(circle) : false
  const warnings = circle && !circleSelected
    ? [`未自动选择圈子“${circle}”，请在即刻编辑页确认`]
    : []
  await delay(500)
  return { draftUrl: location.href, warnings }
}

export const jikePostAdapter: PlatformAdapter = {
  id: "jike-post",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginRequired()
      ? { loggedIn: false, message: "请先登录即刻，登录完成后重试" }
      : { loggedIn: true }
  },
  prepareDraft,
  retry: prepareDraft,
  dispose() {
    disposed = true
  }
}

export const jikePostFixtureHelpers = {
  loginRequired,
  previewCount,
  findUploadRoot,
  chooseCircle,
  findComposerAction,
  composerHtml
}
