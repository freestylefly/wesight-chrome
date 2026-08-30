import { replaceAssetTokens, sanitizePlatformHtml, truncateTitle } from "~lib/content"
import { PLATFORM_CONFIG } from "~platforms/config"
import { loginPageDetected } from "~platforms/dom"
import type { PlatformAdapter, PrepareDraftContext, PrepareDraftResult } from "~platforms/types"

const config = PLATFORM_CONFIG["bilibili-article"]

function cookieValue(name: string): string {
  const item = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))
  return item?.slice(name.length + 1) ?? ""
}

async function uploadImage(dataUrl: string, csrf: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  const body = new FormData()
  body.append("file_up", blob)
  body.append("biz", "new_dyn")
  body.append("category", "daily")
  body.append("csrf", csrf)
  const response = await fetch("https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs", {
    method: "POST",
    body,
    credentials: "include"
  })
  if (!response.ok) throw new Error(`B站图片上传失败（HTTP ${response.status}）`)
  const result = await response.json() as { code?: number; message?: string; data?: { image_url?: string } }
  if (result.code !== 0 || !result.data?.image_url) throw new Error(`B站图片上传失败：${result.message ?? "返回数据无效"}`)
  return result.data.image_url
}

async function createDraft(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const csrf = cookieValue("bili_jct")
  if (!csrf) throw new Error("B站登录状态无效，请重新登录后重试")
  const urls = new Map<string, string>()
  for (const asset of context.task.assets) {
    try {
      const dataUrl = await context.getAssetData(asset)
      urls.set(asset.id, await uploadImage(dataUrl, csrf))
      context.uploadProgress?.complete(asset)
    } catch (error) {
      context.uploadProgress?.fail(asset)
      throw error
    }
  }
  const limited = truncateTitle(context.task.article.title, config.titleLimit)
  const html = sanitizePlatformHtml(replaceAssetTokens(context.task.article.html, urls))
  const documentBody = new DOMParser().parseFromString(html, "text/html")
  const coverUrl = context.task.article.coverAssetId
    ? urls.get(context.task.article.coverAssetId) ?? ""
    : ""
  const body = new FormData()
  body.append("title", limited.title)
  body.append("content", html)
  body.append("summary", context.task.article.digest)
  body.append("banner_url", coverUrl)
  body.append("words", String(documentBody.body.textContent?.length ?? 0))
  body.append("category", "0")
  body.append("list_id", "0")
  body.append("tid", "0")
  body.append("reprint", context.task.article.original === false ? "1" : "0")
  body.append("tags", context.task.article.tags.join(","))
  body.append("image_urls", "")
  body.append("origin_image_urls", "")
  body.append("dynamic_intro", context.task.article.digest)
  body.append("media_id", "0")
  body.append("spoiler", "0")
  body.append("original", context.task.article.original === false ? "0" : "1")
  body.append("top_video_bvid", "")
  body.append("csrf", csrf)
  const response = await fetch("https://api.bilibili.com/x/article/creative/draft/addupdate", {
    method: "POST",
    body,
    credentials: "include"
  })
  if (!response.ok) throw new Error(`B站草稿创建失败（HTTP ${response.status}）`)
  const result = await response.json() as { code?: number; message?: string; data?: { aid?: string | number } }
  if (result.code !== 0 || result.data?.aid === undefined) {
    throw new Error(`B站草稿创建失败：${result.message ?? "返回数据无效"}`)
  }
  const draftUrl = `https://member.bilibili.com/york/read-editor?aid=${encodeURIComponent(String(result.data.aid))}`
  const warnings = ["分区、分类、封面和原创声明请在 B站专栏页确认"]
  if (limited.truncated) warnings.unshift(`标题超过B站上限，已按 ${config.titleLimit} 个字符填充`)
  return { draftUrl, warnings }
}

export const bilibiliAdapter: PlatformAdapter = {
  id: "bilibili-article",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    return loginPageDetected() || !cookieValue("bili_jct")
      ? { loggedIn: false, message: "请先登录 B站" }
      : { loggedIn: true }
  },
  prepareDraft: createDraft,
  retry: createDraft,
  dispose() {}
}
