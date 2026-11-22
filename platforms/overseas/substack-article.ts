import { platformPlainText, truncateTitle } from "~lib/content"
import { PLATFORM_CONFIG } from "~platforms/config"
import { fillTextControl } from "~platforms/dom"
import {
  articleHtmlWithoutAssets,
  insertText,
  normalizedTags,
  queryVisible,
  waitFor
} from "~platforms/overseas/common"
import { substackLoginRequired } from "~platforms/overseas/substack-post"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"

/*
 * Substack posts are written on the publication's own host
 * (https://<name>.substack.com/publish/post?type=newsletter). Catalog hosts are
 * exact, so the extension only runs on substack.com today: there the adapter
 * finds the user's publication and explains how to continue. The editor code
 * below already works on any /publish/post page once wildcard hosts exist.
 * UNVERIFIED selectors: see the hand-over note.
 */
const config = PLATFORM_CONFIG["substack-article"]

const TITLE_SELECTORS = [
  "textarea#post-title",
  "textarea[placeholder='Title']",
  "input[placeholder='Title']",
  "[data-testid='post-title'] textarea"
]
const SUBTITLE_SELECTORS = [
  "textarea#post-subtitle",
  "textarea[placeholder*='subtitle']",
  "textarea[placeholder*='Subtitle']"
]
const BODY_SELECTORS = [
  ".ProseMirror[contenteditable='true']",
  "[data-testid='editor'] [contenteditable='true']"
]

function onEditorPage(): boolean {
  return /^\/publish\/post(?:\/|$)/.test(location.pathname)
}

/** The publication's new-post editor, discovered from links on substack.com. */
export function publicationEditorUrl(root: ParentNode = document): string | null {
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    let url: URL
    try { url = new URL(anchor.href, location.href) } catch { continue }
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.substack\.com$/i.test(url.hostname) || url.hostname === "www.substack.com") continue
    if (!/^\/publish(?:\/|$)/.test(url.pathname)) continue
    return `https://${url.hostname}/publish/post?type=newsletter`
  }
  return null
}

function loginRequired(): boolean {
  if (onEditorPage() && queryVisible(BODY_SELECTORS)) return false
  return substackLoginRequired()
}

async function fillEditor(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const { task } = context
  const warnings: string[] = []
  const title = await waitFor(() => queryVisible<HTMLTextAreaElement>(TITLE_SELECTORS), 15_000)
  if (!title) throw new PlatformPageChangedError(config.label, "标题输入框")
  const limited = truncateTitle(task.article.title, config.titleLimit)
  if (limited.truncated) warnings.push(`标题超过 Substack 上限，已按 ${config.titleLimit} 个字符填充`)
  fillTextControl(title, limited.title)

  const digest = task.article.digest.trim()
  if (digest) {
    const subtitle = queryVisible<HTMLTextAreaElement>(SUBTITLE_SELECTORS)
    if (subtitle) fillTextControl(subtitle, digest)
    else warnings.push("未找到 Substack 副标题输入框，摘要未填写")
  }

  const { html, removed } = articleHtmlWithoutAssets(task)
  const plain = platformPlainText(html)
  if (plain) {
    const body = await waitFor(() => queryVisible<HTMLElement>(BODY_SELECTORS), 10_000)
    if (!body) throw new PlatformPageChangedError(config.label, "正文编辑器")
    if (!(await insertText(body, plain, { html, expected: plain.split("\n")[0] }))) {
      throw new Error("Substack 正文填充失败，请刷新编辑页后重试")
    }
  }
  if (removed) {
    for (const asset of task.assets) context.uploadProgress?.skip?.(asset)
    warnings.push(`Substack 正文中的 ${removed} 张图片未自动上传，请在对应位置手动插入`)
  }
  if (normalizedTags(task).length) warnings.push("Substack 的标签在发布设置中选择，请手动添加")
  return { draftUrl: location.href, warnings }
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  if (loginRequired()) throw new Error("请先登录 Substack，登录完成后从发布助手重试")
  if (onEditorPage()) return fillEditor(context)
  const editorUrl = publicationEditorUrl()
  if (!editorUrl) {
    throw new Error("未找到你的 Substack 出版物。请先在 Substack 创建出版物（Publication），再从发布助手重试")
  }
  throw new Error(
    `Substack 文章编辑器位于你的出版物域名 ${new URL(editorUrl).hostname}，发布助手暂时无法在该域名自动填写。` +
    `请打开 ${editorUrl} 手动粘贴正文`
  )
}

export const substackArticleAdapter: PlatformAdapter = {
  id: "substack-article",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginRequired() ? { loggedIn: false, message: "请先登录 Substack，登录完成后重试" } : { loggedIn: true }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {}
}
