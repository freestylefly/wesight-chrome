import type { ARTICLE_TECH_PLATFORMS } from "~platforms/catalog/article-tech"
import { PLATFORM_CONFIG } from "~platforms/config"
import { fillTextControl, loginPageDetected, prepareArticle, referencedAssets, waitForAny } from "~platforms/dom"
import { PlatformPageChangedError, type AccountDetection, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

import {
  fillMarkdownEditor,
  fillRichEditor,
  fillTitleControl,
  findActionByText,
  findEditor,
  waitForEditor,
  type EditorCandidate
} from "~platforms/article-tech/editor"

export type ArticleTechPlatformId = (typeof ARTICLE_TECH_PLATFORMS)[number]["id"]

export interface TechArticleSite {
  id: ArticleTechPlatformId
  /** Site name used in user-facing messages, e.g. "博客园". */
  siteName: string
  titleSelectors: readonly string[]
  /** Body editors in priority order; sites that let users pick Markdown or rich text list both. */
  editors: readonly EditorCandidate[]
  /** A plain text input that takes comma-separated tags on the editor page itself. */
  tagInputSelectors?: readonly string[]
  /** Login pages that do not match the generic login/passport URL heuristic. */
  loginUrlPattern?: RegExp
  /** Hostnames that only serve login pages. */
  loginHosts?: readonly string[]
  /** When set, a page whose path does not match is treated as a logged-out redirect. */
  editorPathPattern?: RegExp
  /** Text of a same-page control that opens a fresh draft (never a publish button). */
  newDraftTexts?: readonly string[]
  /** For sites whose editor URL needs the user id: the editor URL derived from the current page. */
  editorRoute?: () => string | null
  /** Shown after filling, e.g. which publish settings still need the user. */
  settingsHint: string
}

const TITLE_WAIT_MS = 20_000
const QUICK_WAIT_MS = 1_500

function loggedOut(site: TechArticleSite): boolean {
  if (loginPageDetected()) return true
  if (site.loginUrlPattern?.test(location.href)) return true
  if (site.loginHosts?.includes(location.hostname)) return true
  return Boolean(site.editorPathPattern && !site.editorPathPattern.test(location.pathname))
}

function assetPlaceholder(asset: PublishAssetV1): string {
  return `【待插入图片：${asset.fileName}】`
}

/**
 * The batch does not use undocumented upload APIs, so referenced images become
 * visible placeholders that the user replaces through the site's own editor.
 */
function replaceImages(markdown: string, html: string, assets: readonly PublishAssetV1[]): { markdown: string; html: string } {
  let nextMarkdown = markdown
  for (const asset of assets) {
    const token = `wesight-asset://${asset.id}`
    const escaped = token.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
    nextMarkdown = nextMarkdown
      .replace(new RegExp(`!\\[[^\\]]*\\]\\(<?${escaped}>?(?:\\s+"[^"]*")?\\)`, "g"), assetPlaceholder(asset))
      .split(token).join(assetPlaceholder(asset))
  }
  const parsed = new DOMParser().parseFromString(html, "text/html")
  for (const image of Array.from(parsed.body.querySelectorAll("img"))) {
    const source = image.getAttribute("src") ?? ""
    if (!source.startsWith("wesight-asset://")) continue
    const asset = assets.find(candidate => source === `wesight-asset://${candidate.id}`)
    image.replaceWith(parsed.createTextNode(asset ? assetPlaceholder(asset) : "【待插入图片】"))
  }
  return { markdown: nextMarkdown, html: parsed.body.innerHTML }
}

async function openEditorPage(site: TechArticleSite, label: string): Promise<void> {
  if (findEditor(site.editors)) return
  if (site.editorRoute) {
    const target = site.editorRoute()
    if (!target) throw new Error(`未找到${site.siteName}写文章入口，请先登录并手动打开写文章页面，然后点重试`)
    if (target !== location.href) {
      window.setTimeout(() => location.assign(target), 0)
      throw new Error(`已为你打开${site.siteName}写文章页面，请等页面加载完成后点重试`)
    }
    return
  }
  if (!site.newDraftTexts?.length) return
  if (await waitForAny(site.titleSelectors as string[], QUICK_WAIT_MS)) return
  const control = findActionByText(site.newDraftTexts)
  if (!control) throw new PlatformPageChangedError(label, "“写文章”入口")
  if (control instanceof HTMLAnchorElement && control.target === "_blank" && control.href) {
    window.setTimeout(() => location.assign(control.href), 0)
    throw new Error(`已为你打开${site.siteName}写文章页面，请等页面加载完成后点重试`)
  }
  control.click()
}

export function createTechArticleAdapter(site: TechArticleSite): PlatformAdapter {
  const config = PLATFORM_CONFIG[site.id]

  async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
    await openEditorPage(site, config.label)
    const title = await waitForAny<HTMLElement>(site.titleSelectors as string[], TITLE_WAIT_MS)
    if (!title) throw new PlatformPageChangedError(config.label, "标题输入框")
    const editor = await waitForEditor(site.editors)
    if (!editor) throw new PlatformPageChangedError(config.label, "正文编辑器")

    const article = prepareArticle(context, new Map(), config.titleLimit, config.shortLabel)
    const warnings = [...article.warnings]
    const images = referencedAssets(context)
    const body = replaceImages(article.markdown, article.html, images)
    for (const asset of images) {
      context.uploadProgress?.skip?.(asset)
      warnings.push(`图片“${asset.fileName}”未自动上传，正文中已留下“${assetPlaceholder(asset)}”，请用${site.siteName}编辑器插入图片后再发布`)
    }

    fillTitleControl(title, article.title)
    const filled = editor.mode === "markdown"
      ? fillMarkdownEditor(editor, body.markdown)
      : fillRichEditor(editor, body.html, body.markdown)
    if (!filled) warnings.push(`${site.siteName}正文可能没有完整填入，请检查编辑器内容，必要时手动粘贴`)

    const { tags, coverAssetId } = context.task.article
    if (tags.length) {
      const tagInput = site.tagInputSelectors?.length
        ? await waitForAny<HTMLInputElement>(site.tagInputSelectors as string[], QUICK_WAIT_MS)
        : null
      if (tagInput) {
        fillTextControl(tagInput, tags.join(","))
        warnings.push(`标签已填入：${tags.join("、")}，请确认${site.siteName}已识别`)
      } else {
        warnings.push(`标签未自动填写，请在${site.siteName}发布设置中添加：${tags.join("、")}`)
      }
    }
    if (coverAssetId) {
      const cover = context.task.assets.find(asset => asset.id === coverAssetId)
      warnings.push(`封面未自动设置，请在${site.siteName}发布设置中手动上传${cover ? `“${cover.fileName}”` : "封面"}`)
    }
    warnings.push(site.settingsHint)
    return { draftUrl: location.href, warnings }
  }

  return {
    id: site.id,
    title: config.label,
    editorUrl: config.editorUrl,
    titleLimit: config.titleLimit,
    async detectAccount(): Promise<AccountDetection> {
      return loggedOut(site) ? { loggedIn: false, message: `请先登录${site.siteName}` } : { loggedIn: true }
    },
    prepareDraft: prepare,
    retry: prepare,
    dispose() {}
  }
}
