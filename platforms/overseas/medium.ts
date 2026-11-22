import { platformPlainText, truncateTitle } from "~lib/content"
import { PLATFORM_CONFIG } from "~platforms/config"
import { loginPageDetected } from "~platforms/dom"
import {
  articleHtmlWithoutAssets,
  delay,
  findAction,
  insertText,
  normalizedTags,
  queryVisible,
  waitFor
} from "~platforms/overseas/common"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"

/*
 * Medium story editor (medium.com/new-story): one contenteditable whose first
 * block is the title. Text goes in through Medium's own paste handling. UNVERIFIED.
 */
const config = PLATFORM_CONFIG["medium-article"]

const TITLE_SELECTORS = [
  "[data-testid='editorTitleParagraph']",
  "[contenteditable='true'] h3.graf--title",
  "[contenteditable='true'] h3"
]
const BODY_SELECTORS = [
  "[data-testid='editorParagraphText']",
  "[contenteditable='true'] p.graf--p",
  "[contenteditable='true'] p"
]

function loginRequired(): boolean {
  if (loginPageDetected() || /^\/m\/(?:signin|callback)/.test(location.pathname)) return true
  if (queryVisible(TITLE_SELECTORS)) return false
  return !!findAction([/^sign in$/i, /^get started$/i])
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const { task } = context
  if (loginRequired()) throw new Error("请先登录 Medium，登录完成后从发布助手重试")
  const warnings: string[] = []
  const titleBlock = await waitFor(() => queryVisible<HTMLElement>(TITLE_SELECTORS), 15_000)
  if (!titleBlock) {
    if (loginRequired()) throw new Error("请先登录 Medium，登录完成后从发布助手重试")
    throw new PlatformPageChangedError(config.label, "标题输入区")
  }
  const limited = truncateTitle(task.article.title, config.titleLimit)
  if (limited.truncated) warnings.push(`标题超过 Medium 上限，已按 ${config.titleLimit} 个字符填充`)
  if (limited.title && !(await insertText(titleBlock, limited.title))) throw new Error("Medium 标题填充失败，请刷新编辑页后重试")
  await delay(200)

  const { html, removed } = articleHtmlWithoutAssets(task)
  const plain = platformPlainText(html)
  if (plain) {
    const bodyBlock = await waitFor(() => queryVisible<HTMLElement>(BODY_SELECTORS), 5_000)
    if (!bodyBlock) throw new PlatformPageChangedError(config.label, "正文编辑区")
    if (!(await insertText(bodyBlock, plain, { html, expected: plain.split("\n")[0] }))) {
      throw new Error("Medium 正文填充失败，请刷新编辑页后重试")
    }
  }
  if (removed) {
    for (const asset of task.assets) context.uploadProgress?.skip?.(asset)
    warnings.push(`Medium 正文中的 ${removed} 张图片未自动上传，请在对应位置手动插入`)
  }
  if (normalizedTags(task).length) warnings.push("Medium 的话题标签在发布窗口中设置，请手动添加（最多 5 个）")
  return { draftUrl: location.href, warnings }
}

export const mediumArticleAdapter: PlatformAdapter = {
  id: "medium-article",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginRequired() ? { loggedIn: false, message: "请先登录 Medium，登录完成后重试" } : { loggedIn: true }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {}
}
