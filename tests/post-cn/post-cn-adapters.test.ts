import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { POST_CN_ADAPTERS } from "~platforms/adapters/post-cn"
import { platformDefinition } from "~platforms/catalog"
import { POST_CN_PLATFORMS } from "~platforms/catalog/post-cn"
import { platformFromUrl } from "~platforms/config"
import { findAction, isFinalAction, postBody, topicText, type createPostCnAdapter } from "~platforms/post-cn/common"
import type { PublishTaskV1 } from "~types/protocol"

type PostCnAdapter = ReturnType<typeof createPostCnAdapter>
type Id = (typeof POST_CN_PLATFORMS)[number]["id"]

class TestDataTransfer {
  files: File[] = []
  private data = new Map<string, string>()
  items = { add: (file: File) => this.files.push(file) }
  setData(type: string, value: string) { this.data.set(type, value) }
  getData(type: string) { return this.data.get(type) ?? "" }
}

class TestClipboardEvent extends Event {
  clipboardData: TestDataTransfer | null
  constructor(type: string, init: EventInit & { clipboardData?: TestDataTransfer } = {}) {
    super(type, init)
    this.clipboardData = init.clipboardData ?? null
  }
}

interface Case {
  id: Id
  fixture: string
  /** Expected body text after filling (whitespace removed). */
  body: string
  title: boolean
  warnings: RegExp[]
  sequential?: boolean
  /** Page URL (path + query) the editor runs on. */
  path?: string
}

const BODY = "正文第一段正文第二段"
const CASES: Case[] = [
  { id: "toutiao-post", fixture: "toutiao", body: `${BODY}#AI##世界模型#`, title: false, warnings: [/没有标题栏/] },
  { id: "zhihu-post", fixture: "zhihu", body: BODY, title: true, warnings: [/话题需要在编辑页手动选择/] },
  { id: "bilibili-post", fixture: "bilibili", body: `${BODY}#AI##世界模型#`, title: true, warnings: [] },
  { id: "juejin-post", fixture: "juejin", body: BODY, title: false, warnings: [/没有标题栏/, /话题需要在编辑页手动选择/], sequential: true },
  { id: "douyin-post", fixture: "douyin", body: `${BODY}#AI#世界模型`, title: true, warnings: [] },
  { id: "kuaishou-post", fixture: "kuaishou", body: `${BODY}#AI#世界模型`, title: false, warnings: [/没有标题栏/] },
  { id: "xueqiu-post", fixture: "xueqiu", body: `${BODY}#AI##世界模型#`, title: false, warnings: [/没有标题栏/] },
  { id: "douban-post", fixture: "douban", body: BODY, title: false, warnings: [/没有标题栏/, /话题需要在编辑页手动选择/], sequential: true },
  { id: "zsxq-post", fixture: "zsxq", body: BODY, title: false, warnings: [/没有标题栏/, /话题需要在编辑页手动选择/] },
  { id: "shipinhao-post", fixture: "shipinhao", body: `${BODY}#AI#世界模型`, title: true, warnings: [] },
  { id: "xiaoheihe-post", fixture: "xiaoheihe", body: BODY, title: true, warnings: [/话题需要在编辑页手动选择/] },
  { id: "maimai-post", fixture: "maimai", body: BODY, title: false, warnings: [/没有标题栏/, /话题需要在编辑页手动选择/] },
  { id: "dedao-post", fixture: "dedao", body: BODY, title: false, warnings: [/没有标题栏/, /话题需要在编辑页手动选择/] },
  { id: "baijiahao-post", fixture: "baijiahao", body: BODY, title: false, warnings: [/没有标题栏/, /话题需要在编辑页手动选择/],
    path: "/builder/rc/edit?type=events" }
]

function task(id: Id, images = 3, extra: Partial<PublishTaskV1> = {}): PublishTaskV1 {
  return {
    protocolVersion: 1,
    taskId: `${id}-fixture`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    source: { vaultPath: "动态", contentHash: "a".repeat(64) },
    article: {
      title: "测试标题",
      digest: "",
      markdown: "正文第一段\n\n正文第二段",
      html: "<p>正文第一段<br><br>正文第二段</p>",
      coverAssetId: images ? "asset-1" : null,
      tags: ["AI", "世界模型"]
    },
    assets: Array.from({ length: images }, (_, index) => ({
      id: `asset-${index + 1}`,
      fileName: `image-${index + 1}.png`,
      mimeType: "image/png",
      size: 3,
      sha256: String(index + 1).repeat(64).slice(0, 64)
    })),
    targets: [id],
    behavior: { finalAction: "manual", groupTabs: true },
    ...extra
  }
}

let selectedFiles: string[] = []
let publishClicks = 0

