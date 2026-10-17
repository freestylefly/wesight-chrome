import type { ContentRequest, ExtensionResponse } from "~types/messages"
import type { PublishTaskV1 } from "~types/protocol"

describe("platform content bootstrap", () => {
  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"))
    vi.resetModules()
    vi.doUnmock("~platforms/config")
    vi.doUnmock("~platforms/index")
    vi.doUnmock("~lib/ready-banner")
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  test("uses an explicit X task owner after SPA navigation, while account checks follow the current page", async () => {
    let receiver!: (message: ContentRequest, sender: unknown, respond: (response: ExtensionResponse) => void) => void
    const article = { detectAccount: vi.fn(async () => ({ loggedIn: true, name: "creator" })), prepareDraft: vi.fn(async () => ({ warnings: [], draftUrl: "https://x.com/compose/articles/edit/123" })), dispose: vi.fn() }
    const post = { detectAccount: vi.fn(async () => ({ loggedIn: true, name: "creator" })), prepareDraft: vi.fn(async () => ({ warnings: [], draftUrl: "https://x.com/compose/post?draft=123" })), dispose: vi.fn() }
    const sendMessage = vi.fn(async () => ({ ok: true, value: true }))
    vi.doUnmock("~platforms/config")
    vi.doMock("~platforms/index", () => ({ PLATFORM_ADAPTERS: { "x-article": article, "x-post": post } }))
    vi.doMock("~lib/ready-banner", () => ({ showReadyBanner: vi.fn() }))
    vi.stubGlobal("location", new URL("https://x.com/home"))
    vi.stubGlobal("chrome", { runtime: { onMessage: { addListener: (listener: typeof receiver) => { receiver = listener } }, sendMessage } })
    await import("~contents/platform")
    const request = (message: ContentRequest) => new Promise<ExtensionResponse>(resolve => receiver(message, {}, resolve))
    const task = { taskId: "x-siblings", targets: ["x-article", "x-post"], article: { html: "<p>正文</p>", markdown: "正文", coverAssetId: null }, assets: [] } as unknown as PublishTaskV1

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "PLATFORM_PAGE_READY", platformId: "x-post" }))
    expect(await request({ type: "PREPARE_DRAFT", platformId: "x-article", task })).toMatchObject({ ok: true })
    expect(article.prepareDraft).toHaveBeenCalledTimes(1)
    expect(post.prepareDraft).not.toHaveBeenCalled()

    vi.stubGlobal("location", new URL("https://x.com/compose/articles"))
    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "PLATFORM_PAGE_READY", platformId: "x-article" }))
    expect(await request({ type: "PREPARE_DRAFT", platformId: "x-post", task })).toMatchObject({ ok: true })
    expect(post.prepareDraft).toHaveBeenCalledTimes(1)
    expect(await request({ type: "CHECK_ACCOUNT" })).toMatchObject({ ok: true, value: { loggedIn: true } })
    expect(article.detectAccount).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event("pagehide"))
    expect(article.dispose).toHaveBeenCalledTimes(1)
    expect(post.dispose).toHaveBeenCalledTimes(1)
  })

  test("resolves legacy single-X tasks on a sibling route and rejects a different platform's task", async () => {
    let receiver!: (message: ContentRequest, sender: unknown, respond: (response: ExtensionResponse) => void) => void
    const post = { detectAccount: vi.fn(async () => ({ loggedIn: true })), prepareDraft: vi.fn(async () => ({ warnings: [] })), dispose: vi.fn() }
    const article = { detectAccount: vi.fn(), prepareDraft: vi.fn(), dispose: vi.fn() }
    vi.doUnmock("~platforms/config")
    vi.doMock("~platforms/index", () => ({ PLATFORM_ADAPTERS: { "x-article": article, "x-post": post } }))
    vi.doMock("~lib/ready-banner", () => ({ showReadyBanner: vi.fn() }))
    vi.stubGlobal("location", new URL("https://x.com/compose/articles"))
    vi.stubGlobal("chrome", { runtime: { onMessage: { addListener: (listener: typeof receiver) => { receiver = listener } }, sendMessage: vi.fn(async () => ({ ok: true, value: true })) } })
    await import("~contents/platform")
    const request = (message: ContentRequest) => new Promise<ExtensionResponse>(resolve => receiver(message, {}, resolve))
    const task = { taskId: "legacy-x", targets: ["x-post"], article: { html: "<p>正文</p>", markdown: "正文", coverAssetId: null }, assets: [] } as unknown as PublishTaskV1
    expect(await request({ type: "PREPARE_DRAFT", task })).toMatchObject({ ok: true })
    expect(post.prepareDraft).toHaveBeenCalledTimes(1)
    expect(article.prepareDraft).not.toHaveBeenCalled()
    expect(await request({ type: "PREPARE_DRAFT", platformId: "jike-post", task })).toMatchObject({ ok: false, error: "当前页面与同步平台不匹配" })
    expect(post.prepareDraft).toHaveBeenCalledTimes(1)
  })

  test("registers the task receiver before announcing that CSDN is ready", async () => {
    const order: string[] = []
    let receiverRegistered = false
    const addListener = vi.fn(() => {
      receiverRegistered = true
      order.push("receiver")
    })
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === "PLATFORM_PAGE_READY") {
        expect(receiverRegistered).toBe(true)
        order.push("ready")
      }
      return { ok: true, value: true }
    })

    vi.doMock("~platforms/config", () => ({ platformFromUrl: () => "csdn" }))
    vi.doMock("~platforms/index", () => ({
      PLATFORM_ADAPTERS: {
        csdn: { dispose: vi.fn() }
      }
    }))
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener },
        sendMessage
      }
    })

    await import("~contents/platform")
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())

    expect(order).toEqual(["receiver", "ready"])
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "PLATFORM_PAGE_READY",
      platformId: "csdn"
    }))
  })
})
