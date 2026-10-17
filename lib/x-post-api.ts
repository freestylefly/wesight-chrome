import { XApiError, XArticleApi, type XUploadedMedia } from "~lib/x-article-api"

const OPERATION = "saveDraftTweetCreateMutation" as const
export interface XPostApiConfig { bearer: string; operation: { id: string; name: typeof OPERATION } }
const PUBLIC_PREFIX = "https://abs.twimg.com/x-web/x-web/"

/** Parse published operation descriptors as data. Remote scripts are never run. */
export function parseXPostApiConfig(scripts: readonly string[]): XPostApiConfig {
  let bearer = ""
  let id = ""
  for (const script of scripts) {
    bearer ||= /[\x60"'](Bearer AAAAA[A-Za-z0-9%=_+/-]+)[\x60"']/.exec(script)?.[1] ?? ""
    for (const match of script.matchAll(/params\s*:\s*\{\s*id\s*:\s*[\x60"']([\w-]+)[\x60"']\s*,\s*metadata\s*:\s*\{[^}]*\}\s*,\s*name\s*:\s*[\x60"']saveDraftTweetCreateMutation[\x60"']\s*,\s*operationKind\s*:\s*[\x60"']mutation[\x60"']\s*,\s*text\s*:\s*null/g)) {
      const definition = script.slice(Math.max(0, match.index! - 3000), match.index)
      if (definition.includes("drafttweet_v2_insert") && definition.includes("post_tweet_request")) id = match[1]!
    }
  }
  if (!bearer || !/^[\w-]{8,100}$/.test(id)) {
    throw new XApiError("未能读取 X 当前的动态草稿接口配置，请更新扩展后重试；插件不会回退到操作 X 页面控件")
  }
  return { bearer, operation: { id, name: OPERATION } }
}

function publicScriptUrl(value: string, name: "entry" | "startup" | "dynamic" | "composer"): boolean {
  const names = {
    entry: /^\/x-web\/x-web\/entry-client-logged-out-[\w-]+\.js$/,
    startup: /^\/x-web\/x-web\/assets\/startup-(?!dynamic-|vendor-)[\w-]+\.js$/,
    dynamic: /^\/x-web\/x-web\/assets\/startup-dynamic-[\w-]+\.js$/,
    composer: /^\/x-web\/x-web\/assets\/tweet-composer-slot-[\w-]+\.js$/
  }
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "abs.twimg.com" && !url.username && !url.password && !url.search && !url.hash && names[name].test(url.pathname)
  } catch { return false }
}

/** Runs in the extension background: five public files, no session cookies. */
export async function discoverPublicXPostApi(): Promise<XPostApiConfig> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let total = 0
  const read = async (url: string): Promise<string> => {
    const response = await fetch(url, { credentials: "omit", redirect: "error", signal: controller.signal })
    if (!response.ok) throw new XApiError("读取 X 公开动态接口配置失败，请稍后重试")
    if (Number(response.headers.get("content-length")) > 3 * 1024 * 1024) throw new XApiError("X 公开接口配置超出大小限制，请更新扩展后重试")
    const source = await response.text()
    total += source.length
    if (source.length > 3 * 1024 * 1024 || total > 8 * 1024 * 1024) throw new XApiError("X 公开接口配置超出大小限制，请更新扩展后重试")
    return source
  }
  const linked = (source: string, pattern: RegExp, base: string, kind: Parameters<typeof publicScriptUrl>[1]): string => {
    const reference = pattern.exec(source)?.[1]
    const url = reference ? new URL(reference, base).href : ""
    if (!publicScriptUrl(url, kind)) throw new XApiError("X 公开动态模块已更新，请更新扩展后重试")
    return url
  }
  try {
    const html = await read("https://x.com/")
    const entryUrl = linked(html, /src\s*=\s*["'](https:\/\/abs\.twimg\.com\/x-web\/x-web\/entry-client-logged-out-[\w-]+\.js)["']/, PUBLIC_PREFIX, "entry")
    const entry = await read(entryUrl)
    const startupUrl = linked(entry, /[\x60"'](\.\/assets\/startup-(?!dynamic-|vendor-)[\w-]+\.js)[\x60"']/, entryUrl, "startup")
    const dynamicUrl = linked(entry, /[\x60"'](\.\/assets\/startup-dynamic-[\w-]+\.js)[\x60"']/, entryUrl, "dynamic")
    const [startup, dynamic] = await Promise.all([read(startupUrl), read(dynamicUrl)])
    const composerUrl = linked(dynamic, /[\x60"'](\.\/tweet-composer-slot-[\w-]+\.js)[\x60"']/, dynamicUrl, "composer")
    return parseXPostApiConfig([startup, await read(composerUrl)])
  } catch (error) {
    if (error instanceof XApiError) throw error
    throw new XApiError("读取 X 动态草稿接口配置超时或网络中断，请检查网络后重试")
  } finally { clearTimeout(timer) }
}

export async function discoverXPostApi(): Promise<XPostApiConfig> {
  const response = await chrome.runtime.sendMessage({ type: "GET_X_POST_API_CONFIG" })
  const config = response?.ok ? response.value as XPostApiConfig | undefined : undefined
  if (!config || config.operation?.name !== OPERATION || !/^[\w-]{8,100}$/.test(config.operation.id)
    || !/^Bearer AAAAA[A-Za-z0-9%=_+/-]+$/.test(config.bearer)) {
    throw new XApiError(typeof response?.error === "string" ? response.error : "未能读取 X 动态草稿接口配置，请稍后重试")
  }
  return config
}

function csrf(): string {
  const token = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("ct0="))?.slice(4)
  if (!token) throw new XApiError("X 登录状态已失效，请重新登录 X 后重试")
  return token
}

function responseError(status: number, payload: any): XApiError {
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  const codes = errors.map((error: any) => Number(error.code ?? error.extensions?.code))
  if (errors.some((error: any) => error.extensions?.code === "GRAPHQL_VALIDATION_FAILED")) return new XApiError("保存 X 动态草稿失败：X 接口字段已变化，请更新扩展后重试")
  if (status === 401 || codes.some((code: number) => [32, 89, 215].includes(code))) return new XApiError("保存 X 动态草稿失败：X 登录状态已失效，请重新登录后重试")
  if (status === 429 || codes.includes(88)) return new XApiError("保存 X 动态草稿失败：X 请求频率受限，请稍后手动重试")
  if (status === 403 || codes.some((code: number) => [64, 326, 353].includes(code))) return new XApiError("保存 X 动态草稿失败：X 拒绝了请求，请在 X 检查账号状态")
  if (status === 404) return new XApiError("保存 X 动态草稿失败：X 草稿接口已变更，请更新扩展后重试")
  return new XApiError(`保存 X 动态草稿失败：X 返回 HTTP ${status}，请检查 X 草稿列表后重试`, status >= 500 || status < 400)
}

export class XPostApi {
  constructor(private readonly config: XPostApiConfig) {}

  uploadImage(file: File): Promise<XUploadedMedia> { return new XArticleApi({ bearer: this.config.bearer }).uploadImage(file) }

  async createDraft(text: string, mediaIds: readonly string[]): Promise<string> {
    if (mediaIds.length > 4 || mediaIds.some(id => !/^\d+$/.test(id))) throw new XApiError("X 动态图片信息无效，请重新发起同步")
    const csrfToken = csrf()
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45_000)
    try {
      // This is the native draft-only Relay mutation in X's public composer.
      // CreateTweet and other final-publication endpoints are never called.
      const response = await fetch(`https://api.x.com/graphql/${encodeURIComponent(this.config.operation.id)}/${OPERATION}`, {
        method: "POST", credentials: "include", redirect: "error", signal: controller.signal,
        headers: { "authorization": this.config.bearer, "x-csrf-token": csrfToken, "x-twitter-auth-type": "OAuth2Session", "content-type": "application/json" },
        body: JSON.stringify({ queryId: this.config.operation.id, variables: { post_tweet_request: { status: text, media_ids: [...mediaIds], possibly_sensitive: false } } })
      })
      let payload: any
      try { payload = await response.json() }
      catch { throw new XApiError("保存 X 动态草稿结果未确认：X 返回了无法识别的数据", response.ok || response.status >= 500) }
      const id = payload?.data?.drafttweet_v2_insert?.rest_id
      if (response.ok && typeof id === "string" && /^\d+$/.test(id)) return id
      if (!response.ok || payload?.errors?.length) throw responseError(response.status, payload)
      throw new XApiError("X 动态草稿创建结果未确认，请检查 X 草稿列表后再发起新同步", true)
    } catch (error) {
      if (error instanceof XApiError) throw error
      throw new XApiError("保存 X 动态草稿失败：网络中断或请求超时，请检查网络后重试", true)
    } finally { clearTimeout(timer) }
  }
}
