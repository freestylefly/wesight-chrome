import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { facebookPostAdapter } from "~platforms/overseas/facebook"
import { DATA_URL, loadFixture, overseasTask, publishSpy, stubBrowserApis, wireFileInput, wireRichEditor } from "./helpers"

describe("facebook post adapter", () => {
  let batches: File[][]
  let published: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stubBrowserApis()
    loadFixture("facebook")
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!
    document.querySelector("main [role='button']")!.addEventListener("click", () => { dialog.hidden = false })
    dialog.querySelector("[aria-label='Photo/video']")!.addEventListener("click", () => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "image/*,image/heif,image/heic,video/*"
      input.multiple = true
      dialog.appendChild(input)
      batches = wireFileInput(input, dialog.querySelector(".attachments")!)
    })
    wireRichEditor(dialog.querySelector<HTMLElement>("[contenteditable='true']")!)
    wireRichEditor(document.querySelector<HTMLElement>("main [contenteditable='true']")!)
    published = publishSpy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("opens Create post, fills only the dialog editor, reveals the photo input and never posts", async () => {
    const result = await facebookPostAdapter.prepareDraft({
      task: overseasTask({ id: "facebook-post", body: "Weekend notes", tags: ["travel"], images: 2 }),
      getAssetData: async () => DATA_URL
    })
    expect(document.querySelector("[role='dialog'] [contenteditable]")?.textContent).toBe("Weekend notes\n\n#travel")
    expect(document.querySelector("main [contenteditable]")?.textContent).toBe("")
    expect(batches.map(batch => batch.map(file => file.name))).toEqual([["image-1.png", "image-2.png"]])
    expect(result.warnings).toEqual([])
    expect(published).not.toHaveBeenCalled()
  })

  test("warns about a skipped video", async () => {
    const task = overseasTask({ id: "facebook-post" })
    task.assets = [{ id: "v", fileName: "clip.mp4", mimeType: "video/mp4", size: 3, sha256: "v".repeat(64) }]
    task.media = { videoAssetId: "v" }
    const result = await facebookPostAdapter.prepareDraft({ task, getAssetData: async () => DATA_URL })
    expect(result.warnings).toEqual(["Facebook 暂不支持自动同步视频，已跳过视频，请在编辑页手动添加"])
  })

  test("reports the login form", async () => {
    history.replaceState({}, "", "/")
    document.body.innerHTML = "<form action='/login/device-based/regular/login/'><input name='email'><input type='password' name='pass'></form>"
    await expect(facebookPostAdapter.detectAccount()).resolves.toEqual({ loggedIn: false, message: "请先登录 Facebook，登录完成后重试" })
  })
})
