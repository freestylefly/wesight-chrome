import { xArticleAdapter } from "~platforms/x-article"
import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"
import { uploadAssetsForPlatform } from "~lib/upload-progress"

const main = 'const token="Bearer AAAAA-public-web-token";'
const articles = 'queryId:"create-live",operationName:"ArticleEntityDraftCreate",metadata:{featureSwitches:["live_feature"]};queryId:"cover-live",operationName:"ArticleEntityUpdateCoverMedia",metadata:{featureSwitches:[]};'
const calls: Array<{ url: URL; init: RequestInit }> = []
let store: Record<string, unknown>
let createFailure: "network" | "refused" | null
let coverFailure: boolean
let imageFailure: boolean
let nextMedia: number

function task(count = 2): PublishTaskV1 {
  return {
    protocolVersion: 1, taskId: "x", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    source: { vaultPath: "article.md", contentHash: "a".repeat(64) },
    article: { title: "X 文章标题", digest: "", tags: [], coverAssetId: count ? "image-1" : null, markdown: "正文",
      html: `<h2>开头</h2>${Array.from({ length: count }, (_, i) => `<p>段落 ${i + 1}</p><img src="wesight-asset://image-${i + 1}">`).join("")}<p>结尾</p>` },
    assets: Array.from({ length: count }, (_, i) => ({ id: `image-${i + 1}`, fileName: `${i + 1}.png`, mimeType: "image/png", size: 3, sha256: "a".repeat(64) })),
    targets: ["x-article"], behavior: { finalAction: "manual", groupTabs: true }
  }
}
const context = (count = 2) => ({ task: task(count), getAssetData: vi.fn(async (_asset: PublishAssetV1) => "data:image/png;base64,iVBORw0KGgo="), reportProgress: vi.fn() })
const opCalls = (name: string) => calls.filter(call => call.url.pathname.endsWith(`/${name}`))
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

