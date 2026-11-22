import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { bskyPostAdapter } from "~platforms/overseas/bsky"
import { DATA_URL, fileNames, loadFixture, overseasTask, publishSpy, stubBrowserApis, wireRichEditor } from "./helpers"

describe("bluesky post adapter", () => {
  let pasted: File[]
  let published: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stubBrowserApis()
    loadFixture("bsky")
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!
    document.querySelector("nav button")!.addEventListener("click", () => { dialog.hidden = false })
    pasted = wireRichEditor(document.querySelector<HTMLElement>(".ProseMirror")!, dialog.querySelector(".gallery")!)
    published = publishSpy(/^(?:post|publish post)$/i)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("opens the composer, fills text with hashtags, pastes images in order and never posts", async () => {
    const complete = vi.fn()
    const result = await bskyPostAdapter.prepareDraft({
      task: overseasTask({ id: "bsky-post", body: "Hello Bluesky\n\nSecond line", tags: ["AI", "open web"], images: 3 }),
      getAssetData: async () => DATA_URL,
      uploadProgress: { complete, fail: vi.fn() }
    })
    expect(document.querySelector(".ProseMirror")?.textContent).toBe("Hello Bluesky\n\nSecond line\n\n#AI #openweb")
    expect(fileNames(pasted)).toEqual(["image-1.png", "image-2.png", "image-3.png"])
    expect(complete).toHaveBeenCalledTimes(3)
    expect(result.warnings).toEqual([])
    expect(published).not.toHaveBeenCalled()
  })

  test("skips images beyond four with a warning", async () => {
    const result = await bskyPostAdapter.prepareDraft({
      task: overseasTask({ id: "bsky-post", images: 5 }),
      getAssetData: async () => DATA_URL
    })
    expect(fileNames(pasted)).toEqual(["image-1.png", "image-2.png", "image-3.png", "image-4.png"])
    expect(result.warnings).toEqual(["Bluesky 最多 4 张图片，已跳过后 1 张"])
    expect(published).not.toHaveBeenCalled()
  })

  test("rejects text over 300 graphemes but counts emoji as one", async () => {
    await expect(bskyPostAdapter.prepareDraft({
      task: overseasTask({ id: "bsky-post", body: "a".repeat(301) }),
      getAssetData: async () => DATA_URL
    })).rejects.toThrow("最多 300 字")
    await expect(bskyPostAdapter.prepareDraft({
      task: overseasTask({ id: "bsky-post", body: "👩‍💻".repeat(300) }),
      getAssetData: async () => DATA_URL
    })).resolves.toMatchObject({ warnings: [] })
  })

  test("reports the signed-out landing page", async () => {
    document.body.innerHTML = "<main><button>Sign in</button><button>Create account</button></main>"
    await expect(bskyPostAdapter.detectAccount()).resolves.toEqual({ loggedIn: false, message: "请先登录 Bluesky，登录完成后重试" })
    await expect(bskyPostAdapter.prepareDraft({ task: overseasTask({ id: "bsky-post" }), getAssetData: async () => DATA_URL }))
      .rejects.toThrow("请先登录 Bluesky")
  })
})
