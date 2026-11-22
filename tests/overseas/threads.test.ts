import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { threadsPostAdapter } from "~platforms/overseas/threads"
import { DATA_URL, loadFixture, overseasTask, publishSpy, stubBrowserApis, wireFileInput, wireRichEditor } from "./helpers"

describe("threads post adapter", () => {
  let batches: File[][]
  let published: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stubBrowserApis()
    loadFixture("threads")
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!
    document.querySelector("main [role='button']")!.addEventListener("click", () => { dialog.hidden = false })
    wireRichEditor(dialog.querySelector<HTMLElement>("[contenteditable='true']")!)
    batches = wireFileInput(dialog.querySelector("input")!, dialog.querySelector(".attachments")!)
    published = publishSpy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("fills the dialog, keeps topics out of the text, selects images in order and never posts", async () => {
    const result = await threadsPostAdapter.prepareDraft({
      task: overseasTask({ id: "threads-post", body: "Thinking out loud", tags: ["AI"], images: 3 }),
      getAssetData: async () => DATA_URL
    })
    expect(document.querySelector("[role='dialog'] [contenteditable]")?.textContent).toBe("Thinking out loud")
    expect(batches.map(batch => batch.map(file => file.name))).toEqual([["image-1.png", "image-2.png", "image-3.png"]])
    expect(result.warnings).toEqual(["Threads 每条只能添加一个话题，已跳过标签，请在编辑页手动选择话题"])
    expect(published).not.toHaveBeenCalled()
  })

  test("enforces the 500 character limit", async () => {
    await expect(threadsPostAdapter.prepareDraft({
      task: overseasTask({ id: "threads-post", body: "x".repeat(501) }),
      getAssetData: async () => DATA_URL
    })).rejects.toThrow("最多 500 字")
  })

  test("reports the login page", async () => {
    history.replaceState({}, "", "/login")
    await expect(threadsPostAdapter.detectAccount()).resolves.toEqual({ loggedIn: false, message: "请先登录 Threads，登录完成后重试" })
  })
})