/** Simulates the platform: buttons reveal panels, file inputs render remote thumbnails. */
function load(fixture: string): void {
  document.documentElement.innerHTML = readFileSync(resolve(process.cwd(), "tests/fixtures/post-cn", `${fixture}.html`), "utf8")
  selectedFiles = []
  publishClicks = 0
  for (const element of document.querySelectorAll<HTMLElement>("[data-reveals]:not(input)")) {
    element.addEventListener("click", () => document.querySelector<HTMLElement>(element.dataset.reveals!)?.removeAttribute("hidden"))
  }
  for (const input of document.querySelectorAll<HTMLInputElement>("input[type='file']")) {
    Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
    input.addEventListener("change", () => {
      const previews = input.parentElement!.querySelector(".previews")!
      for (const file of Array.from(input.files ?? [])) {
        selectedFiles.push(file.name)
        const image = document.createElement("img")
        image.src = `https://cdn.test/${file.name}`
        previews.appendChild(image)
      }
      if (input.dataset.reveals) document.querySelector<HTMLElement>(input.dataset.reveals)?.removeAttribute("hidden")
    })
  }
  for (const button of document.querySelectorAll<HTMLElement>(".publish")) button.addEventListener("click", () => { publishClicks += 1 })
}

function text(element: Element | null): string {
  if (!element) return ""
  const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? ""
  return value.replace(/\s+/g, "")
}

beforeEach(() => {
  vi.stubGlobal("DataTransfer", TestDataTransfer)
  vi.stubGlobal("ClipboardEvent", TestClipboardEvent)
  history.replaceState({}, "", "/")
})

