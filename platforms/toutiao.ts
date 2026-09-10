/*
 * Adapted from MultiPost-Extension src/sync/article/toutiao.ts (Apache-2.0).
 * WeSight changes: task-scoped assets, verified image URLs, progress reporting,
 * explicit login/errors, and manual-only final publication.
 */
import { PLATFORM_CONFIG } from "~platforms/config"
import { fillEditable, fillTextControl, loginPageDetected, prepareArticle, referencedAssets, waitForAny } from "~platforms/dom"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

const config = PLATFORM_CONFIG.toutiao

function dataUrlToFile(dataUrl: string, asset: PublishAssetV1): File {
  const [header, payload = ""] = dataUrl.split(",", 2)
  const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new File([bytes], asset.fileName, { type: asset.mimeType })
}

function remoteImageUrls(root: ParentNode = document): Set<string> {
  return new Set(Array.from(root.querySelectorAll<HTMLImageElement>("img"))
    .map(image => image.currentSrc || image.src)
    .filter(url => /^https?:\/\//i.test(url)))
}

async function waitForUploadedImage(previous: ReadonlySet<string>, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const added = Array.from(remoteImageUrls()).find(url => !previous.has(url))
    if (added) return added
    await new Promise(resolve => window.setTimeout(resolve, 250))
  }
  throw new Error("今日头条图片上传后未返回平台图片地址")
}

function visibleDrawer(predicate: (drawer: HTMLElement) => boolean): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(".byte-drawer"))
    .find(drawer => drawer.getBoundingClientRect().width > 0 && predicate(drawer)) ?? null
}

async function waitForVisibleDrawer(
  predicate: (drawer: HTMLElement) => boolean,
  timeoutMs = 5_000
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const drawer = visibleDrawer(predicate)
    if (drawer) return drawer
    await new Promise(resolve => window.setTimeout(resolve, 100))
  }
  return null
}

async function closeBodyImageDrawer(): Promise<void> {
  const drawer = visibleDrawer(candidate => {
    const text = candidate.textContent ?? ""
    return text.includes("上传图片") && !text.includes("封面图尺寸")
  })
  if (!drawer) return
  drawer.querySelector<HTMLElement>(".byte-drawer-close-icon")?.click()
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline && drawer.isConnected && drawer.getBoundingClientRect().width > 0) {
    await new Promise(resolve => window.setTimeout(resolve, 100))
  }
}

async function waitForCoverConfirm(drawer: HTMLElement, timeoutMs = 15_000): Promise<HTMLButtonElement | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const button = Array.from(drawer.querySelectorAll<HTMLButtonElement>("button"))
      .find(candidate => {
        const text = candidate.textContent?.trim()
        return (candidate.dataset.e2e === "imageUploadConfirm-btn" || text === "确定" || text === "完成")
          && !candidate.disabled
          && candidate.getAttribute("aria-disabled") !== "true"
      })
    if (button) return button
    await new Promise(resolve => window.setTimeout(resolve, 150))
  }
  return null
}

async function chooseBodyImageInput(): Promise<HTMLInputElement | null> {
  const direct = document.querySelector<HTMLInputElement>([
    "[data-e2e='editor-image-upload'] input[type='file']",
    "[data-e2e='image-upload'] input[type='file']",
    "input[data-e2e='editor-image-upload'][type='file']",
    ".syl-toolbar input[type='file'][accept*='image']",
    ".editor-container input[type='file'][accept*='image']",
    ".ProseMirror ~ input[type='file'][accept*='image']"
  ].join(","))
  if (direct) return direct

  const trigger = document.querySelector<HTMLElement>([
    ".syl-toolbar-tool.image button",
    ".syl-toolbar-tool.image .syl-toolbar-button",
    "[data-e2e='editor-image-upload'] button"
  ].join(","))
  trigger?.click()

  return waitForAny<HTMLInputElement>([
    "[data-e2e='image-upload'] input[type='file'][accept*='image']",
    "[data-e2e='editor-image-upload'] input[type='file'][accept*='image']",
    "input#upload-drag-input[type='file'][accept*='image']",
    "input[type='file'][accept*='image']"
  ], 5_000)
}

