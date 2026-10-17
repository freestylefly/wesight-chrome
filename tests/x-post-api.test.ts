import { discoverPublicXPostApi, discoverXPostApi, parseXPostApiConfig, XPostApi } from "~lib/x-post-api"
import { XApiError, XArticleApi, xPublicScriptUrl } from "~lib/x-article-api"

// Reduced inert descriptors from X's public x-web composer and startup modules.
const startup = 'headers.set(`Authorization`,`Bearer AAAAA-public-web-token`);'
const descriptor = 'var e=[{kind:`LocalArgument`,name:`post_tweet_request`}],t={kind:`LinkedField`,name:`drafttweet_v2_insert`};var request={params:{id:`live-draft-query`,metadata:{},name:`saveDraftTweetCreateMutation`,operationKind:`mutation`,text:null}};'
const config = () => parseXPostApiConfig([startup, descriptor])
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const prefix = "https://abs.twimg.com/x-web/x-web/"
const manifest: Record<string, string> = {
  "https://x.com/": `<script type="module" src="${prefix}entry-client-logged-out-new.js"></script>`,
  [`${prefix}entry-client-logged-out-new.js`]: 'import"./assets/startup-dynamic-new.js";import"./assets/startup-vendor-new.js";import"./assets/startup-new.js";',
  [`${prefix}assets/startup-new.js`]: startup,
  [`${prefix}assets/startup-dynamic-new.js`]: 'import(`./tweet-composer-slot-new.js`)',
  [`${prefix}assets/tweet-composer-slot-new.js`]: descriptor
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe("X public dynamic draft configuration", () => {
  test("discovers only the native draft insertion descriptor without executing scripts", () => {
    expect(config()).toEqual({ bearer: "Bearer AAAAA-public-web-token", operation: { id: "live-draft-query", name: "saveDraftTweetCreateMutation" } })
    expect(() => parseXPostApiConfig([startup, descriptor.replace(/saveDraftTweetCreateMutation/g, "CreateTweet")])).toThrow("不会回退")
    expect(() => parseXPostApiConfig([startup])).toThrow("接口配置")
    expect(() => parseXPostApiConfig([descriptor])).toThrow("接口配置")
  })
  test("reads five controlled public files without session cookies or arbitrary script hosts", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (!(url in manifest)) throw new Error("Unexpected URL")
      return new Response(manifest[url])
    }))
    expect(await discoverPublicXPostApi()).toEqual(config())
    expect(calls).toHaveLength(5)
    for (const { init } of calls) {
      expect(init.credentials).toBe("omit")
      expect(init.redirect).toBe("error")
      expect(init.headers).toBeUndefined()
    }
  })
  test("fails closed when the official manifest no longer contains the expected module", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<script src="https://evil.test/entry-client-logged-out-new.js"></script>')))
    await expect(discoverPublicXPostApi()).rejects.toThrow("公开动态模块已更新")
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  test("limits downloaded file size before accepting a descriptor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("too large", { headers: { "content-length": String(3 * 1024 * 1024 + 1) } })))
    await expect(discoverPublicXPostApi()).rejects.toThrow("超出大小限制")
  })
  test("fetches config through the background and validates its operation", async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, value: config() }))
    vi.stubGlobal("chrome", { runtime: { sendMessage } })
    expect(await discoverXPostApi()).toEqual(config())
    expect(sendMessage).toHaveBeenCalledWith({ type: "GET_X_POST_API_CONFIG" })
    sendMessage.mockResolvedValueOnce({ ok: true, value: { ...config(), operation: { id: "valid-query", name: "CreateTweet" } } } as never)
    await expect(discoverXPostApi()).rejects.toThrow("未能读取")
  })
  test("allows native shared filenames while preserving the existing public-source boundary", () => {
    expect(xPublicScriptUrl("https://abs.twimg.com/responsive-web/client-web/shared~bundle.Compose~other.hash.js")).toBe(true)
    for (const url of ["https://abs.twimg.com.evil.test/responsive-web/client-web/shared~file.js", "https://abs.twimg.com/responsive-web/client-web/shared~file.js?token=secret", "http://abs.twimg.com/responsive-web/client-web/shared~file.js", "https://u:p@abs.twimg.com/responsive-web/client-web/shared~file.js"]) expect(xPublicScriptUrl(url)).toBe(false)
  })
})