afterEach(() => {
  Object.values(POST_CN_ADAPTERS).forEach(adapter => adapter.dispose())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("国内动态 catalog", () => {
  test("every entry is optional beta with brand, media and an editor URL that routes back to it", () => {
    for (const entry of POST_CN_PLATFORMS) {
      expect(entry.permission).toBe("optional")
      expect(entry.stage).toBe("beta")
      expect(entry.brand.glyph).toBeTruthy()
      expect(entry.media.images).toBeGreaterThan(0)
      expect(platformFromUrl(entry.editorUrl)).toBe(entry.id)
    }
  })

  test("shared hosts keep the core platform as fallback and share its account", () => {
    expect(platformFromUrl("https://www.zhihu.com/question/1")).toBe("zhihu")
    expect(platformFromUrl("https://mp.toutiao.com/profile_v4/graphic/publish")).toBe("toutiao")
    expect(platformFromUrl("https://juejin.cn/editor/drafts/new?v=2")).toBe("juejin")
    expect(platformDefinition("zhihu-post").accountKey).toBe("zhihu")
    expect(platformDefinition("toutiao-post").accountKey).toBe("toutiao")
    expect(platformDefinition("juejin-post").accountKey).toBe("juejin")
    expect(platformDefinition("bilibili-post").accountKey).toBe("bilibili")
  })

  test("query-routed entries only claim their own editor routes", () => {
    expect(platformFromUrl("https://baijiahao.baidu.com/builder/rc/edit?type=events")).toBe("baijiahao-post")
    expect(platformFromUrl("https://baijiahao.baidu.com/builder/rc/edit?type=news")).toBe("baijiahao-article")
    expect(platformFromUrl("https://cp.kuaishou.com/article/publish/video?tabType=2")).toBe("kuaishou-post")
    // kuaishou-video will be the host fallback; the post pattern itself must not claim other tabs.
    const kuaishou = new RegExp(platformDefinition("kuaishou-post").paths![0]!)
    expect(kuaishou.test("/article/publish/video?tabType=1")).toBe(false)
    expect(kuaishou.test("/article/publish/video")).toBe(false)
  })

  test("image-text platforms that reject text-only posts declare requiresMedia", () => {
    const required = POST_CN_PLATFORMS.filter(entry => "requiresMedia" in entry.media && entry.media.requiresMedia).map(entry => entry.id).sort()
    expect(required).toEqual(["douyin-post", "kuaishou-post", "shipinhao-post"])
  })
})

describe.each(CASES)("$id adapter", testCase => {
  const adapter = POST_CN_ADAPTERS[testCase.id] as PostCnAdapter

  test("fills body, title and images in order without publishing", async () => {
    load(testCase.fixture)
    if (testCase.path) history.replaceState({}, "", testCase.path)
    const complete = vi.fn()
    const result = await adapter.prepareDraft({
      task: task(testCase.id),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete, fail: vi.fn() }
    })

    expect(text(document.querySelector("[data-testid='editor']"))).toBe(testCase.body)
    if (testCase.title) expect((document.querySelector<HTMLInputElement>("[data-testid='title']"))?.value).toBe("测试标题")
    expect(selectedFiles).toEqual(["image-1.png", "image-2.png", "image-3.png"])
    expect(complete).toHaveBeenCalledTimes(3)
    expect(result.warnings).toHaveLength(testCase.warnings.length)
    for (const pattern of testCase.warnings) expect(result.warnings.some(warning => pattern.test(warning)), String(pattern)).toBe(true)
    expect(publishClicks).toBe(0)
    if (testCase.sequential) expect(document.querySelector<HTMLInputElement>("input[type='file']")?.multiple).toBe(false)
  })

  test("reports the login wall instead of filling", async () => {
    document.documentElement.innerHTML = "<body><main><h2>扫码登录</h2><p>使用账号登录 登录百家号 验证码登录 密码登录 手机号登录 短信登录/注册 登录得到 登录脉脉 扫描二维码登录 微信扫码登录 登录掘金 登录知乎 登录豆瓣</p><button class='publish'>发布</button></main></body>"
    const account = await adapter.detectAccount()
    expect(account.loggedIn).toBe(false)
    expect(account.message).toMatch(/^请先登录/)
    await expect(adapter.prepareDraft({ task: task(testCase.id), getAssetData: async () => "" })).rejects.toThrow(/请先登录/)
  })
})

describe("国内动态 shared behaviour", () => {
  test("logged-in pages detect as signed in", async () => {
    load("toutiao")
    await expect(POST_CN_ADAPTERS["toutiao-post"].detectAccount()).resolves.toEqual({ loggedIn: true })
  })

  test("rejects video tasks for image-text platforms", async () => {
    load("bilibili")
    const video = { id: "video-1", fileName: "clip.mp4", mimeType: "video/mp4", size: 3, sha256: "v".repeat(64) }
    await expect(POST_CN_ADAPTERS["bilibili-post"].prepareDraft({
      task: task("bilibili-post", 0, { assets: [video], media: { videoAssetId: "video-1" } }),
      getAssetData: async () => "data:video/mp4;base64,AQID"
    })).rejects.toThrow(/不支持同步视频/)
  })

  test("image-text platforms that need images refuse text-only posts", async () => {
    load("douyin")
    await expect(POST_CN_ADAPTERS["douyin-post"].prepareDraft({
      task: task("douyin-post", 0),
      getAssetData: async () => ""
    })).rejects.toThrow(/至少需要一张图片/)
  })

  test("text-only posts work and leave the publish button alone", async () => {
    load("toutiao")
    const result = await POST_CN_ADAPTERS["toutiao-post"].prepareDraft({
      task: task("toutiao-post", 0, { article: { ...task("toutiao-post").article, title: "动态", tags: [] } }),
      getAssetData: async () => ""
    })
    expect(result.warnings).toEqual([])
    expect(text(document.querySelector("[data-testid='editor']"))).toBe(BODY)
    expect(selectedFiles).toEqual([])
    expect(publishClicks).toBe(0)
  })

  test("surfaces a platform upload failure", async () => {
    load("xiaoheihe")
    const input = document.querySelector<HTMLInputElement>("input[type='file']")!
    input.addEventListener("change", () => {
      const alert = document.createElement("div")
      alert.setAttribute("role", "alert")
      alert.textContent = "图片上传失败，请重试"
      input.parentElement!.appendChild(alert)
    })
    const fail = vi.fn()
    await expect(POST_CN_ADAPTERS["xiaoheihe-post"].prepareDraft({
      task: task("xiaoheihe-post", 1),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete: vi.fn(), fail }
    })).rejects.toThrow(/图片上传失败/)
    expect(fail).toHaveBeenCalledTimes(1)
    expect(publishClicks).toBe(0)
  })

  test("never resolves a final publish control as a composer action", () => {
    document.body.innerHTML = "<button>发布</button><button>发广播</button><div role='tablist'><div role='tab'>发布图文</div></div>"
    const [publish, broadcast] = Array.from(document.querySelectorAll("button"))
    expect(isFinalAction(publish!)).toBe(true)
    expect(isFinalAction(broadcast!)).toBe(true)
    expect(findAction(["发布", "发广播"])).toBeNull()
    expect(findAction(["发布图文"])?.getAttribute("role")).toBe("tab")
  })

  test("body and topic helpers", () => {
    expect(postBody("开头\n\n![图](wesight-asset://a)\n\n结尾")).toBe("开头\n\n结尾")
    expect(topicText(["#AI#", " ", "模型"], "hash-pair")).toBe("#AI# #模型#")
    expect(topicText(["AI"], "hash")).toBe("#AI")
    expect(topicText(["AI"], "none")).toBe("")
  })
})
