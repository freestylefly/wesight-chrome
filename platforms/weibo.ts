/*
 * Adapted from MultiPost-Extension src/sync/article/weibo.ts (Apache-2.0).
 * WeSight changes: bounded concurrency, 16:9 cover crop, no publish path,
 * v5-create-only fallback rules, stable draft URL reporting, and redacted errors.
 */
import { replaceAssetTokens, sanitizePlatformHtml, truncateTitle } from "~lib/content"
import { spaceWeiboParagraphs } from "~lib/weibo-content"
import { PLATFORM_CONFIG } from "~platforms/config"
import { loginPageDetected, referencedAssets } from "~platforms/dom"
import type { PlatformAdapter, PrepareDraftContext, PrepareDraftResult } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

const config = PLATFORM_CONFIG["weibo-article"]
const SUCCESS_CODE = 100000

interface Endpoint {
  version: "v5" | "v3"
  editorUrl: string
  createUrl: string
  saveUrl: string
}

const ENDPOINTS: readonly Endpoint[] = [
  {
    version: "v5",
    editorUrl: "https://card.weibo.com/article/v5/editor",
    createUrl: "https://card.weibo.com/article/v5/aj/editor/draft/create",
    saveUrl: "https://card.weibo.com/article/v5/aj/editor/draft/save"
  },
  {
    version: "v3",
    editorUrl: "https://card.weibo.com/article/v3/editor",
    createUrl: "https://card.weibo.com/article/v3/aj/editor/draft/create",
    saveUrl: "https://card.weibo.com/article/v3/aj/editor/draft/save"
  }
]

function parseUid(value: string): string | null {
  return /\$CONFIG\[['"]uid['"]\]\s*=\s*['"]?(\d+)/.exec(value)?.[1]
    ?? /["']uid["']\s*:\s*["']?(\d{5,})/.exec(value)?.[1]
    ?? null
}

export async function resolveWeiboUid(): Promise<string | null> {
  const inline = parseUid(document.documentElement.innerHTML)
  if (inline) return inline
  try {
    const response = await fetch(ENDPOINTS[0]!.editorUrl, { credentials: "include" })
    return response.ok ? parseUid(await response.text()) : null
  } catch {
    return null
  }
}

function dataUrlBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then(response => response.blob())
}

export async function cropWeiboCover(dataUrl: string, mimeType: string): Promise<Blob> {
  const source = await dataUrlBlob(dataUrl)
  const bitmap = await createImageBitmap(source)
  const targetRatio = 16 / 9
  let sourceX = 0
  let sourceY = 0
  let sourceWidth = bitmap.width
  let sourceHeight = bitmap.height
  if (sourceWidth / sourceHeight > targetRatio) {
    sourceWidth = Math.round(sourceHeight * targetRatio)
    sourceX = Math.round((bitmap.width - sourceWidth) / 2)
  } else {
    sourceHeight = Math.round(sourceWidth / targetRatio)
    sourceY = Math.round((bitmap.height - sourceHeight) / 2)
  }
  const canvas = document.createElement("canvas")
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  const context = canvas.getContext("2d")
  if (!context) throw new Error("微博封面裁剪失败：浏览器未提供画布能力")
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)
  bitmap.close()
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("微博封面裁剪失败")),
    mimeType || "image/jpeg",
    0.92
  ))
}

interface UploadedImage {
  pid: string
  url: string
  width: number
  height: number
}

async function uploadWeiboBlob(blob: Blob, fileName: string): Promise<UploadedImage> {
  const url = new URL("https://picupload.weibo.com/interface/pic_upload.php")
  for (const [key, value] of Object.entries({
    app: "miniblog", s: "json", p: "1", data: "1", url: "weibo.com/ww",
    markpos: "1", logo: "1", nick: "ww", file_source: "4", _rid: String(Date.now())
  })) url.searchParams.set(key, value)
  const response = await fetch(url, { method: "POST", body: blob, credentials: "include" })
  if (!response.ok) throw new Error(`微博图片“${fileName}”上传失败（HTTP ${response.status}）`)
  const payload = await response.json() as { data?: { pics?: { pic_1?: { pid?: string; width?: number; height?: number } } } }
  const image = payload.data?.pics?.pic_1
  if (!image?.pid) throw new Error(`微博图片“${fileName}”上传失败，平台未返回图片编号`)
  return {
    pid: image.pid,
    url: `https://wx2.sinaimg.cn/large/${image.pid}.jpg`,
    width: Number(image.width) || 0,
    height: Number(image.height) || 0
  }
}

