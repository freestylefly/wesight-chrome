import { platformPlainText, replaceAssetTokens, sanitizePlatformHtml, truncateTitle } from "~lib/content"
import type { PrepareDraftContext } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

export async function waitForAny<T extends Element>(selectors: string[], timeoutMs = 20_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const element = document.querySelector<T>(selector)
      if (element) return element
    }
    await new Promise(resolve => window.setTimeout(resolve, 250))
  }
  return null
}

function dispatchValueEvents(element: Element): void {
  const EventConstructor = element.ownerDocument.defaultView?.Event ?? Event
  element.dispatchEvent(new EventConstructor("input", { bubbles: true }))
  element.dispatchEvent(new EventConstructor("change", { bubbles: true }))
  element.dispatchEvent(new EventConstructor("blur", { bubbles: true }))
}

export function fillTextControl(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  if (setter) setter.call(element, value)
  else element.value = value
  dispatchValueEvents(element)
}

export function fillEditable(
  element: HTMLElement,
  html: string,
  textFallback: string,
  options: { htmlOnlyClipboard?: boolean } = {}
): void {
  element.focus()
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    fillTextControl(element, textFallback)
    return
  }
  const safeHtml = sanitizePlatformHtml(html)
  if (typeof ClipboardEvent !== "undefined" && typeof DataTransfer !== "undefined") {
    const clipboardData = new DataTransfer()
    clipboardData.setData("text/html", safeHtml)
    // Zhihu routes every non-empty plain-text paste through its special-format
    // detector. An empty plain payload skips that detector while DraftJS still
    // imports the structured text/html payload through its native paste path.
    clipboardData.setData(
      "text/plain",
      options.htmlOnlyClipboard ? "" : platformPlainText(safeHtml) || textFallback
    )
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }))
  }
  if (!element.textContent?.trim()) element.innerHTML = safeHtml
  dispatchValueEvents(element)
}

function dataUrlToFile(dataUrl: string, asset: { fileName: string; mimeType: string }): File {
  const [header, payload = ""] = dataUrl.split(",", 2)
  const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new File([bytes], asset.fileName, { type: asset.mimeType })
}

async function uploadThroughInput(dataUrl: string, asset: { fileName: string; mimeType: string }, selectors: string[]): Promise<string | null> {
  if (!selectors.length) return null
  const input = await waitForAny<HTMLInputElement>(selectors, 1_500)
  if (!input) return null
  const previous = new Set(Array.from(document.images, image => image.currentSrc || image.src))
  const transfer = new DataTransfer()
  transfer.items.add(dataUrlToFile(dataUrl, asset))
  input.files = transfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const added = Array.from(document.images)
      .map(image => image.currentSrc || image.src)
      .find(url => /^https?:/i.test(url) && !previous.has(url))
    if (added) return added
    await new Promise(resolve => window.setTimeout(resolve, 300))
  }
  return null
}

export async function resolveAssetDataUrls(context: PrepareDraftContext): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  for (const asset of context.task.assets) urls.set(asset.id, await context.getAssetData(asset))
  return urls
}

export function referencedAssets(context: PrepareDraftContext): PublishAssetV1[] {
  const { html, markdown } = context.task.article
  return context.task.assets.filter(asset => {
    const token = `wesight-asset://${asset.id}`
    return html.includes(token) || markdown.includes(token)
  })
}

export async function selectAssetFile(
  context: PrepareDraftContext,
  assetId: string,
  selectors: string[]
): Promise<boolean> {
  const asset = context.task.assets.find(candidate => candidate.id === assetId)
  if (!asset) return false
  const input = await waitForAny<HTMLInputElement>(selectors, 2_000)
  if (!input) return false
  const transfer = new DataTransfer()
  transfer.items.add(dataUrlToFile(await context.getAssetData(asset), asset))
  input.files = transfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  input.dispatchEvent(new Event("input", { bubbles: true }))
  return true
}

export async function prepareAssetUrls(
  context: PrepareDraftContext,
  uploadSelectors: string[]
): Promise<{ urls: Map<string, string>; warnings: string[] }> {
  const urls = new Map<string, string>()
  const warnings: string[] = []
  for (const asset of context.task.assets) {
    const dataUrl = await context.getAssetData(asset)
    const uploaded = await uploadThroughInput(dataUrl, asset, uploadSelectors)
    urls.set(asset.id, uploaded ?? dataUrl)
    if (!uploaded) warnings.push(`图片“${asset.fileName}”已内嵌，请在发布前确认平台已完成上传`)
  }
  return { urls, warnings }
}

export function prepareArticle(
  context: PrepareDraftContext,
  urls: ReadonlyMap<string, string>,
  titleLimit: number,
  platformTitle: string
): { title: string; markdown: string; html: string; warnings: string[] } {
  const limited = truncateTitle(context.task.article.title, titleLimit)
  return {
    title: limited.title,
    markdown: replaceAssetTokens(context.task.article.markdown, urls),
    html: sanitizePlatformHtml(replaceAssetTokens(context.task.article.html, urls)),
    warnings: limited.truncated ? [`标题超过${platformTitle}上限，已按 ${titleLimit} 个字符填充`] : []
  }
}

export function loginPageDetected(): boolean {
  if (/(?:login|signin|passport)/i.test(location.href)) return true

  const candidates = document.querySelectorAll<HTMLElement>("form[action*='login' i], input[type='password']")
  return Array.from(candidates).some(element => {
    if (element instanceof HTMLInputElement && (element.disabled || element.readOnly)) return false
    for (let current: HTMLElement | null = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false
      const display = current.style.display.trim().toLowerCase()
      const visibility = current.style.visibility.trim().toLowerCase()
      if (display === "none" || visibility === "hidden" || visibility === "collapse") return false
    }
    return true
  })
}
