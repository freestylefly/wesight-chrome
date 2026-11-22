import { PLATFORM_CONFIG } from "~platforms/config"
import { loginPageDetected } from "~platforms/dom"
import {
  attachImages,
  bodyWithHashtags,
  compactText,
  delay,
  findAction,
  imageAssets,
  insertText,
  normalizedTags,
  overLimitError,
  queryVisible,
  skippedVideoWarning,
  visible,
  waitFor
} from "~platforms/overseas/common"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"

/*
 * Instagram web "Create new post" flow: select images → Crop → Edit → caption.
 * The adapter advances through the Crop and Edit steps with "Next" (these do
 * not publish) and always stops on the caption step before "Share". UNVERIFIED.
 */
const config = PLATFORM_CONFIG["instagram-post"]
const TEXT_LIMIT = 2200
const IMAGE_LIMIT = 10
const HASHTAG_LIMIT = 30

const FILE_INPUT_SELECTORS = ["[role='dialog'] input[type='file']"]
const CAPTION_SELECTORS = [
  "[role='dialog'] [contenteditable='true'][aria-label*='caption']",
  "[role='dialog'] [contenteditable='true'][aria-label*='Caption']",
  "[role='dialog'] [contenteditable='true'][role='textbox']"
]

function labelOf(element: Element): string {
  return (element.getAttribute("aria-label") ?? compactText(element)).trim()
}

function dialogControls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[role='dialog'] button, [role='dialog'] [role='button']"))
    .filter(element => visible(element))
}

function shareVisible(): boolean {
  return dialogControls().some(element => /^share$/i.test(labelOf(element)))
}

/** "Next" inside the create dialog. Never returned once the Share step is visible. */
function nextStepControl(): HTMLElement | null {
  if (shareVisible()) return null
  return dialogControls().find(element => /^next$/i.test(labelOf(element))) ?? null
}

/** The (visually hidden) file input of an open create dialog. */
function createDialogInput(): HTMLInputElement | null {
  return Array.from(document.querySelectorAll<HTMLInputElement>(FILE_INPUT_SELECTORS[0]!))
    .find(input => !input.disabled && visible(input.closest("[role='dialog']")!)) ?? null
}

/** Opens Create → Post. Only used while no create dialog exists, so nothing can be published. */
async function openCreateDialog(): Promise<void> {
  if (createDialogInput()) return
  findAction([/^new post$/i, /^create$/i])?.click()
  if (await waitFor(createDialogInput, 1_500)) return
  // The newer sidebar opens a small menu whose "Post" entry starts the flow.
  const postEntry = Array.from(document.querySelectorAll<HTMLElement>("a, [role='link'], [role='menuitem'], [role='button']"))
    .find(element => visible(element) && !element.closest("[role='dialog']") && labelOf(element) === "Post")
  postEntry?.click()
}

function loginRequired(): boolean {
  if (loginPageDetected() || /^\/accounts\/(?:login|emailsignup)/.test(location.pathname)) return true
  if (createDialogInput() || findAction([/^new post$/i, /^create$/i])) return false
  return !!findAction([/^log in$/i, /^sign up$/i])
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const { task } = context
  if (loginRequired()) throw new Error("请先登录 Instagram，登录完成后从发布助手重试")
  const warnings: string[] = [...skippedVideoWarning(task, "Instagram")]
  let images = imageAssets(task)
  if (!images.length) throw new Error("Instagram 网页版发帖至少需要一张图片，请添加图片后重试")
  if (images.length > IMAGE_LIMIT) {
    for (const asset of images.slice(IMAGE_LIMIT)) context.uploadProgress?.skip?.(asset)
    warnings.push(`Instagram 最多 ${IMAGE_LIMIT} 张图片，已跳过后 ${images.length - IMAGE_LIMIT} 张`)
    images = images.slice(0, IMAGE_LIMIT)
  }
  if (normalizedTags(task).length > HASHTAG_LIMIT) throw new Error(`Instagram 每条最多 ${HASHTAG_LIMIT} 个话题标签，请减少标签后重试`)
  const caption = bodyWithHashtags(task)
  if (caption.length > TEXT_LIMIT) throw overLimitError("Instagram", TEXT_LIMIT, caption.length)

  const existingCaption = queryVisible<HTMLElement>(CAPTION_SELECTORS)
  if (existingCaption) {
    // A retry on the caption step keeps the images already chosen.
    if (caption && !(await insertText(existingCaption, caption))) throw new Error("Instagram 图片说明填充失败，请重试")
    return { draftUrl: location.href, warnings: [...warnings, "已保留创建窗口中的图片，请检查是否齐全"] }
  }
  await openCreateDialog()
  const input = await waitFor(createDialogInput, 12_000)
  if (!input) throw new PlatformPageChangedError(config.label, "创建帖子窗口")
  warnings.push(...await attachImages({
    context,
    assets: images,
    platform: "Instagram",
    root: input.closest("[role='dialog']") ?? document,
    inputSelectors: FILE_INPUT_SELECTORS,
    required: true,
    previewTimeoutMs: 1_000
  }).then(list => list.filter(warning => !warning.includes("未确认预览"))))

  // Crop and Edit steps; stop as soon as the caption editor appears.
  for (let step = 0; step < 3; step += 1) {
    const ready = await waitFor(() => queryVisible<HTMLElement>(CAPTION_SELECTORS) ?? nextStepControl(), 20_000, 200)
    if (!ready) break
    if (ready.matches(CAPTION_SELECTORS.join(","))) break
    ready.click()
    await delay(800)
  }
  const editor = queryVisible<HTMLElement>(CAPTION_SELECTORS)
  if (!editor) throw new PlatformPageChangedError(config.label, "图片说明输入框")
  if (caption && !(await insertText(editor, caption))) throw new Error("Instagram 图片说明填充失败，请重试")
  return { draftUrl: location.href, warnings }
}

export const instagramPostAdapter: PlatformAdapter = {
  id: "instagram-post",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginRequired() ? { loggedIn: false, message: "请先登录 Instagram，登录完成后重试" } : { loggedIn: true }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {}
}