describe("X native dynamic draft requests", () => {
  beforeEach(() => { vi.spyOn(document, "cookie", "get").mockReturnValue("ct0=test-csrf") })
  test("calls only the verified draft mutation with the whole text and uploaded media IDs", async () => {
    const fetcher = vi.fn(async () => json({ data: { drafttweet_v2_insert: { rest_id: "1234567890123456789" } } }))
    vi.stubGlobal("fetch", fetcher)
    expect(await new XPostApi(config()).createDraft("正文\n\n#标签", ["1234", "5678"])).toBe("1234567890123456789")
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.x.com/graphql/live-draft-query/saveDraftTweetCreateMutation")
    expect(init.credentials).toBe("include")
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("test-csrf")
    expect(JSON.parse(init.body as string)).toEqual({ queryId: "live-draft-query", variables: { post_tweet_request: { status: "正文\n\n#标签", media_ids: ["1234", "5678"], possibly_sensitive: false } } })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(url).not.toMatch(/CreateTweet|publish|scheduled/i)
  })
  test("does not send requests without a CSRF session or with invalid media IDs", async () => {
    vi.stubGlobal("fetch", vi.fn())
    await expect(new XPostApi(config()).createDraft("hello", ["not-media"])).rejects.toThrow("图片信息无效")
    vi.spyOn(document, "cookie", "get").mockReturnValue("")
    await expect(new XPostApi(config()).createDraft("hello", [])).rejects.toThrow("登录状态已失效")
    expect(fetch).not.toHaveBeenCalled()
  })
  test.each([
    [401, "登录状态已失效", false], [403, "账号状态", false], [429, "频率受限", false], [500, "HTTP 500", true]
  ])("reports HTTP %i precisely and never echoes server text", async (status, message, uncertain) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ errors: [{ message: "auth_token=private" }] }, status)))
    try { await new XPostApi(config()).createDraft("hello", []); throw new Error("expected failure") }
    catch (error) {
      expect(error).toBeInstanceOf(XApiError)
      expect((error as XApiError).message).toContain(message)
      expect((error as XApiError).message).not.toContain("private")
      expect((error as XApiError).uncertain).toBe(uncertain)
    }
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  test("treats a malformed successful response or interrupted mutation as uncertain without retry", async () => {
    const fetcher = vi.fn(async () => json({ data: {} }))
    vi.stubGlobal("fetch", fetcher)
    await expect(new XPostApi(config()).createDraft("hello", [])).rejects.toMatchObject({ uncertain: true })
    fetcher.mockRejectedValueOnce(new TypeError("network private"))
    await expect(new XPostApi(config()).createDraft("hello", [])).rejects.toMatchObject({ uncertain: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  test("reuses article image upload with tweet_image media category, preserving string IDs", async () => {
    const urls: URL[] = []
    vi.stubGlobal("fetch", vi.fn(async (value: string) => {
      const url = new URL(value); urls.push(url)
      return url.searchParams.get("command") === "APPEND" ? new Response(null, { status: 204 }) : json({ media_id_string: "9999999999999999999", expires_after_secs: 3600 })
    }))
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "image.png", { type: "image/png" })
    expect(await new XPostApi(config()).uploadImage(file)).toMatchObject({ id: "9999999999999999999" })
    expect(urls[0]!.searchParams.get("media_category")).toBe("tweet_image")
    expect(urls.map(url => url.searchParams.get("command"))).toEqual(["INIT", "APPEND", "FINALIZE"])
  })
  test("the shared uploader cannot perform article mutations without article configuration", async () => {
    vi.stubGlobal("fetch", vi.fn())
    await expect(new XArticleApi({ bearer: "public" }).createDraft("title", { blocks: [], entity_map: [] })).rejects.toThrow("文章接口配置不完整")
    expect(fetch).not.toHaveBeenCalled()
  })
})
