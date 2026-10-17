import { postAssetFile } from "~lib/post-media"
import { PlatformPageChangedError, type PrepareDraftContext } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

function visible(element: Element): boolean {
  if (element.closest("[hidden], [aria-hidden='true']")) return false
  let current: Element | null = element
  while (current) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current)
    if (style?.display === "none" || style?.visibility === "hidden") return false
    current = current.parentElement
  }
  return true
}

function matchingInput(root: ParentNode): HTMLInputElement | null {
  return Array.from(root.querySelectorAll<HTMLInputElement>("input[type='file']"))
    .find(input => !input.disabled
      && (!input.parentElement || visible(input.parentElement))
      && /video\/|\.mp4|\.mov|\.webm|\.m4v/i.test(input.accept)) ?? null
}

function action(root: ParentNode, labels: string[]): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>("button, [role='button'], [role='tab'], .creator-tab, label, a, [title], [aria-label]"))
    .find(element => visible(element) && labels.some(label => (
      element.textContent?.trim() === label
      || element.getAttribute("aria-label") === label
      || element.getAttribute("title") === label
    ))) ?? null
}

const delay = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))

/** Finds the nearest composer containing both text and video controls. */
export function findPostVideoRoot(editor: Element): ParentNode {
  let ancestor = editor.parentElement
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    if (matchingInput(ancestor) || action(ancestor, ["视频", "添加视频", "上传视频"])) return ancestor
    ancestor = ancestor.parentElement
  }
  const knownComposer = editor.closest("[role='dialog'], form, [class*='composer'], [class*='Compose'], [class*='postForm']")
  if (knownComposer && knownComposer !== document.body && knownComposer !== document.documentElement) return knownComposer
  return (editor.parentElement !== document.body ? editor.parentElement : null) ?? editor
}

/**
 * Observes the platform's upload result. A local blob preview alone only proves
 * that the file was selected, so it never marks an upload as complete.
 */
export async function uploadPostVideo(input: {
  context: PrepareDraftContext
  asset: PublishAssetV1
  platform: string
  root?: ParentNode
  editor?: Element
  entryLabels?: string[]
  cancelled: () => boolean
  timeoutMs?: number
}): Promise<void> {
  const { context, asset, platform, cancelled } = input
  let root = input.editor ? findPostVideoRoot(input.editor) : input.root ?? document
  const checkCancelled = () => {
    if (cancelled()) throw new Error(`${platform}发布任务已取消`)
  }
  let fileInput = matchingInput(root)
  const openedEntries = new WeakSet<HTMLElement>()
  const openEntry = () => {
    const entry = action(root, input.entryLabels ?? ["视频", "添加视频", "上传视频"])
    if (entry && !openedEntries.has(entry)) {
      openedEntries.add(entry)
      entry.click()
    }
  }
  if (!fileInput) openEntry()
  const entryDeadline = Date.now() + 15_000
  while (!fileInput && Date.now() < entryDeadline) {
    checkCancelled()
    await delay(200)
    if (input.editor) root = findPostVideoRoot(input.editor)
    fileInput = matchingInput(root)
    if (!fileInput) openEntry()
  }
  if (!fileInput) throw new PlatformPageChangedError(platform, "视频上传控件，请在平台编辑页确认视频发布入口")

  // Keep feed videos outside the composer out of upload completion detection.
  const scope = fileInput.closest("[role='dialog'], form, [class*='composer'], [class*='Compose'], [class*='publish-page'], [class*='postForm']")
    ?? (root === document ? fileInput.parentElement : root)
    ?? root
  const textParts = (): string[] => {
    const parts: string[] = []
    const walker = document.createTreeWalker(scope as Node, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      const parent = node.parentElement
      if (!parent || parent.closest("[contenteditable='true'], textarea, script, style") || !visible(parent)) continue
      const text = node.textContent?.replaceAll(asset.fileName, "").replace(/\s+/g, " ").trim() ?? ""
      if (text) parts.push(text)
    }
    return parts
  }
  const completePattern = /(?:上传成功|上传完成|视频已上传|处理完成|转码完成|upload complete)/i
  const initialCompletionText = new Set(textParts().filter(text => completePattern.test(text)))
  const initialRemoteSources = new Set(Array.from(scope.querySelectorAll<HTMLVideoElement>("video"), video => video.currentSrc || video.src))
  let file: File
  try {
    file = await postAssetFile(context, asset)
  } catch (error) {
    context.uploadProgress?.fail(asset)
    throw error
  }
  const transfer = new DataTransfer()
  transfer.items.add(file)
  fileInput.files = transfer.files
  context.reportProgress?.("正在上传视频，等待平台处理完成")
  fileInput.dispatchEvent(new Event("change", { bubbles: true }))

  const deadline = Date.now() + (input.timeoutMs ?? 5 * 60_000)
  let observedBusy = false
  let readySince = 0
  try {
    while (Date.now() < deadline) {
      checkCancelled()
      const parts = textParts()
      const text = parts.join(" ")
      if (/(?:上传失败|转码失败|处理失败|不支持.{0,8}格式|格式不支持|视频过大|视频时长超出|upload failed)/i.test(text)) {
        throw new Error(`${platform}视频上传失败：${text.slice(0, 180)}`)
      }
      const progressBusy = Array.from(scope.querySelectorAll<HTMLElement>("progress, [role='progressbar']"))
        .some(element => {
          if (!visible(element)) return false
          if (element instanceof HTMLProgressElement) return !element.hasAttribute("value") || element.value < element.max
          const value = Number(element.getAttribute("aria-valuenow"))
          const max = Number(element.getAttribute("aria-valuemax") ?? 100)
          return !element.hasAttribute("aria-valuenow") || value < max
        })
      const busy = progressBusy || /(?:正在上传|上传中|正在处理|处理中|正在转码|转码中|uploading|processing|transcoding)/i.test(text)
      observedBusy ||= busy
      const completeMessage = parts.some(part => completePattern.test(part)
        && (observedBusy || !initialCompletionText.has(part)))
      const newRemoteVideo = Array.from(scope.querySelectorAll<HTMLVideoElement>("video"))
        .some(video => {
          const src = video.currentSrc || video.src
          return /^https?:\/\//i.test(src) && !initialRemoteSources.has(src)
        })
      const publish = action(scope, ["发布", "发送", "发布动态", "发布笔记"])
      const publishEnabled = publish && !(publish instanceof HTMLButtonElement && publish.disabled)
        && publish.getAttribute("aria-disabled") !== "true"
      const ready = !busy && (completeMessage || (newRemoteVideo && publishEnabled))
      readySince = ready ? readySince || Date.now() : 0
      if (readySince && Date.now() - readySince >= 1_000) {
        context.uploadProgress?.complete(asset)
        return
      }
      await delay(250)
    }
    throw new Error(`${platform}视频上传或处理超时，请在平台编辑页检查后重试`)
  } catch (error) {
    context.uploadProgress?.fail(asset)
    throw error
  }
}
