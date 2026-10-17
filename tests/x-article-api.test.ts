import { parseXApiConfig, xPublicScriptUrl, xArticleBundleFromRuntime, XArticleApi } from "~lib/x-article-api"

const scripts = ['var a="Bearer AAAAA-public";', 'queryId:"create-new",operationName:"ArticleEntityDraftCreate",metadata:{featureSwitches:["feature_one"]}; queryId:"cover-new",operationName:"ArticleEntityUpdateCoverMedia",metadata:{featureSwitches:[]};']
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe("X current API configuration", () => {
  test("uses current query ids from public scripts", () => {
    const config = parseXApiConfig(scripts)
    expect(config.operations.ArticleEntityDraftCreate).toEqual({ id: "create-new", features: ["feature_one"] })
    expect(config.operations.ArticleEntityUpdateCoverMedia.id).toBe("cover-new")
  })
  test("resolves an unloaded article chunk from the public runtime without executing it", () => {
    const runtime = '.u=e=>(({67713:"bundle.TwitterArticles",12:"other"})[e]+"."+{67713:"764af4222c1d5a1d",12:"12345678"})[e]+"a.js"';
    expect(xArticleBundleFromRuntime(runtime, "https://abs.twimg.com/responsive-web/client-web/main.hash.js")).toBe("https://abs.twimg.com/responsive-web/client-web/bundle.TwitterArticles.764af4222c1d5a1da.js")
    expect(xArticleBundleFromRuntime(runtime, "https://evil.test/main.js")).toBeNull()
    expect(xArticleBundleFromRuntime("invalid", "https://abs.twimg.com/responsive-web/client-web/main.hash.js")).toBeNull()
  })
  test("fails closed if operation metadata is missing", () => {
    expect(() => parseXApiConfig([scripts[0]!])).toThrow("不会回退")
  })
  test("restricts public downloads to X's static script host", () => {
    expect(xPublicScriptUrl("https://abs.twimg.com/responsive-web/client-web/main.hash.js")).toBe(true)
    for (const url of ["https://abs.twimg.com.evil.test/responsive-web/client-web/main.js", "https://x.com/i/api/graphql/id/operation", "https://abs.twimg.com/responsive-web/client-web/main.js?cookie=secret", "http://abs.twimg.com/responsive-web/client-web/main.js", "https://user:pass@abs.twimg.com/responsive-web/client-web/main.js"]) expect(xPublicScriptUrl(url)).toBe(false)
  })
})

describe("X uploads and errors", () => {
  test.each([
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["image/jpeg", [255, 216, 255]],
    ["image/webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]]
  ])("uploads detected %s bytes even when the MIME label is missing", async (mimeType, signature) => {
    vi.spyOn(document, "cookie", "get").mockReturnValue("ct0=csrf")
    const urls: URL[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const parsed = new URL(url)
      urls.push(parsed)
      return parsed.searchParams.get("command") === "APPEND"
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ media_id_string: "1234", expires_after_secs: 3600 }))
    }))
    await new XArticleApi(parseXApiConfig(scripts)).uploadImage(new File([new Uint8Array(signature)], "image", { type: "application/octet-stream" }))
    expect(urls[0]!.searchParams.get("media_type")).toBe(mimeType)
  })
  test("detects GIF bytes even with a PNG name and MIME type before sending INIT", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const file = new File(["GIF89a"], "disguised.png", { type: "image/png" })
    await expect(new XArticleApi(parseXApiConfig(scripts)).uploadImage(file)).rejects.toThrow("格式不支持")
    expect(fetch).not.toHaveBeenCalled()
  })
  test("uploads chunks in order, polls processing and preserves string media IDs", async () => {
    vi.useFakeTimers()
    vi.spyOn(document, "cookie", "get").mockReturnValue("ct0=csrf")
    const calls: Array<{ url: URL; init: RequestInit }> = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: new URL(url), init })
      const cmd = new URL(url).searchParams.get("command")
      if (cmd === "APPEND") return new Response(null, { status: 204 })
      return new Response(JSON.stringify(cmd === "INIT" ? { media_id_string: "9999999999999999999" } : cmd === "FINALIZE" ? { processing_info: { state: "pending", check_after_secs: 1 } } : { processing_info: { state: "succeeded" }, expires_after_secs: 1234 }))
    }))
    const pending = new XArticleApi(parseXApiConfig(scripts)).uploadImage(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), new Uint8Array(4 * 1024 * 1024)], "large.png", { type: "image/png" }))
    await vi.advanceTimersByTimeAsync(1100)
    expect(await pending).toMatchObject({ id: "9999999999999999999" })
    expect(calls.map(call => call.url.searchParams.get("command"))).toEqual(["INIT", "APPEND", "APPEND", "FINALIZE", "STATUS"])
    expect(calls[2]!.url.searchParams.get("segment_index")).toBe("1")
    for (const call of calls) expect(call.init.credentials).toBe("include")
    expect(new Headers(calls[1]!.init.headers).has("content-type")).toBe(false)
  })
  test.each([401, 403, 429, 500])("reports HTTP %i without echoing sensitive server data", async status => {
    vi.spyOn(document, "cookie", "get").mockReturnValue("ct0=csrf")
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "auth_token=private" }] }), { status })))
    await expect(new XArticleApi(parseXApiConfig(scripts)).createDraft("标题", { blocks: [], entity_map: [] })).rejects.not.toThrow("private")
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  test("rejects unsupported or oversized files before network activity", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher)
    const api = new XArticleApi(parseXApiConfig(scripts))
    await expect(api.uploadImage(new File(["x"], "a.gif", { type: "image/gif" }))).rejects.toThrow("PNG")
    await expect(api.uploadImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }))).rejects.toThrow("5 MB")
    expect(fetcher).not.toHaveBeenCalled()
  })
})
