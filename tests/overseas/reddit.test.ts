import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { redditPostAdapter } from "~platforms/overseas/reddit"
import { DATA_URL, loadFixture, overseasTask, publishSpy, stubBrowserApis, wireFileInput, wireRichEditor } from "./helpers"

describe("reddit post adapter", () => {
  let batches: File[][] = []
  let published: ReturnType<typeof vi.fn>
  let title: HTMLTextAreaElement

  beforeEach(() => {
    stubBrowserApis()
    loadFixture("reddit", "/submit")
    const host = document.querySelector("faceplate-textarea-input")!
    host.attachShadow({ mode: "open" }).innerHTML = "<textarea maxlength='300'></textarea>"
    title = host.shadowRoot!.querySelector("textarea")!
    const panel = document.querySelector<HTMLElement>(".image-panel")!
    document.querySelector(".images-tab")!.addEventListener("click", () => {
      panel.hidden = false
      const root = panel.attachShadow({ mode: "open" })
      root.innerHTML = "<input type='file' accept='image/png,image/jpeg,image/gif' multiple>"
      batches = wireFileInput(root.querySelector("input")!, document.body)
    })
    wireRichEditor(document.querySelector<HTMLElement>("shreddit-composer [contenteditable]")!)
    published = publishSpy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("fills title and body, switches to images, warns about the community and never posts", async () => {
    const result = await redditPostAdapter.prepareDraft({
      task: overseasTask({ id: "reddit-post", title: "My first post", body: "Body text", tags: ["meta"], images: 2 }),
      getAssetData: async () => DATA_URL
    })
    expect(title.value).toBe("My first post")
    expect(document.querySelector("shreddit-composer [contenteditable]")?.textContent).toBe("Body text")
    expect(batches.map(batch => batch.map(file => file.name))).toEqual([["image-1.png", "image-2.png"]])
    expect(result.warnings).toEqual([
      "请在 Reddit 编辑页手动选择要发布到的社区（Community），发布助手不会替你选择",
      "Reddit 不使用话题标签，已跳过标签；如社区要求 Flair，请手动选择"
    ])
    expect(published).not.toHaveBeenCalled()
    expect(document.querySelector(".community-picker button")?.textContent).toBe("Select a community")
  })

  test("uses the first body line as title when the draft has none, and skips the community warning on /r/x/submit", async () => {
    history.replaceState({}, "", "/r/test/submit")
    const result = await redditPostAdapter.prepareDraft({
      task: overseasTask({ id: "reddit-post", body: "Headline line\n\nMore text" }),
      getAssetData: async () => DATA_URL
    })
    expect(title.value).toBe("Headline line")
    expect(result.warnings).toEqual(["未填写标题，已使用正文首行作为 Reddit 标题，请检查"])
  })

  test("reports the login page", async () => {
    history.replaceState({}, "", "/login/")
    document.body.innerHTML = "<main><button>Log In</button></main>"
    await expect(redditPostAdapter.detectAccount()).resolves.toEqual({ loggedIn: false, message: "请先登录 Reddit，登录完成后重试" })
  })
})
