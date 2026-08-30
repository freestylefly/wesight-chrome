import { PLATFORM_CONFIG } from "~platforms/config"
import { fillEditable, fillTextControl, loginPageDetected, prepareArticle, referencedAssets, selectAssetFile, waitForAny } from "~platforms/dom"
import { PlatformPageChangedError, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

const config = PLATFORM_CONFIG.zhihu
const ZHIHU_IMAGE_UPLOAD_ENDPOINT = "https://zhuanlan.zhihu.com/api/uploaded_images"

function dataUrlToFile(dataUrl: string, asset: PublishAssetV1): File {
  const [header, payload = ""] = dataUrl.split(",", 2)
  const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new File([bytes], asset.fileName, { type: asset.mimeType })
}

function uploadedImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const response = payload as Record<string, unknown>
  for (const field of ["src", "original_src", "url"] as const) {
    const candidate = response[field]
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate
  }
  return null
}

async function uploadBodyAsset(context: PrepareDraftContext, asset: PublishAssetV1): Promise<string> {
  if (context.pageBridge) return context.pageBridge.uploadAsset("zhihu", asset)
  const formData = new FormData()
  formData.append("picture", dataUrlToFile(await context.getAssetData(asset), asset))

  let response: Response
  try {
    response = await fetch(ZHIHU_IMAGE_UPLOAD_ENDPOINT, {
      method: "POST",
      body: formData,
      credentials: "include",
      headers: { Accept: "application/json" }
    })
  } catch {
    throw new Error(`知乎图片“${asset.fileName}”上传失败，请确认网络和登录状态后重试`)
  }
  if (!response.ok) {
    throw new Error(`知乎图片“${asset.fileName}”上传失败（HTTP ${response.status}），请重新登录后重试`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`知乎图片“${asset.fileName}”上传失败，平台返回了无法识别的数据`)
  }
  const url = uploadedImageUrl(payload)
  if (!url) throw new Error(`知乎图片“${asset.fileName}”上传失败，平台未返回图片地址`)
  return url
}

async function uploadBodyAssets(context: PrepareDraftContext): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  for (const asset of referencedAssets(context)) urls.set(asset.id, await uploadBodyAsset(context, asset))
  return urls
}

async function resolvedDraftUrl(timeoutMs = 10_000): Promise<string> {
  if (location.hostname !== "zhuanlan.zhihu.com" || location.pathname !== "/write") return location.href
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (/\/p\/\d+\/edit(?:[/?#]|$)/.test(location.href)) return location.href
    await new Promise(resolve => window.setTimeout(resolve, 250))
  }
  return location.href
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const title = await waitForAny<HTMLInputElement | HTMLTextAreaElement>([
    "textarea[placeholder*='标题']", ".WriteIndex-titleInput textarea", "input[placeholder*='标题']"
  ])
  const editor = await waitForAny<HTMLElement>([
    "div[data-contents='true']", ".public-DraftEditor-content[contenteditable='true']", ".ProseMirror[contenteditable='true']", "div[contenteditable='true'][role='textbox']"
  ])
  if (!title) throw new PlatformPageChangedError(config.label, "标题输入框")
  if (!editor) throw new PlatformPageChangedError(config.label, "正文编辑器")
  const assetUrls = await uploadBodyAssets(context)
  const article = prepareArticle(context, assetUrls, config.titleLimit, config.shortLabel)
  fillTextControl(title, article.title)
  fillEditable(editor, article.html, article.markdown, { htmlOnlyClipboard: true })
  const warnings = [...article.warnings]
  if (context.task.article.coverAssetId) {
    const cover = context.task.assets.find(asset => asset.id === context.task.article.coverAssetId)
    try {
      const selected = await selectAssetFile(context, context.task.article.coverAssetId, [
        "input[type='file'].UploadPicture-input", "input[type='file'][accept*='image']"
      ])
      if (selected && cover) context.uploadProgress?.complete(cover)
      if (!selected) {
        if (cover) context.uploadProgress?.fail(cover)
        warnings.push("未找到知乎封面控件，请在发布前手动补充封面")
      }
    } catch (error) {
      if (cover) context.uploadProgress?.fail(cover)
      throw error
    }
  }
  return { draftUrl: await resolvedDraftUrl(), warnings }
}

export const zhihuAdapter: PlatformAdapter = {
  id: "zhihu",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginPageDetected() ? { loggedIn: false, message: "请先登录知乎" } : { loggedIn: true }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {}
}
