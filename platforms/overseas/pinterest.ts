import { truncateTitle } from "~lib/content"
import { PLATFORM_CONFIG } from "~platforms/config"
import { fillTextControl, loginPageDetected } from "~platforms/dom"
import {
  attachImages,
  findAction,
  imageAssets,
  insertText,
  normalizedTags,
  overLimitError,
  postBody,
  postTitle,
  queryVisible,
  skippedVideoWarning,
  waitFor
} from "~platforms/overseas/common"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"

/* Pinterest pin creation tool. One image per pin; the board is never chosen. UNVERIFIED. */
const config = PLATFORM_CONFIG["pinterest-post"]
const DESCRIPTION_LIMIT = 500

const UPLOAD_SELECTORS = [
  "input#storyboard-upload-input",
  "input[type='file'][aria-label*='upload']",
  "input[type='file'][aria-label*='Upload']",
  "input[type='file'][accept*='image']"
]
const TITLE_SELECTORS = [
  "input#storyboard-selector-title",
  "input[placeholder*='Add a title']",
  "textarea[placeholder*='Add a title']",
  "input[name='title']"
]
const DESCRIPTION_SELECTORS = [
  "[contenteditable='true'][aria-label*='description']",
  "[contenteditable='true'][aria-label*='Description']",
  "textarea[placeholder*='description']",
  "textarea#storyboard-selector-description",
  "[data-test-id*='description'] [contenteditable='true']"
]

function enabled<T extends HTMLElement>(selectors: string[]): T | null {
  const element = queryVisible<T>(selectors)
  if (!element) return null
  if ((element as unknown as HTMLInputElement).disabled || element.getAttribute("aria-disabled") === "true") return null
  return element
}

function loginRequired(): boolean {
  if (loginPageDetected() || /^\/login/.test(location.pathname)) return true
  if (document.querySelector(UPLOAD_SELECTORS.join(","))) return false
  return !!findAction([/^log in$/i]) && !/^\/pin-creation-tool/.test(location.pathname)
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const { task } = context
  if (loginRequired()) throw new Error("请先登录 Pinterest，登录完成后从发布助手重试")
  const warnings: string[] = [...skippedVideoWarning(task, "Pinterest")]
  const images = imageAssets(task)
  if (!images.length) throw new Error("Pinterest 需要一张图片，请添加图片后重试")
  if (images.length > 1) {
    for (const asset of images.slice(1)) context.uploadProgress?.skip?.(asset)
    warnings.push(`Pinterest 每个 Pin 只能使用一张图片，已使用第一张，跳过其余 ${images.length - 1} 张`)
  }
  if (normalizedTags(task).length) warnings.push("Pinterest 不再使用话题标签，已跳过标签")
  const description = postBody(task)
  if (description.length > DESCRIPTION_LIMIT) throw overLimitError("Pinterest", DESCRIPTION_LIMIT, description.length)

  const upload = await waitFor(() => document.querySelector(UPLOAD_SELECTORS.join(",")), 12_000)
  if (!upload) throw new PlatformPageChangedError(config.label, "图片上传控件")
  warnings.push(...await attachImages({
    context,
    assets: images.slice(0, 1),
    platform: "Pinterest",
    root: document,
    inputSelectors: UPLOAD_SELECTORS,
    required: true
  }))

  const title = postTitle(task)
  if (title) {
    const field = await waitFor(() => enabled<HTMLInputElement>(TITLE_SELECTORS), 15_000)
    if (!field) warnings.push("未找到 Pinterest 标题输入框，请手动填写标题")
    else {
      const limited = truncateTitle(title, config.titleLimit)
      if (limited.truncated) warnings.push(`标题超过 Pinterest 上限，已按 ${config.titleLimit} 个字符填充`)
      fillTextControl(field, limited.title)
    }
  }
  if (description) {
    const field = await waitFor(() => enabled<HTMLElement>(DESCRIPTION_SELECTORS), 10_000)
    if (!field) warnings.push("未找到 Pinterest 描述输入框，请手动填写描述")
    else if (!(await insertText(field, description))) throw new Error("Pinterest 描述填充失败，请刷新编辑页后重试")
  }
  warnings.push("请在 Pinterest 编辑页手动选择要保存到的画板（Board）")
  return { draftUrl: location.href, warnings }
}

export const pinterestPostAdapter: PlatformAdapter = {
  id: "pinterest-post",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginRequired() ? { loggedIn: false, message: "请先登录 Pinterest，登录完成后重试" } : { loggedIn: true }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {}
}