export async function uploadToutiaoBodyAsset(context: PrepareDraftContext, asset: PublishAssetV1): Promise<string> {
  const input = await chooseBodyImageInput()
  if (!input) throw new PlatformPageChangedError(config.label, "正文图片上传控件")
  const previous = remoteImageUrls()
  const transfer = new DataTransfer()
  transfer.items.add(dataUrlToFile(await context.getAssetData(asset), asset))
  input.files = transfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  input.dispatchEvent(new Event("input", { bubbles: true }))
  return waitForUploadedImage(previous)
}

async function uploadCover(context: PrepareDraftContext, asset: PublishAssetV1): Promise<void> {
  document.querySelectorAll<HTMLElement>(".article-cover-delete").forEach(button => button.click())
  const add = await waitForAny<HTMLElement>([".article-cover-add", "[data-e2e='article-cover-add']"], 2_000)
  if (!add) throw new PlatformPageChangedError(config.label, "封面上传控件")
  add.click()
  const drawer = await waitForVisibleDrawer(candidate => candidate.textContent?.includes("封面图尺寸") === true)
  if (!drawer) throw new PlatformPageChangedError(config.label, "封面图片抽屉")
  const uploadTab = Array.from(drawer.querySelectorAll<HTMLElement>(".byte-tabs-header-title"))
    .find(tab => tab.textContent?.includes("上传图片"))
  uploadTab?.click()
  const input = drawer.querySelector<HTMLInputElement>([
    "[data-e2e='image-upload'] input[type='file'][accept*='image']",
    "input#upload-drag-input[type='file'][accept*='image']",
    "input[type='file'][accept*='image']"
  ].join(","))
  if (!input) throw new PlatformPageChangedError(config.label, "封面文件选择框")
  const transfer = new DataTransfer()
  transfer.items.add(dataUrlToFile(await context.getAssetData(asset), asset))
  input.files = transfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  input.dispatchEvent(new Event("input", { bubbles: true }))
  const confirm = await waitForCoverConfirm(drawer)
  if (!confirm) {
    throw new Error("今日头条封面上传后无法确认，请重试")
  }
  confirm.click()
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const title = await waitForAny<HTMLTextAreaElement | HTMLInputElement>([
    "textarea[placeholder='请输入文章标题（2～30个字）']",
    "textarea[placeholder*='文章标题']",
    "input[placeholder*='文章标题']"
  ])
  const editor = await waitForAny<HTMLElement>([
    ".ProseMirror[contenteditable='true']",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true']"
  ])
  if (!title) throw new PlatformPageChangedError(config.label, "标题输入框")
  if (!editor) throw new PlatformPageChangedError(config.label, "正文编辑器")

  const urls = new Map<string, string>()
  for (const asset of referencedAssets(context)) {
    try {
      urls.set(asset.id, await uploadToutiaoBodyAsset(context, asset))
      context.uploadProgress?.complete(asset)
    } catch (error) {
      context.uploadProgress?.fail(asset)
      throw error
    }
  }
  await closeBodyImageDrawer()
  const article = prepareArticle(context, urls, config.titleLimit, config.shortLabel)
  fillTextControl(title, article.title)
  fillEditable(editor, article.html, article.markdown)

  const cover = context.task.article.coverAssetId
    ? context.task.assets.find(asset => asset.id === context.task.article.coverAssetId)
    : undefined
  if (cover) {
    try {
      await uploadCover(context, cover)
      context.uploadProgress?.complete(cover)
    } catch (error) {
      context.uploadProgress?.fail(cover)
      throw error
    }
  }
  return {
    draftUrl: location.href,
    warnings: [...article.warnings, "分类、声明和发布选项请在今日头条编辑页确认"]
  }
}

export const toutiaoAdapter: PlatformAdapter = {
  id: "toutiao",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginPageDetected() || location.hostname === "sso.toutiao.com"
      ? { loggedIn: false, message: "请先登录今日头条创作平台" }
      : { loggedIn: true }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {}
}
