import { PLATFORM_CONFIG } from "~platforms/config"
import { postVideoAsset } from "~lib/post-media"
import { fillEditable, fillTextControl, loginPageDetected, waitForAny } from "~platforms/dom"
import { uploadPostVideo } from "~platforms/post-video"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

const config = PLATFORM_CONFIG["weibo-post"]

const EDITOR_SELECTORS = [
  "textarea[placeholder*='有什么新鲜事']",
  "textarea[placeholder*='分享新鲜事']",
  "[contenteditable='true'][role='textbox']",
  "[contenteditable='true'][data-placeholder*='有什么新鲜事']",
  "[class*='composer'] [contenteditable='true']",
  "[class*='Compose'] [contenteditable='true']"
]

const IMAGE_INPUT_SELECTORS = [
  "input[type='file'][accept*='image']",
  "input[type='file'][accept*='.jpg']",
  "input[type='file'][accept*='.png']"
]

const PREVIEW_SELECTORS = [
  "[class*='picbed'] img",
  "[class*='composer'] [class*='pic'] img",
  "[class*='Compose'] [class*='pic'] img",
  "[class*='picture'] [class*='item'] img",
  "[class*='Pic'] [class*='item'] img",
  "[class*='upload'] [class*='item'] img",
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

function editorText(element: HTMLInputElement | HTMLTextAreaElement | HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value
  return element.textContent ?? ""
}

function dataUrlToFile(dataUrl: string, asset: PublishAssetV1): File {
  const [header, payload = ""] = dataUrl.split(",", 2)
  const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new File([bytes], asset.fileName, { type: asset.mimeType })
}

function previewCount(): number {
  const editor = EDITOR_SELECTORS
    .map(selector => document.querySelector(selector))
    .find(element => element && visible(element)) ?? null
  const input = IMAGE_INPUT_SELECTORS
    .map(selector => document.querySelector(selector))
    .find(element => element && visible(element)) ?? null

  let scope: ParentNode = document
  if (editor && input) {
    let ancestor: HTMLElement | null = input.parentElement
    while (ancestor && !ancestor.contains(editor)) ancestor = ancestor.parentElement
    if (ancestor) scope = ancestor
  }

  return Math.max(0, ...PREVIEW_SELECTORS.map(selector => (
    Array.from(scope.querySelectorAll(selector)).filter(visible).length
  )))
}

function uploadFailureMessage(): string | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    "[class*='composer'], [class*='Compose'], [class*='upload'], [role='alert']"
  )
  for (const candidate of candidates) {
    const text = candidate.textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (/(?:上传失败|图片失败|重试上传|格式不支持|图片过大)/.test(text)) return text.slice(0, 160)
  }
  return null
}

function findComposerAction(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>("button, a, [role='button']")
  return Array.from(candidates).find(element => {
    if (!visible(element)) return false
    const text = element.textContent?.replace(/\s+/g, "").trim() ?? ""
    return text === "发微博" || text === "写微博"
  }) ?? null
}

async function waitForEditor(): Promise<HTMLInputElement | HTMLTextAreaElement | HTMLElement | null> {
  let editor = await waitForAny<HTMLInputElement | HTMLTextAreaElement | HTMLElement>(EDITOR_SELECTORS, 8_000)
  if (editor) return editor
  findComposerAction()?.click()
  editor = await waitForAny<HTMLInputElement | HTMLTextAreaElement | HTMLElement>(EDITOR_SELECTORS, 12_000)
  return editor
}

function loginRequired(): boolean {
  if (loginPageDetected()) return true
  const body = document.body?.textContent?.replace(/\s+/g, " ") ?? ""
  return /(?:登录后查看更多|请先登录|短信登录|扫码登录)/.test(body)
    && !EDITOR_SELECTORS.some(selector => document.querySelector(selector))
}

async function uploadImages(context: PrepareDraftContext): Promise<void> {
  if (!context.task.assets.length) return
  const input = await waitForAny<HTMLInputElement>(IMAGE_INPUT_SELECTORS, 15_000)
  if (!input) throw new PlatformPageChangedError(config.label, "图片上传控件")
  const files = await Promise.all(context.task.assets.map(async asset => (
    dataUrlToFile(await context.getAssetData(asset), asset)
  )))
  const baseline = previewCount()
  const transfer = new DataTransfer()
  files.forEach(file => transfer.items.add(file))
  input.files = transfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  input.dispatchEvent(new Event("input", { bubbles: true }))

  const deadline = Date.now() + 90_000
  let reported = 0
  while (Date.now() < deadline) {
    if (disposed) throw new Error("微博发布任务已取消")
    const failure = uploadFailureMessage()
    if (failure) {
      context.uploadProgress?.fail(context.task.assets[Math.min(reported, context.task.assets.length - 1)]!)
      throw new Error(`微博图片上传失败：${failure}`)
    }
    const completed = Math.min(context.task.assets.length, Math.max(0, previewCount() - baseline))
    while (reported < completed) {
      context.uploadProgress?.complete(context.task.assets[reported]!)
      reported += 1
    }
    if (completed >= context.task.assets.length) return
    await delay(250)
  }
  throw new Error(`微博图片上传超时，仅识别到 ${reported}/${context.task.assets.length} 张图片`)
}

function fillComposer(
  editor: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
  content: string
): void {
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    fillTextControl(editor, content)
    return
  }
  fillEditable(editor, `<p>${escapeHtml(content).replace(/\n/g, "<br>")}</p>`, content)
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
  if (loginRequired()) {
    return Promise.reject(new Error("请先登录微博，登录完成后从发布助手重试"))
  }
  const editor = await waitForEditor()
  if (!editor) throw new PlatformPageChangedError(config.label, "微博正文编辑器")

  const topics = context.task.article.tags
    .map(topic => topic.replace(/^#+|#+$/g, "").trim())
    .filter(Boolean)
    .map(topic => `#${topic}#`)
    .join(" ")
  const content = [context.task.article.markdown.trim(), topics].filter(Boolean).join("\n\n")
  if (Array.from(content).length > config.titleLimit) {
    throw new Error(`微博正文和话题合计超过 ${config.titleLimit} 个字符，请精简文案后重试`)
  }
  fillComposer(editor, content)
  await delay(500)
  const expected = content.replace(/\s+/g, " ").trim().slice(0, 16)
  const actual = editorText(editor).replace(/\s+/g, " ").trim()
  if (expected && !actual.includes(expected)) throw new Error("微博正文填充失败，请重试")

  if (video) {
    await uploadPostVideo({
      context,
      asset: video,
      platform: "微博",
      editor,
      cancelled: () => disposed
    })
  } else {
    await uploadImages(context)
  }
  await delay(800)
  return { draftUrl: location.href, warnings: [] }
}

export const weiboPostAdapter: PlatformAdapter = {
  id: "weibo-post",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginRequired()
      ? { loggedIn: false, message: "请先登录微博，登录完成后重试" }
      : { loggedIn: true }
  },
  prepareDraft,
  retry: prepareDraft,
  dispose() {
    disposed = true
  }
}

export const weiboPostFixtureHelpers = {
  previewCount,
  loginRequired
}