beforeEach(() => {
  calls.length = 0; store = {}; createFailure = null; coverFailure = false; imageFailure = false; nextMedia = 100
  document.head.innerHTML = '<script src="https://abs.twimg.com/responsive-web/client-web/main.hash.js"></script>'
  document.body.innerHTML = '<div data-testid="SideNav_AccountSwitcher_Button"><span>@test_user</span></div><main><a href="/compose/articles">Write</a></main>'
  // The real X page removes the lazy script element after it finishes loading.
  vi.stubGlobal("performance", { getEntriesByType: () => [{ name: "https://abs.twimg.com/responsive-web/client-web/bundle.TwitterArticles.hash.js" }] })
  vi.spyOn(document, "cookie", "get").mockReturnValue("ct0=test-csrf; unrelated=test")
  vi.stubGlobal("chrome", { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(store[key]) })),
    set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(store, structuredClone(value)) })
  } }, runtime: { sendMessage: vi.fn(async (message: { url: string }) => ({ ok: true, value: message.url.includes("/main.") ? main : articles })) } })
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url); calls.push({ url: parsed, init })
    if (parsed.hostname === "upload.x.com") {
      if (imageFailure) return json({ errors: [{ code: 88 }] }, 429)
      const command = parsed.searchParams.get("command")
      if (command === "INIT") return json({ media_id_string: String(nextMedia++), expires_after_secs: 3600 })
      if (command === "APPEND") return new Response(null, { status: 204 })
      return json({ media_id_string: parsed.searchParams.get("media_id"), expires_after_secs: 3600 })
    }
    if (parsed.pathname.endsWith("/ArticleEntityDraftCreate")) {
      if (createFailure === "network") throw new TypeError("failed")
      if (createFailure === "refused") return json({ errors: [{ code: 88 }] }, 429)
      return json({ data: { articleentity_create_draft: { article_entity_results: { result: { rest_id: "1234567890123456789" } } } } })
    }
    if (parsed.pathname.endsWith("/ArticleEntityUpdateCoverMedia")) return coverFailure ? json({ errors: [{ code: 88 }] }, 429) : json({ data: { articleentity_update_cover_media: { rest_id: "1234567890123456789" } } })
    throw new Error(`Unexpected request ${url}`)
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe("X article API adapter", () => {
  test("skips an extensionless remote GIF after reading its bytes and keeps surrounding text", async () => {
    const input = context(1)
    input.task.article.html += '<p>远程图之前<img src="https://cdn.example.com/image?id=1">远程图之后</p>'
    const apiFetch = fetch
    vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => url === "https://cdn.example.com/image?id=1"
      ? Promise.resolve({ ok: true, blob: async () => new Blob(["GIF89a"], { type: "image/png" }) } as Response)
      : apiFetch(url, init)))
    const result = await xArticleAdapter.prepareDraft(input)
    expect(calls.filter(call => call.url.searchParams.get("command") === "INIT")).toHaveLength(1)
    const content = JSON.parse(opCalls("ArticleEntityDraftCreate")[0]!.init.body as string).variables.content_state
    expect(content.blocks.at(-1).text).toBe("远程图之前远程图之后")
    expect(result.warnings[0]).toContain("已跳过 1 张")
  })
  test("skips unsupported body images and cover before applying the 15-image limit", async () => {
    const input = context(18)
    for (const [index, extension, mimeType] of [[0, "gif", "image/gif"], [4, "svg", "image/svg+xml"], [10, "GIF", "image/png"]] as const) {
      Object.assign(input.task.assets[index]!, { fileName: `image.${extension}`, mimeType })
    }
    const original = structuredClone(input.task)
    expect(uploadAssetsForPlatform("x-article", input.task)).toHaveLength(15)
    expect(uploadAssetsForPlatform("csdn", input.task)).toHaveLength(18)
    const result = await xArticleAdapter.prepareDraft(input)
    expect(input.getAssetData.mock.calls.map(([asset]) => asset.id)).not.toContain("image-11")
    expect(calls.filter(call => call.url.searchParams.get("command") === "INIT")).toHaveLength(15)
    expect(opCalls("ArticleEntityUpdateCoverMedia")).toHaveLength(0)
    const content = JSON.parse(opCalls("ArticleEntityDraftCreate")[0]!.init.body as string).variables.content_state
    expect(content.entity_map).toHaveLength(15)
    expect(content.blocks.filter((block: any) => block.type !== "atomic").map((block: any) => block.text))
      .toEqual(["开头", ...Array.from({ length: 18 }, (_, i) => `段落 ${i + 1}`), "结尾"])
    expect(result.warnings[0]).toContain("已跳过 3 张")
    expect(result.warnings[0]).toContain("封面也已跳过")
    expect(input.task).toEqual(original)
  })
  test("skips a disguised GIF without INIT, and keeps its warning when retrying a failed cover", async () => {
    const input = { ...context(3), uploadProgress: { complete: vi.fn(), skip: vi.fn(), fail: vi.fn() } }
    input.getAssetData.mockImplementation(async asset => asset.id === "image-2" ? "data:image/png;base64,R0lGODlh" : "data:image/png;base64,iVBORw0KGgo=")
    coverFailure = true
    await expect(xArticleAdapter.prepareDraft(input)).rejects.toThrow("草稿已保留")
    expect(calls.filter(call => call.url.searchParams.get("command") === "INIT")).toHaveLength(2)
    expect(input.uploadProgress.skip).toHaveBeenCalledWith(input.task.assets[1])
    expect(input.uploadProgress.fail).not.toHaveBeenCalled()
    coverFailure = false
    const result = await xArticleAdapter.retry(input)
    expect(result.warnings[0]).toContain("已跳过 1 张")
    expect(opCalls("ArticleEntityDraftCreate")).toHaveLength(1)
    expect(calls.filter(call => call.url.searchParams.get("command") === "INIT")).toHaveLength(2)
  })
  test("continues with a text-only article when all images are unsupported", async () => {
    const input = context(2)
    input.task.assets.forEach(asset => { asset.mimeType = "image/gif" })
    const result = await xArticleAdapter.prepareDraft(input)
    expect(input.getAssetData).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    const content = JSON.parse(opCalls("ArticleEntityDraftCreate")[0]!.init.body as string).variables.content_state
    expect(content.entity_map).toHaveLength(0)
    expect(content.blocks.map((block: any) => block.text)).toEqual(["开头", "段落 1", "段落 2", "结尾"])
    expect(result.warnings[0]).toContain("已跳过 2 张")
  })
  test("creates a complete draft from the landing page without interacting with page controls", async () => {
    const before = document.body.innerHTML
    const click = vi.spyOn(HTMLElement.prototype, "click")
    const dispatch = vi.spyOn(HTMLElement.prototype, "dispatchEvent")
    const input = context()
    const result = await xArticleAdapter.prepareDraft(input)
    expect(document.body.innerHTML).toBe(before)
    expect(click).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled()
    expect(result.draftUrl).toBe("https://x.com/compose/articles/edit/1234567890123456789")
    const created = JSON.parse(opCalls("ArticleEntityDraftCreate")[0]!.init.body as string)
    expect(created.variables.title).toBe("X 文章标题")
    expect(created.variables.content_state.blocks.map((block: any) => block.text)).toEqual(["开头", "段落 1", " ", "段落 2", " ", "结尾"])
    expect(created.variables.content_state.entity_map.map((entity: any) => entity.value.data.media_items[0].media_id)).toEqual(["100", "101"])
    expect(calls.filter(call => call.url.searchParams.get("command") === "INIT")).toHaveLength(2)
    expect(JSON.parse(opCalls("ArticleEntityUpdateCoverMedia")[0]!.init.body as string).variables.coverMedia.media_id).toBe("100")
    expect(calls.some(call => /publish/i.test(call.url.pathname))).toBe(false)
    expect(input.reportProgress).toHaveBeenCalledWith("X 草稿已保存，正在打开编辑页")
    expect(JSON.stringify(store)).not.toContain("test-csrf")
    expect(JSON.stringify(store)).not.toContain("Bearer")
  })
  test("creates a text-only draft without any image requests", async () => {
    await xArticleAdapter.prepareDraft(context(0))
    expect(calls).toHaveLength(1)
    expect(opCalls("ArticleEntityUpdateCoverMedia")).toHaveLength(0)
  })
  test("rejects 16 images before any network request", async () => {
    await expect(xArticleAdapter.prepareDraft(context(16))).rejects.toThrow("15 张")
    expect(calls).toHaveLength(0)
  })
  test("preserves all 15 images and reuses the first for the cover", async () => {
    await xArticleAdapter.prepareDraft(context(15))
    expect(calls.filter(call => call.url.searchParams.get("command") === "INIT")).toHaveLength(15)
    const created = JSON.parse(opCalls("ArticleEntityDraftCreate")[0]!.init.body as string)
    expect(created.variables.content_state.entity_map).toHaveLength(15)
  })
  test("uploads only the first 15 of 23 images when selected and preserves every paragraph", async () => {
    const input = context(23)
    input.task.targetOptions = { xArticle: { skipExcessImages: true } }
    const original = structuredClone(input.task)
    expect(uploadAssetsForPlatform("x-article", input.task)).toHaveLength(15)
    expect(uploadAssetsForPlatform("csdn", input.task)).toHaveLength(23)
    const result = await xArticleAdapter.prepareDraft(input)
    expect(input.getAssetData.mock.calls.map(([asset]) => asset.id)).toEqual(input.task.assets.slice(0, 15).map(asset => asset.id))
    expect(calls.filter(call => call.url.searchParams.get("command") === "INIT")).toHaveLength(15)
    const content = JSON.parse(opCalls("ArticleEntityDraftCreate")[0]!.init.body as string).variables.content_state
    expect(content.entity_map).toHaveLength(15)
    expect(content.blocks.filter((block: any) => block.type !== "atomic").map((block: any) => block.text))
      .toEqual(["开头", ...Array.from({ length: 23 }, (_, i) => `段落 ${i + 1}`), "结尾"])
    expect(result.warnings).toContain("X 已跳过超出上限的 8 张正文图片，全部文字已保留")
    expect(input.task).toEqual(original)
  })
  test("reserves one upload slot for a cover outside the retained body images", async () => {
    const input = context(23)
    input.task.article.coverAssetId = "image-23"
    input.task.targetOptions = { xArticle: { skipExcessImages: true } }
    expect(uploadAssetsForPlatform("x-article", input.task)).toHaveLength(15)
    await xArticleAdapter.prepareDraft(input)
    expect(input.getAssetData.mock.calls.map(([asset]) => asset.id)).toEqual([...input.task.assets.slice(0, 14).map(asset => asset.id), "image-23"])
    const content = JSON.parse(opCalls("ArticleEntityDraftCreate")[0]!.init.body as string).variables.content_state
    expect(content.entity_map).toHaveLength(14)
    expect(content.blocks.at(-1).text).toBe("结尾")
    expect(JSON.parse(opCalls("ArticleEntityUpdateCoverMedia")[0]!.init.body as string).variables.coverMedia.media_id).toBe("114")
  })
  test("stops on an upload error without creating an incomplete article", async () => {
    imageFailure = true
    await expect(xArticleAdapter.prepareDraft(context())).rejects.toThrow("频率受限")
    expect(opCalls("ArticleEntityDraftCreate")).toHaveLength(0)
  })
  test("retries a failed cover against the same draft and keeps uploaded images", async () => {
    coverFailure = true
    await expect(xArticleAdapter.prepareDraft(context())).rejects.toThrow("草稿已保留")
    coverFailure = false
    await xArticleAdapter.retry(context())
    expect(opCalls("ArticleEntityDraftCreate")).toHaveLength(1)
    expect(opCalls("ArticleEntityUpdateCoverMedia")).toHaveLength(2)
    expect(calls.filter(call => call.url.searchParams.get("command") === "INIT")).toHaveLength(2)
  })
  test("does not create another draft after an ambiguous create response", async () => {
    createFailure = "network"
    await expect(xArticleAdapter.prepareDraft(context())).rejects.toThrow("网络中断")
    createFailure = null
    await expect(xArticleAdapter.retry(context())).rejects.toThrow("结果未确认")
    expect(opCalls("ArticleEntityDraftCreate")).toHaveLength(1)
  })
  test("allows a manual retry after an explicit refusal", async () => {
    createFailure = "refused"
    await expect(xArticleAdapter.prepareDraft(context())).rejects.toThrow("频率受限")
    createFailure = null
    await xArticleAdapter.retry(context())
    expect(opCalls("ArticleEntityDraftCreate")).toHaveLength(2)
  })
  test("deduplicates concurrent and already completed requests", async () => {
    await Promise.all([xArticleAdapter.prepareDraft(context()), xArticleAdapter.prepareDraft(context())])
    await xArticleAdapter.retry(context())
    expect(opCalls("ArticleEntityDraftCreate")).toHaveLength(1)
  })
  test("keeps retries bound to the original X account", async () => {
    coverFailure = true
    await expect(xArticleAdapter.prepareDraft(context())).rejects.toThrow()
    document.querySelector("span")!.textContent = "@different_account"
    await expect(xArticleAdapter.retry(context())).rejects.toThrow("账号不同")
    expect(opCalls("ArticleEntityDraftCreate")).toHaveLength(1)
  })
  test("refuses to create without a CSRF session", async () => {
    vi.spyOn(document, "cookie", "get").mockReturnValue("")
    await expect(xArticleAdapter.prepareDraft(context(0))).rejects.toThrow("登录状态已失效")
    expect(calls).toHaveLength(0)
  })
})
