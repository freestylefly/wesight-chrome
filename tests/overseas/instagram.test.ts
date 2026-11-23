import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { instagramPostAdapter } from "~platforms/overseas/instagram"
import { DATA_URL, loadFixture, overseasTask, publishSpy, stubBrowserApis, wireFileInput, wireRichEditor } from "./helpers"

describe("instagram post adapter", () => {
  let batches: File[][]
  let shared: ReturnType<typeof vi.fn>
  let nextClicks: number

  beforeEach(() => {
    stubBrowserApis()
    loadFixture("instagram")
    nextClicks = 0
    const menu = document.querySelector<HTMLElement>(".create-menu")!
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!
    document.querySelector("nav > a")!.addEventListener("click", () => { menu.hidden = false })
    menu.querySelector("a")!.addEventListener("click", () => { dialog.hidden = false })
    const input = dialog.querySelector<HTMLInputElement>("input")!
    batches = wireFileInput(input, dialog.querySelector(".previews")!)
    const actions = dialog.querySelector<HTMLElement>(".step-actions")!
    input.addEventListener("change", () => {
      dialog.querySelector(".step-title")!.textContent = "Crop"
      actions.innerHTML = "<div role='button' tabindex='0'>Next</div>"
    })
    actions.addEventListener("click", () => {
      nextClicks += 1
      if (nextClicks === 1) {
        dialog.querySelector(".step-title")!.textContent = "Edit"
        return
      }
      dialog.querySelector(".step-title")!.textContent = "Create new post"
      actions.innerHTML = "<div role='button' tabindex='0'>Share</div>"
      dialog.querySelector<HTMLElement>(".caption-step")!.hidden = false
    })
    wireRichEditor(dialog.querySelector<HTMLElement>("[aria-label='Write a caption...']")!)
    shared = publishSpy(/^share$/i)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("opens Create → Post, selects images in order, reaches the caption and stops before Share", async () => {
    const result = await instagramPostAdapter.prepareDraft({
      task: overseasTask({ id: "instagram-post", body: "Golden hour", tags: ["sunset", "photo"], images: 3 }),
      getAssetData: async () => DATA_URL
    })
    expect(batches.map(batch => batch.map(file => file.name))).toEqual([["image-1.png", "image-2.png", "image-3.png"]])
    expect(nextClicks).toBe(2)
    expect(document.querySelector("[aria-label='Write a caption...']")?.textContent).toBe("Golden hour\n\n#sunset #photo")
    expect(result.warnings).toEqual([])
    expect(shared).not.toHaveBeenCalled()
  })

  test("requires at least one image", async () => {
    await expect(instagramPostAdapter.prepareDraft({
      task: overseasTask({ id: "instagram-post" }),
      getAssetData: async () => DATA_URL
    })).rejects.toThrow("至少需要一张图片")
  })

  test("reports the login page", async () => {
    history.replaceState({}, "", "/accounts/login/")
    await expect(instagramPostAdapter.detectAccount()).resolves.toEqual({ loggedIn: false, message: "请先登录 Instagram，登录完成后重试" })
  })
})
