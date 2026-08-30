import { PLATFORM_CONFIG } from "~platforms/config"
import { fillEditable, fillTextControl, loginPageDetected, prepareArticle, referencedAssets, resolveAssetDataUrls, waitForAny } from "~platforms/dom"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"

const config = PLATFORM_CONFIG.juejin

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const title = await waitForAny<HTMLInputElement | HTMLTextAreaElement>([
    "input.title-input", "textarea.title-input", "input[placeholder*='文章标题']", "textarea[placeholder*='标题']"
  ])
  const editor = await waitForAny<HTMLElement>([
    "div.CodeMirror-code[role='presentation']", ".ProseMirror[contenteditable='true']", ".bytemd-editor textarea", ".CodeMirror textarea", "textarea[placeholder*='正文']"
  ])
  if (!title) throw new PlatformPageChangedError(config.label, "标题输入框")
  if (!editor) throw new PlatformPageChangedError(config.label, "Markdown 编辑器")
  fillTextControl(title, context.task.article.title)
  const assetUrls = context.pageBridge ? new Map<string, string>() : await resolveAssetDataUrls(context)
  if (context.pageBridge) {
    for (const asset of referencedAssets(context)) {
      assetUrls.set(asset.id, await context.pageBridge.uploadAsset("juejin", asset))
    }
  }
  const article = prepareArticle(context, assetUrls, config.titleLimit, config.shortLabel)
  if (context.pageBridge) {
    await context.pageBridge.fillEditor({
      platformId: "juejin",
      title: article.title,
      html: article.html,
      markdown: article.markdown
    })
  } else {
    fillTextControl(title, article.title)
    fillEditable(editor, article.html, article.markdown)
  }
  return {
    draftUrl: location.href,
    warnings: [...article.warnings, "分类与标签请在掘金发布设置中确认"]
  }
}

export const juejinAdapter: PlatformAdapter = {
  id: "juejin",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginPageDetected() ? { loggedIn: false, message: "请先登录掘金" } : { loggedIn: true }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {}
}
