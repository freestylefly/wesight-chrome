import { truncateTitle } from "~lib/content"
import { PLATFORM_CONFIG } from "~platforms/config"
import { fillTextControl, loginPageDetected } from "~platforms/dom"
import {
  attachImages,
  compactText,
  deepQuery,
  deepQueryAll,
  delay,
  imageAssets,
  insertText,
  isPublishLabel,
  normalizedTags,
  overLimitError,
  postBody,
  postTitle,
  skippedVideoWarning,
  visible,
  waitFor
} from "~platforms/overseas/common"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"

/*
 * Reddit submit page (www.reddit.com/submit, shreddit web components with open
 * shadow roots). The community is never chosen automatically. UNVERIFIED.
 */
const config = PLATFORM_CONFIG["reddit-post"]
const TEXT_LIMIT = 40_000
const IMAGE_LIMIT = 20

const TITLE_SELECTORS = [
  "textarea[name='title']",
  "input[name='title']",
  "textarea[placeholder^='Title']"
]
const TITLE_HOSTS = ["faceplate-textarea-input[name='title']"]
const BODY_SELECTORS = [
  "shreddit-composer [contenteditable='true']",
  "[contenteditable='true'][name='body']",
  "[contenteditable='true'][role='textbox']"
]
const IMAGE_INPUT_SELECTORS = ["input[type='file'][accept*='image']"]

function findTitle(): HTMLTextAreaElement | HTMLInputElement | null {
  const direct = deepQuery<HTMLTextAreaElement | HTMLInputElement>(TITLE_SELECTORS)
  if (direct) return direct
  for (const selector of TITLE_HOSTS) {
    const host = deepQueryAll<HTMLElement>(selector)[0]
    const inner = host?.shadowRoot?.querySelector<HTMLTextAreaElement>("textarea")
    if (inner) return inner
  }
  return null
}

/** Finds a post-type tab such as "Images & Video", also inside shadow roots. */
function findTab(pattern: RegExp): HTMLElement | null {
  return deepQueryAll<HTMLElement>("[role='tab'], button, [data-select-value]")
    .find(element => {
      const label = element.getAttribute("aria-label") ?? compactText(element)
      return visible(element) && !isPublishLabel(label) && pattern.test(label)
    }) ?? null
}

function loginRequired(): boolean {
  if (loginPageDetected() || /^\/(?:login|register)/.test(location.pathname)) return true
  if (findTitle()) return false
  return deepQueryAll<HTMLElement>("a, button").some(element => visible(element) && /^log in$/i.test(compactText(element)))
}

function communityChosen(): boolean {
  return /^\/(?:r|user)\/[^/]+\/submit/.test(location.pathname)
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const { task } = context
  if (loginRequired()) throw new Error("请先登录 Reddit，登录完成后从发布助手重试")
  const warnings: string[] = [...skippedVideoWarning(task, "Reddit")]
  if (!communityChosen()) warnings.push("请在 Reddit 编辑页手动选择要发布到的社区（Community），发布助手不会替你选择")
  if (normalizedTags(task).length) warnings.push("Reddit 不使用话题标签，已跳过标签；如社区要求 Flair，请手动选择")

  const body = postBody(task)
  if (body.length > TEXT_LIMIT) throw overLimitError("Reddit", TEXT_LIMIT, body.length)
  let title = postTitle(task)
  if (!title) {
    title = body.split("\n").find(line => line.trim())?.trim() ?? ""
    if (title) warnings.push("未填写标题，已使用正文首行作为 Reddit 标题，请检查")
  }
  if (!title) throw new Error("Reddit 帖子需要标题，请填写标题后重试")
  const limited = truncateTitle(title, config.titleLimit)
  if (limited.truncated) warnings.push(`标题超过 Reddit 上限，已按 ${config.titleLimit} 个字符填充`)

  let images = imageAssets(task)
  if (images.length > IMAGE_LIMIT) {
    warnings.push(`Reddit 最多 ${IMAGE_LIMIT} 张图片，已跳过后 ${images.length - IMAGE_LIMIT} 张`)
    images = images.slice(0, IMAGE_LIMIT)
  }
  if (images.length) {
    findTab(/^images?\s*(?:&|and)\s*video$/i)?.click()
    await delay(500)
  }

  const titleField = await waitFor(findTitle, 12_000)
  if (!titleField) throw new PlatformPageChangedError(config.label, "标题输入框")
  fillTextControl(titleField, limited.title)

  if (body) {
    const editor = await waitFor(() => deepQuery<HTMLElement>(BODY_SELECTORS), 5_000)
    if (!editor) warnings.push("未找到 Reddit 正文编辑框，请手动粘贴正文")
    else if (!(await insertText(editor, body))) throw new Error("Reddit 正文填充失败，请刷新编辑页后重试")
  }

  if (images.length) {
    warnings.push(...await attachImages({
      context,
      assets: images,
      platform: "Reddit",
      root: document,
      inputSelectors: IMAGE_INPUT_SELECTORS
    }))
  }
  return { draftUrl: location.href, warnings }
}

export const redditPostAdapter: PlatformAdapter = {
  id: "reddit-post",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginRequired() ? { loggedIn: false, message: "请先登录 Reddit，登录完成后重试" } : { loggedIn: true }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {}
}
