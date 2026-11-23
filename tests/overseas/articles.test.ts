import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { platformFromUrl } from "~platforms/config"
import { mediumArticleAdapter } from "~platforms/overseas/medium"
import { publicationEditorUrl, substackArticleAdapter } from "~platforms/overseas/substack-article"
import { DATA_URL, loadFixture, overseasTask, publishSpy, stubBrowserApis, wireRichEditor } from "./helpers"

const ARTICLE_HTML = "<h2>Intro</h2><p>First paragraph</p><p><img src=\"wesight-asset://asset-1\" alt=\"chart\"></p><p>Closing</p>"

describe("medium article adapter", () => {
  let published: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stubBrowserApis()
    loadFixture("medium", "/new-story")
    wireRichEditor(document.querySelector<HTMLElement>(".postArticle-content")!)
    published = publishSpy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("fills title and body through paste, reports skipped images and tags, never publishes", async () => {
    const skip = vi.fn()
    const result = await mediumArticleAdapter.prepareDraft({
      task: overseasTask({ id: "medium-article", title: "Notes on tooling", html: ARTICLE_HTML, body: "Intro", tags: ["dev"], images: 1 }),
      getAssetData: async () => DATA_URL,
      uploadProgress: { complete: vi.fn(), skip, fail: vi.fn() }
    })
    expect(document.querySelector("[data-testid='editorTitleParagraph']")?.textContent).toBe("Notes on tooling")
    expect(document.querySelector("[data-testid='editorParagraphText']")?.textContent).toBe("Intro\nFirst paragraph\nClosing")
    expect(skip).toHaveBeenCalledTimes(1)
    expect(result.warnings).toEqual([
      "Medium 正文中的 1 张图片未自动上传，请在对应位置手动插入",
      "Medium 的话题标签在发布窗口中设置，请手动添加（最多 5 个）"
    ])
    expect(published).not.toHaveBeenCalled()
  })

  test("reports the sign-in redirect", async () => {
    history.replaceState({}, "", "/m/signin?redirect=%2Fnew-story")
    await expect(mediumArticleAdapter.detectAccount()).resolves.toEqual({ loggedIn: false, message: "请先登录 Medium，登录完成后重试" })
  })
})

describe("substack article adapter", () => {
  let published: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stubBrowserApis()
    loadFixture("substack-article", "/publish/post?type=newsletter")
    wireRichEditor(document.querySelector<HTMLElement>(".ProseMirror")!)
    published = publishSpy(/^(?:continue|publish|send)$/i)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("fills title, subtitle and body on the publication editor and never continues to publish", async () => {
    const result = await substackArticleAdapter.prepareDraft({
      task: overseasTask({ id: "substack-article", title: "Issue #1", digest: "What changed", html: ARTICLE_HTML, body: "Intro", images: 1 }),
      getAssetData: async () => DATA_URL
    })
    expect(document.querySelector<HTMLTextAreaElement>("#post-title")?.value).toBe("Issue #1")
    expect(document.querySelector<HTMLTextAreaElement>("#post-subtitle")?.value).toBe("What changed")
    expect(document.querySelector(".ProseMirror")?.textContent).toBe("Intro\nFirst paragraph\nClosing")
    expect(result.warnings).toEqual(["Substack 正文中的 1 张图片未自动上传，请在对应位置手动插入"])
    expect(published).not.toHaveBeenCalled()
  })

  test("on substack.com finds the publication editor and explains the subdomain limit", async () => {
    history.replaceState({}, "", "/settings")
    document.body.innerHTML = "<nav><button>Create</button><a href='https://ada.substack.com/publish/home'>Dashboard</a></nav>"
    expect(publicationEditorUrl()).toBe("https://ada.substack.com/publish/post?type=newsletter")
    await expect(substackArticleAdapter.prepareDraft({
      task: overseasTask({ id: "substack-article", title: "Issue #1" }),
      getAssetData: async () => DATA_URL
    })).rejects.toThrow("ada.substack.com")
  })

  test("reports the sign-in page", async () => {
    history.replaceState({}, "", "/sign-in")
    document.body.innerHTML = "<main><button>Sign in</button></main>"
    await expect(substackArticleAdapter.detectAccount()).resolves.toEqual({ loggedIn: false, message: "请先登录 Substack，登录完成后重试" })
  })
})

describe("substack.com routing", () => {
  test("keeps Notes and articles on one account and routes each page to its own id", () => {
    expect(platformFromUrl("https://substack.com/home")).toBe("substack-post")
    expect(platformFromUrl("https://substack.com/settings")).toBe("substack-article")
    expect(platformFromUrl("https://substack.com/")).toBe("substack-post")
    expect(platformFromUrl("https://medium.com/new-story")).toBe("medium-article")
  })
})
