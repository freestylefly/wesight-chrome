import { PLATFORM_CONFIG } from "~platforms/config"
import { fillEditable, fillTextControl, loginPageDetected, prepareArticle, referencedAssets, waitForAny } from "~platforms/dom"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"

const config = PLATFORM_CONFIG.csdn

const EDITOR_SELECTORS = [
  "textarea.editor__inner",
  ".bytemd-editor textarea",
  ".ProseMirror[contenteditable='true']",
  "div[contenteditable='true'][role='textbox']"
]

function iframeEditor(): HTMLElement | null {
  const frames = document.querySelectorAll<HTMLIFrameElement>(
    "iframe.cke_wysiwyg_frame, iframe[class*='wysiwyg']"
  )
  for (const frame of frames) {
    try {
      const frameDocument = frame.contentDocument ?? frame.contentWindow?.document
      const editor = frameDocument?.querySelector<HTMLElement>(
        "body[contenteditable='true'], .cke_editable[contenteditable='true'], [contenteditable='true'][role='textbox']"
      )
      if (editor) return editor
    } catch {
      // Cross-origin frames are ignored; CSDN's CKEditor frame is same-origin.
    }
  }
  return null
}

async function waitForEditor(timeoutMs = 20_000): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const selector of EDITOR_SELECTORS) {
      const editor = document.querySelector<HTMLElement>(selector)
      if (editor) return editor
    }
    const framed = iframeEditor()
    if (framed) return framed
    await new Promise(resolve => window.setTimeout(resolve, 250))
  }
  return null
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const title = await waitForAny<HTMLInputElement | HTMLTextAreaElement>([
    "input.article-bar__title", "input[placeholder*='文章标题']", "textarea[placeholder*='标题']", "#txtTitle"
  ])
  if (!title) throw new PlatformPageChangedError(config.label, "标题输入框")
  fillTextControl(title, context.task.article.title)
  const editor = context.pageBridge ? null : await waitForEditor()
  if (!context.pageBridge && !editor) throw new PlatformPageChangedError(config.label, "正文编辑器")
  const assets = referencedAssets(context)
  const urls = new Map<string, string>()
  if (assets.length && !context.pageBridge) throw new Error("CSDN 图片上传需要页面原生上传桥")
  let nextAssetIndex = 0
  const uploadWorker = async () => {
    while (nextAssetIndex < assets.length) {
      const asset = assets[nextAssetIndex++]!
      const url = await context.pageBridge!.uploadAsset("csdn", asset)
      urls.set(asset.id, url)
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(3, assets.length) },
    () => uploadWorker()
  ))
  const article = prepareArticle(context, urls, config.titleLimit, config.shortLabel)
  if (context.pageBridge) {
    await context.pageBridge.fillEditor({
      platformId: "csdn",
      title: article.title,
      html: article.html,
      markdown: article.markdown
    })
  } else {
    fillTextControl(title, article.title)
    fillEditable(editor!, article.html, article.markdown)
  }
  return {
    draftUrl: location.href,
    warnings: [...article.warnings, "分类与原创声明请在 CSDN 发布设置中确认"]
  }
}

export const csdnAdapter: PlatformAdapter = {
  id: "csdn",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginPageDetected() ? { loggedIn: false, message: "请先登录 CSDN" } : { loggedIn: true }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {}
}
