import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { linkedinPostAdapter } from "~platforms/overseas/linkedin"
import { DATA_URL, loadFixture, overseasTask, publishSpy, stubBrowserApis, wireFileInput, wireRichEditor } from "./helpers"

describe("linkedin post adapter", () => {
  let batches: File[][]
  let published: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stubBrowserApis()
    loadFixture("linkedin", "/feed/")
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!
    const mediaEditor = document.querySelector<HTMLElement>(".media-editor")!
    document.querySelector(".share-box-feed-entry__trigger")!.addEventListener("click", () => { dialog.hidden = false })
    dialog.querySelector("[aria-label='Add media']")!.addEventListener("click", () => { mediaEditor.hidden = false })
    wireRichEditor(dialog.querySelector<HTMLElement>(".ql-editor")!)
    batches = wireFileInput(mediaEditor.querySelector("input")!, dialog.querySelector(".media-previews")!)
    published = publishSpy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("opens the share box, fills text and hashtags, selects images in order and never posts", async () => {
    const result = await linkedinPostAdapter.prepareDraft({
      task: overseasTask({ id: "linkedin-post", body: "Shipping update", tags: ["#buildinpublic"], images: 2 }),
      getAssetData: async () => DATA_URL
    })
    expect(document.querySelector(".ql-editor")?.textContent).toBe("Shipping update\n\n#buildinpublic")
    expect(batches.map(batch => batch.map(file => file.name))).toEqual([["image-1.png", "image-2.png"]])
    expect(result.warnings).toEqual(["LinkedIn 可能先显示图片编辑窗口，请在其中确认图片后返回发帖框，再手动发布"])
    expect(published).not.toHaveBeenCalled()
  })

  test("reads the member name and reports the auth wall", async () => {
    await expect(linkedinPostAdapter.detectAccount()).resolves.toEqual({ loggedIn: true, name: "Ada Lovelace" })
    history.replaceState({}, "", "/authwall")
    document.body.innerHTML = "<main><a href='/login'>Sign in</a><a href='/signup'>Join now</a></main>"
    await expect(linkedinPostAdapter.detectAccount()).resolves.toMatchObject({ loggedIn: false })
  })

  test("rejects posts over 3000 characters", async () => {
    await expect(linkedinPostAdapter.prepareDraft({
      task: overseasTask({ id: "linkedin-post", body: "x".repeat(3001) }),
      getAssetData: async () => DATA_URL
    })).rejects.toThrow("最多 3000 字")
  })
})
