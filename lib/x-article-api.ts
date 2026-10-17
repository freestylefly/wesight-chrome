import type { XContentState } from "~lib/x-article-content"
import { xImageMimeType } from "~lib/x-image-policy"

const OPERATIONS = ["ArticleEntityDraftCreate", "ArticleEntityUpdateCoverMedia"] as const
type Operation = typeof OPERATIONS[number]
interface OperationInfo { id: string; features: string[] }
export interface XApiConfig { bearer: string; operations: Record<Operation, OperationInfo> }
export interface XUploadedMedia { id: string; expiresAt: number }

export class XApiError extends Error {
  constructor(message: string, readonly uncertain = false) { super(message); this.name = "XApiError" }
}

export function xPublicScriptUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "abs.twimg.com" && !url.username && !url.password
      && /^\/responsive-web\/client-web(?:-legacy)?\/[\w.~-]+\.js$/.test(url.pathname) && !url.search
  } catch { return false }
}

export function parseXApiConfig(scripts: string[]): XApiConfig {
  let bearer = ""
  const operations: Partial<Record<Operation, OperationInfo>> = {}
  for (const script of scripts) {
    bearer ||= /["'](Bearer AAAAA[A-Za-z0-9%=_+/-]+)["']/.exec(script)?.[1] ?? ""
    // Inspect the public operation descriptors as data; never execute remote JS.
    for (const match of script.matchAll(/queryId\s*:\s*["']([\w-]+)["']\s*,\s*operationName\s*:\s*["'](ArticleEntityDraftCreate|ArticleEntityUpdateCoverMedia)["']/g)) {
      const tail = script.slice(match.index! + match[0].length, match.index! + match[0].length + 6000).split(/queryId\s*:/)[0]!
      const list = /featureSwitches\s*:\s*\[([^\]]*)\]/.exec(tail)?.[1] ?? ""
      operations[match[2] as Operation] = { id: match[1]!, features: Array.from(list.matchAll(/["']([\w]+)["']/g), item => item[1]!) }
    }
  }
  if (!bearer || OPERATIONS.some(name => !operations[name])) {
    throw new XApiError("未能读取 X 当前的文章接口配置，请刷新 X 文章页后重试；插件不会回退到自动操作页面")
  }
  return { bearer, operations: operations as XApiConfig["operations"] }
}

/** Webpack removes loaded script tags; the public chunk map remains in the page. */
export function xArticleBundleFromRuntime(runtime: string, mainUrl: string): string | null {
  if (!xPublicScriptUrl(mainUrl)) return null
  const chunk = /(?:^|[,\{\s])(\d+)\s*:\s*["']bundle\.TwitterArticles["']/.exec(runtime)?.[1]
  if (!chunk) return null
  const hash = new RegExp(`(?:^|[,\\{\\s])${chunk}\\s*:\\s*["']([a-f0-9]{8,})["']`).exec(runtime)?.[1]
  const suffix = /\}\)?\[\w+\]\s*\+\s*["']([a-z]?\.js)["']/.exec(runtime)?.[1]
  if (!hash || !suffix) return null
  const url = new URL(`bundle.TwitterArticles.${hash}${suffix}`, mainUrl).href
  return xPublicScriptUrl(url) ? url : null
}

export async function discoverXApi(): Promise<XApiConfig> {
  const deadline = Date.now() + 15_000
  let urls: string[] = []
  while (Date.now() < deadline) {
    urls = [...Array.from(document.scripts, script => script.src),
      ...performance.getEntriesByType("resource").map(entry => entry.name)].filter(xPublicScriptUrl)
      .filter(url => /\/(?:main\.|bundle\.TwitterArticles\.)/.test(new URL(url).pathname))
    const mainUrl = urls.find(url => url.includes("/main."))
    if (mainUrl && !urls.some(url => url.includes("/bundle.TwitterArticles."))) {
      for (const script of Array.from(document.scripts).filter(script => !script.src)) {
        const bundle = xArticleBundleFromRuntime(script.textContent ?? "", mainUrl)
        if (bundle) { urls.push(bundle); break }
      }
    }
    if (mainUrl && urls.some(url => url.includes("/bundle.TwitterArticles."))) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  if (!urls.some(url => url.includes("/bundle.TwitterArticles."))) {
    throw new XApiError("X 文章模块尚未加载，请打开 X 的 Articles 页面后重试")
  }
  const scripts = await Promise.all([...new Set(urls)].map(async url => {
    // Content scripts obey the page's CORS policy. The background only fetches
    // allowlisted public X bundles, with no cookies, then returns inert text.
    const result = await chrome.runtime.sendMessage({ type: "GET_X_PUBLIC_SCRIPT", url })
    if (!result?.ok || typeof result.value !== "string") throw new XApiError("读取 X 公开接口配置失败，请稍后重试")
    return result.value as string
  }))
  return parseXApiConfig(scripts)
}

function csrf(): string {
  const token = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("ct0="))?.slice(4)
  if (!token) throw new XApiError("X 登录状态已失效，请重新登录 X 后重试")
  return token
}

function errorMessage(stage: string, status: number, payload: any): string {
  const code = payload?.errors?.[0]?.code
  if (payload?.errors?.some((error: any) => error.extensions?.code === "GRAPHQL_VALIDATION_FAILED")) return `${stage}失败：X 接口字段已变化，请更新扩展后重试`
  if (status === 401 || [32, 89, 215].includes(code)) return `${stage}失败：X 登录状态已失效，请重新登录后重试`
  if (status === 429 || code === 88) return `${stage}失败：X 请求频率受限，请稍后手动重试`
  if (status === 403 || [64, 326, 353].includes(code)) return `${stage}失败：X 拒绝了请求，请在 X 检查账号状态和文章权限`
  if (status === 404) return `${stage}失败：X 文章接口已变更，请刷新页面或更新扩展`
  // Do not copy arbitrary server messages (which may echo requests) into logs.
  return `${stage}失败：X 返回 ${status ? `HTTP ${status}` : "无效响应"}${code !== undefined && /^\d+$/.test(String(code)) ? `，错误码 ${code}` : ""}`
}

export class XArticleApi {
  constructor(private readonly config: Pick<XApiConfig, "bearer"> & { operations?: XApiConfig["operations"] }) {}

  private async request(url: string, init: RequestInit, stage: string, empty = false): Promise<any> {
    const headers = new Headers(init.headers)
    headers.set("authorization", this.config.bearer)
    headers.set("x-csrf-token", csrf())
    headers.set("x-twitter-active-user", "yes")
    headers.set("x-twitter-auth-type", "OAuth2Session")
    headers.set("x-twitter-client-language", "en")
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await fetch(url, { ...init, headers, credentials: "include", signal: controller.signal, redirect: "error" })
      let body: any = null
      if (response.status !== 204) {
        const text = await response.text()
        if (text) {
          try { body = JSON.parse(text) } catch { throw new XApiError(`${stage}失败：X 返回了无法识别的数据`, response.ok || response.status >= 500) }
        }
      }
      if (!response.ok || body?.errors?.length || body?.error) throw new XApiError(errorMessage(stage, response.status, body), response.status >= 500)
      if (!empty && !body) throw new XApiError(`${stage}失败：X 返回空响应`, true)
      return body
    } catch (error) {
      if (error instanceof XApiError) throw error
      throw new XApiError(`${stage}失败：网络中断或请求超时，请检查网络后重试`, true)
    } finally { clearTimeout(timer) }
  }

  private async graphql(operation: Operation, variables: Record<string, unknown>, stage: string): Promise<any> {
    const info = this.config.operations?.[operation]
    if (!info) throw new XApiError("X 文章接口配置不完整，请刷新 X 文章页后重试")
    const features: Record<string, boolean> = {
      profile_label_improvements_pcf_label_in_post_enabled: false,
      responsive_web_profile_redirect_enabled: false,
      rweb_tipjar_consumption_enabled: false,
      verified_phone_label_enabled: false,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true
    }
    for (const name of info.features) if (!(name in features)) features[name] = false
    return this.request(`https://x.com/i/api/graphql/${encodeURIComponent(info.id)}/${operation}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ variables, features, fieldToggles: { withPayments: false, withAuxiliaryUserLabels: false }, queryId: info.id })
    }, stage)
  }

  async createDraft(title: string, content: XContentState): Promise<string> {
    const payload = await this.graphql("ArticleEntityDraftCreate", { title, content_state: content }, "创建 X 草稿")
    const id = payload?.data?.articleentity_create_draft?.article_entity_results?.result?.rest_id
    if (typeof id !== "string" || !/^\d+$/.test(id)) throw new XApiError("X 草稿创建结果未确认，请检查草稿列表后再发起新同步", true)
    return id
  }

  async setCover(id: string, mediaId: string): Promise<void> {
    const payload = await this.graphql("ArticleEntityUpdateCoverMedia", {
      articleEntityId: id, coverMedia: { media_id: mediaId, media_category: "DraftTweetImage" }
    }, "设置 X 封面")
    if (!payload?.data?.articleentity_update_cover_media) throw new XApiError("X 未确认封面保存，请重试；将继续使用同一草稿")
  }

  async uploadImage(file: File): Promise<XUploadedMedia> {
    if (!file.size || file.size > 5 * 1024 * 1024) throw new XApiError(`X 图片“${file.name}”需大于 0 且不超过 5 MB，请压缩后重试`)
    const mimeType = await xImageMimeType(file)
    const endpoint = "https://upload.x.com/i/media/upload.json"
    const initial = await this.request(`${endpoint}?${new URLSearchParams({ command: "INIT", total_bytes: String(file.size), media_type: mimeType, media_category: "tweet_image" })}`, { method: "POST" }, "初始化 X 图片上传")
    const id = initial?.media_id_string
    if (typeof id !== "string" || !/^\d+$/.test(id)) throw new XApiError("X 未返回有效图片 ID，已停止同步")
    const chunkSize = 4 * 1024 * 1024
    for (let offset = 0, index = 0; offset < file.size; offset += chunkSize, index++) {
      const form = new FormData()
      form.append("media", file.slice(offset, offset + chunkSize), file.name)
      await this.request(`${endpoint}?${new URLSearchParams({ command: "APPEND", media_id: id, segment_index: String(index) })}`, { method: "POST", body: form }, "上传 X 图片", true)
    }
    let final = await this.request(`${endpoint}?${new URLSearchParams({ command: "FINALIZE", media_id: id })}`, { method: "POST" }, "完成 X 图片上传")
    const deadline = Date.now() + 90_000
    while (final?.processing_info && final.processing_info.state !== "succeeded") {
      if (final.processing_info.state === "failed") throw new XApiError("X 图片处理失败，请更换图片后重试")
      if (Date.now() >= deadline) throw new XApiError("X 图片处理超时，请稍后重试")
      const delay = Math.min(10, Math.max(1, Number(final.processing_info.check_after_secs) || 1)) * 1000
      await new Promise(resolve => setTimeout(resolve, delay))
      final = await this.request(`${endpoint}?${new URLSearchParams({ command: "STATUS", media_id: id })}`, { method: "GET" }, "检查 X 图片处理")
    }
    const expires = Number(final?.expires_after_secs ?? initial.expires_after_secs ?? 3600)
    return { id, expiresAt: Date.now() + (Number.isFinite(expires) && expires > 0 ? expires : 3600) * 1000 }
  }
}
