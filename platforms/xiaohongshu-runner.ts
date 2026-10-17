import type { ExtensionResponse } from "~types/messages"
import type { PublishTaskV1 } from "~types/protocol"

export type XiaohongshuInjectedResult =
  | { kind: "ready"; draftUrl: string; warnings: string[] }
  | { kind: "login_required"; message: string }

/**
 * This function is serialized by chrome.scripting.executeScript. Keep every
 * runtime helper inside the function body and avoid references to module-level
 * values.
 */
export async function runXiaohongshuPageTask(task: PublishTaskV1): Promise<XiaohongshuInjectedResult> {
  // Video tasks use the regular content-script adapter, which supports Blob
  // transport. Keep this image-only serialized runner away from video files.
  if (task.media?.videoAssetId || task.assets.some(asset => asset.mimeType.startsWith("video/"))) {
    throw new Error("视频任务需要通过视频发布入口重试")
  }
  const TITLE_LIMIT = 20
  const PREVIEW_SELECTORS = [
    ".img-preview-area .img-container",
    ".img-preview-area [class*='preview-item']",
    ".img-preview-area img",
    ".upload-list [class*='item']",
    "[class*='image-list'] [class*='item']",
    "[class*='preview-list'] [class*='item']",
    "[data-testid='image-preview']"
  ]

  const delay = (milliseconds: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, milliseconds))

  const visible = (element: Element): boolean => {
    if (!(element instanceof HTMLElement)) return true
    if (element.hidden || element.closest("[aria-hidden='true']")) return false
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    return style?.display !== "none" && style?.visibility !== "hidden"
  }

  const actionable = (element: HTMLElement): boolean => {
    if (!visible(element)) return false
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    const opacity = Number.parseFloat(style?.opacity || "1")
    const zIndex = Number.parseInt(style?.zIndex || "0", 10)
    if (style?.pointerEvents === "none" || opacity < 0.01 || zIndex < 0) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0
      && rect.height > 0
      && rect.right > 0
      && rect.bottom > 0
      && rect.left < window.innerWidth
      && rect.top < window.innerHeight
  }

  const uploadTab = (): HTMLElement | null => {
    const candidates = document.querySelectorAll<HTMLElement>(".creator-tab, button, [role='tab']")
    return Array.from(candidates).find(element => actionable(element) && element.textContent?.trim() === "上传图文") ?? null
  }

  const imageUploadInput = (): HTMLInputElement | null => {
    const candidates = document.querySelectorAll<HTMLInputElement>("input[type='file']")
    return Array.from(candidates).find(input => {
      const accept = input.accept.toLowerCase()
      return visible(input)
        && input.multiple
        && /(?:image\/|\.jpe?g|\.png|\.webp)/.test(accept)
    }) ?? null
  }

  const waitFor = async <T>(read: () => T | null, timeoutMs: number): Promise<T | null> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const value = read()
      if (value) return value
      await delay(200)
    }
    return null
  }

  const sendExtension = async <T>(message: unknown): Promise<T> => {
    const response = await chrome.runtime.sendMessage(message) as ExtensionResponse<T>
    if (!response?.ok) throw new Error(response?.error ?? "扩展后台响应失败")
    return response.value as T
  }

  const reportProgress = async (completed: number, total: number): Promise<void> => {
    await sendExtension<boolean>({
      type: "XIAOHONGSHU_UPLOAD_PROGRESS",
      taskId: task.taskId,
      completed,
      total
    })
  }

  const dataUrlToFile = (dataUrl: string, fileName: string, mimeType: string): File => {
    const [header, payload = ""] = dataUrl.split(",", 2)
    const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new File([bytes], fileName, { type: mimeType })
  }

  const previewCount = (): number => Math.max(0, ...PREVIEW_SELECTORS.map(selector => (
    Array.from(document.querySelectorAll(selector)).filter(visible).length
  )))

  const uploadFailureMessage = (): string | null => {
    const containers = document.querySelectorAll<HTMLElement>(
      ".img-preview-area, .upload-list, [class*='image-list'], [class*='preview-list'], [class*='upload']"
    )
    for (const container of containers) {
      const text = container.textContent?.replace(/\s+/g, " ").trim() ?? ""
      if (/(?:上传失败|重新上传|格式不支持|图片过大)/.test(text)) return text.slice(0, 100)
    }
    return null
  }

  const riskControlMessage = (): string | null => {
    const text = document.body.textContent?.replace(/\s+/g, " ") ?? ""
    return /浏览器异常|限制访问|风险插件/.test(text)
      ? "小红书触发浏览器安全限制，请关闭冲突扩展或重启浏览器后重试"
      : null
  }

  const pageText = document.body.textContent?.replace(/\s+/g, " ") ?? ""
  if (/\/login(?:[/?#]|$)/i.test(location.href) || /(?:扫码登录|手机号登录|登录后创作)/.test(pageText)) {
    return { kind: "login_required", message: "请先登录小红书创作服务平台" }
  }
  if (!task.assets.length) throw new Error("小红书图文至少需要一张图片")

  // Match the stable flow used by MultiPost: allow the image editor to settle,
  // prefer its direct file input, and only switch tabs when the input is absent.
  await delay(1_000)
  let input = imageUploadInput()
  if (!input) {
    const tab = await waitFor(uploadTab, 15_000)
    if (!tab) throw new Error("小红书图文 页面结构可能已更新，未找到上传图文入口")
    tab.click()
    await delay(1_000)
    input = await waitFor(imageUploadInput, 15_000)
  }
  if (!input) throw new Error(riskControlMessage() ?? "小红书图文 页面结构可能已更新，未找到批量图片上传控件")

  const files = await Promise.all(task.assets.map(async asset => {
    const dataUrl = await sendExtension<string>({ type: "GET_ASSET_DATA", taskId: task.taskId, asset })
    return dataUrlToFile(dataUrl, asset.fileName, asset.mimeType)
  }))
  const baseline = previewCount()
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await reportProgress(0, task.assets.length)
  await delay(2_000)

  const deadline = Date.now() + 90_000
  let reported = 0
  while (Date.now() < deadline) {
    const risk = riskControlMessage()
    if (risk) throw new Error(risk)
    const failure = uploadFailureMessage()
    if (failure) throw new Error(`小红书图片上传失败：${failure}`)
    const completed = Math.min(task.assets.length, Math.max(0, previewCount() - baseline))
    while (reported < completed) {
      reported += 1
      await reportProgress(reported, task.assets.length)
    }
    if (completed >= task.assets.length) break
    await delay(250)
  }
  if (reported < task.assets.length) {
    throw new Error(`小红书图片上传超时，仅识别到 ${reported}/${task.assets.length} 张图片`)
  }
  await delay(3_000)
  const riskAfterUpload = riskControlMessage()
  if (riskAfterUpload) throw new Error(riskAfterUpload)

  const title = await waitFor(() => {
    const selectors = [
      "input[placeholder*='填写标题']",
      "input[placeholder*='标题']",
      "textarea[placeholder*='填写标题']",
      "textarea[placeholder*='标题']",
      "input.d-text"
    ]
    for (const selector of selectors) {
      const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
      if (element && visible(element)) return element
    }
    return null
  }, 20_000)
  if (!title) throw new Error("小红书图文 页面结构可能已更新，未找到标题输入框")

  const titleCharacters = Array.from(task.article.title)
  const limitedTitle = titleCharacters.slice(0, TITLE_LIMIT).join("")
  title.value = limitedTitle
  title.dispatchEvent(new Event("input", { bubbles: true }))
  await delay(500)

  const editor = await waitFor(() => {
    const selectors = [
      ".ql-editor[contenteditable='true']",
      ".tiptap[contenteditable='true']",
      "div[contenteditable='true'][role='textbox']",
      "div[contenteditable='true'][data-placeholder*='正文']",
      "div[contenteditable='true']"
    ]
    for (const selector of selectors) {
      const element = document.querySelector<HTMLElement>(selector)
      if (element && visible(element)) return element
    }
    return null
  }, 20_000)
  if (!editor) throw new Error("小红书图文 页面结构可能已更新，未找到正文编辑器")

  const tags = task.article.tags
    .map(tag => tag.replace(/^#+|#+$/g, "").trim())
    .filter(Boolean)
    .map(tag => `#${tag}`)
    .join(" ")
  const content = [task.article.markdown.trim(), tags].filter(Boolean).join("\n\n")
  editor.focus()
  const clipboardData = new DataTransfer()
  clipboardData.setData("text/plain", content)
  editor.dispatchEvent(new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData
  }))
  await delay(1_000)
  editor.blur()

  const expectedPrefix = content.replace(/\s+/g, " ").trim().slice(0, 16)
  const actualContent = editor.textContent?.replace(/\s+/g, " ").trim() ?? ""
  if (expectedPrefix && !actualContent.includes(expectedPrefix)) {
    throw new Error("小红书正文填充失败，请重试")
  }

  // Xiaohongshu can surface its anti-spam dialog shortly after the editor is
  // populated. Keep the task in progress until that delayed result is known.
  const stabilityDeadline = Date.now() + 3_000
  while (Date.now() < stabilityDeadline) {
    const risk = riskControlMessage()
    if (risk) throw new Error(risk)
    await delay(250)
  }

  const warnings = titleCharacters.length > TITLE_LIMIT
    ? [`标题超过小红书上限，已按 ${TITLE_LIMIT} 个字符填充`]
    : []
  return { kind: "ready", draftUrl: location.href, warnings }
}
