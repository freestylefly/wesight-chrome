import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { substackPostAdapter } from "~platforms/overseas/substack-post"
import { DATA_URL, loadFixture, overseasTask, publishSpy, stubBrowserApis, wireFileInput, wireRichEditor } from "./helpers"

describe("substack notes adapter", () => {
  let batches: File[][]
  let published: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stubBrowserApis()
    loadFixture("substack-post", "/home")
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!
    document.querySelector("main [role='button']")!.addEventListener("click", () => { dialog.hidden = false })
    wireRichEditor(dialog.querySelector<HTMLElement>(".ProseMirror")!)
    batches = wireFileInput(dialog.querySelector("input")!, dialog.querySelector(".note-images")!)
    published = publishSpy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("writes a note with images in order, skips tags and never posts", async () => {
    const result = await substackPostAdapter.prepareDraft({
      task: overseasTask({ id: "substack-post", body: "A short note", tags: ["writing"], images: 2 }),
      getAssetData: async () => DATA_URL
    })
    expect(document.querySelector(".ProseMirror")?.textContent).toBe("A short note")
    expect(batches.map(batch => batch.map(file => file.name))).toEqual([["image-1.png", "image-2.png"]])
    expect(result.warnings).toEqual(["Substack Notes 不使用话题标签，已跳过标签"])
    expect(published).not.toHaveBeenCalled()
  })

  test("reports the sign-in page", async () => {
    history.replaceState({}, "", "/sign-in")
    document.body.innerHTML = "<main><button>Sign in</button></main>"
    await expect(substackPostAdapter.detectAccount()).resolves.toEqual({ loggedIn: false, message: "请先登录 Substack，登录完成后重试" })
  })
})