async function uploadAsset(context: PrepareDraftContext, asset: PublishAssetV1): Promise<UploadedImage> {
  return uploadWeiboBlob(await dataUrlBlob(await context.getAssetData(asset)), asset.fileName)
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

function imageHtml(uploaded: UploadedImage): string {
  const dimensions = uploaded.width && uploaded.height
    ? ` width="${uploaded.width}" aspect="${uploaded.width / uploaded.height}"`
    : ""
  return `<figure class="image"><img src="${uploaded.url}" alt="图片"${dimensions}></figure>`
}

function replaceWeiboImages(html: string, urls: ReadonlyMap<string, UploadedImage>): string {
  const documentBody = new DOMParser().parseFromString(sanitizePlatformHtml(html), "text/html")
  for (const image of Array.from(documentBody.images)) {
    const match = /^wesight-asset:\/\/([^?#]+)/.exec(image.getAttribute("src") ?? "")
    const uploaded = match?.[1] ? urls.get(match[1]) : undefined
    if (!uploaded) continue
    const template = documentBody.createElement("template")
    template.innerHTML = imageHtml(uploaded)
    image.replaceWith(template.content.firstElementChild!)
  }
  return documentBody.body.innerHTML
}

function nestedValue(payload: unknown, keys: string[]): unknown {
  let current = payload
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function responseMessage(payload: unknown): string {
  for (const path of [["msg"], ["message"], ["data", "msg"], ["data", "message"]]) {
    const value = nestedValue(payload, path)
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120)
  }
  return "平台返回数据无效"
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function buildSaveBody(
  endpoint: Endpoint,
  uid: string,
  draftId: string,
  title: string,
  digest: string,
  html: string,
  coverUrl: string
): FormData {
  const body = new FormData()
  const fields: Record<string, string> = {
    title, type: "", summary: Array.from(digest).slice(0, 44).join(""), writer: "", cover: coverUrl,
    content: html, collection: "[]", updated: new Date().toISOString(), id: draftId, subtitle: "",
    extra: "null", status: "0", publish_at: "", error_msg: "", error_code: "0", free_content: "",
    is_word: "0", article_recommend: "{}", publish_local_at: "", timestamp: "", is_article_free: "0",
    only_render_h5: "0", is_ai_plugins: "0", is_aigc_used: "0", is_v4: "0", follow_to_read: "1",
    "follow_to_read_detail[result]": "1", "follow_to_read_detail[x]": "0", "follow_to_read_detail[y]": "0",
    "follow_to_read_detail[readme_link]": "http://t.cn/A6UnJsqW", "follow_to_read_detail[level]": "",
    "follow_to_read_detail[daily_limit]": "1", "follow_to_read_detail[daily_limit_notes]": "非认证用户单日仅限1篇文章使用",
    "follow_to_read_detail[show_level_tips]": "0", isreward: "0", isreward_tips: "",
    isreward_tips_url: `https://card.weibo.com/article/${endpoint.version}/aj/editor/draft/applyisrewardtips?uid=${uid}`,
    pay_setting: "[]", source: "0", action: "0", is_single_pay_new: "", money: "", is_vclub_single_pay: "",
    vclub_single_pay_money: "", content_type: "0", save: "1", wbeditorRef: "9", ver: "4.0", _rid: String(Date.now())
  }
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  return body
}

function draftUrlFromPayload(endpoint: Endpoint, draftId: string, payload: unknown): string {
  const queue: unknown[] = [payload]
  while (queue.length) {
    const current = queue.shift()
    if (!current || typeof current !== "object") continue
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (typeof value === "string" && /(?:^https?:\/\/card\.weibo\.com)?\/article\/v[35]\/editor/i.test(value)) {
        return new URL(value, endpoint.editorUrl).toString()
      }
      if (value && typeof value === "object") queue.push(value)
    }
  }
  const url = new URL(endpoint.editorUrl)
  url.searchParams.set("id", draftId)
  return url.toString()
}

async function createDraft(endpoint: Endpoint, uid: string): Promise<{ id: string; payload: unknown }> {
  const url = new URL(endpoint.createUrl)
  url.searchParams.set("uid", uid)
  url.searchParams.set("_rid", String(Date.now()))
  const payload = await requestJson(url.toString(), { method: "POST", credentials: "include" })
  const id = nestedValue(payload, ["data", "id"])
  if (typeof id !== "string" && typeof id !== "number") throw new Error(responseMessage(payload))
  return { id: String(id), payload }
}

async function saveDraft(endpoint: Endpoint, uid: string, draftId: string, body: FormData): Promise<unknown> {
  const url = new URL(endpoint.saveUrl)
  url.searchParams.set("uid", uid)
  url.searchParams.set("id", draftId)
  url.searchParams.set("_rid", String(Date.now()))
  const payload = await requestJson(url.toString(), { method: "POST", body, credentials: "include" })
  if (nestedValue(payload, ["code"]) !== SUCCESS_CODE) throw new Error(responseMessage(payload))
  return payload
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const uid = await resolveWeiboUid()
  if (!uid) throw new Error("微博登录状态无效，请重新登录后重试")
  const bodyAssets = referencedAssets(context)
  const uploaded = new Map<string, UploadedImage>()
  await mapWithConcurrency(bodyAssets, 3, async asset => {
    try {
      uploaded.set(asset.id, await uploadAsset(context, asset))
      context.uploadProgress?.complete(asset)
    } catch (error) {
      context.uploadProgress?.fail(asset)
      throw error
    }
  })

  let coverUrl = ""
  const cover = context.task.article.coverAssetId
    ? context.task.assets.find(asset => asset.id === context.task.article.coverAssetId)
    : undefined
  if (cover) {
    try {
      const cropped = await cropWeiboCover(await context.getAssetData(cover), cover.mimeType)
      coverUrl = (await uploadWeiboBlob(cropped, cover.fileName)).url
      if (!bodyAssets.some(asset => asset.id === cover.id)) context.uploadProgress?.complete(cover)
    } catch (error) {
      context.uploadProgress?.fail(cover)
      throw error
    }
  }

  const limited = truncateTitle(context.task.article.title, config.titleLimit)
  const html = spaceWeiboParagraphs(replaceWeiboImages(replaceAssetTokens(context.task.article.html, new Map()), uploaded))
  let endpoint = ENDPOINTS[0]!
  let created: { id: string; payload: unknown }
  try {
    created = await createDraft(endpoint, uid)
  } catch {
    endpoint = ENDPOINTS[1]!
    try {
      created = await createDraft(endpoint, uid)
    } catch (error) {
      throw new Error(`微博 v5 与 v3 草稿创建失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let saved: unknown
  let saveError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      saved = await saveDraft(endpoint, uid, created.id, buildSaveBody(
        endpoint,
        uid,
        created.id,
        limited.title,
        context.task.article.digest,
        html,
        coverUrl
      ))
      saveError = undefined
      break
    } catch (error) {
      saveError = error
    }
  }
  if (saveError) {
    throw new Error(`微博 ${endpoint.version} 草稿 ${created.id} 保存失败，已保留同一草稿且未创建重复草稿：${saveError instanceof Error ? saveError.message : String(saveError)}`)
  }
  const warnings = ["发布范围、封面和声明请在微博头条文章编辑页确认"]
  if (limited.truncated) warnings.unshift(`标题超过微博上限，已按 ${config.titleLimit} 个字符填充`)
  return { draftUrl: draftUrlFromPayload(endpoint, created.id, saved ?? created.payload), warnings }
}

export const weiboAdapter: PlatformAdapter = {
  id: "weibo-article",
  title: config.label,
  editorUrl: config.editorUrl,
  titleLimit: config.titleLimit,
  async detectAccount() {
    if (loginPageDetected()) return { loggedIn: false, message: "请先登录微博" }
    return await resolveWeiboUid()
      ? { loggedIn: true }
      : { loggedIn: false, message: "未识别到微博登录账号，请重新登录后重试" }
  },
  prepareDraft: prepare,
  retry: prepare,
  dispose() {}
}
