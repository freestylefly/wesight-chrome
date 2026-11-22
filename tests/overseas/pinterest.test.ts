import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { pinterestPostAdapter } from "~platforms/overseas/pinterest"
import { DATA_URL, loadFixture, overseasTask, publishSpy, stubBrowserApis, wireFileInput, wireRichEditor } from "./helpers"

describe("pinterest pin adapter", () => {
  let batches: File[][]
  let published: ReturnType<typeof vi.fn>
  let boardClick: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stubBrowserApis()
    loadFixture("pinterest", "/pin-creation-tool/")
    const input = document.querySelector<HTMLInputElement>("#storyboard-upload-input")!
    batches = wireFileInput(input, document.querySelector(".upload-preview")!)
    input.addEventListener("change", () => { document.querySelector<HTMLInputElement>("#storyboard-selector-title")!.disabled = false })
    wireRichEditor(document.querySelector<HTMLElement>("[aria-label='Add a detailed description']")!)
    boardClick = vi.fn()
    Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Choose a board")!.addEventListener("click", boardClick)
    published = publishSpy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("uploads the first image, fills title and description, leaves the board and never publishes", async () => {
    const skip = vi.fn()
    const result = await pinterestPostAdapter.prepareDraft({
      task: overseasTask({ id: "pinterest-post", title: "Cozy desk setup", body: "Ideas for a calm workspace", tags: ["desk"], images: 2 }),
      getAssetData: async () => DATA_URL,
      uploadProgress: { complete: vi.fn(), skip, fail: vi.fn() }
    })
    expect(batches.map(batch => batch.map(file => file.name))).toEqual([["image-1.png"]])
    expect(document.querySelector<HTMLInputElement>("#storyboard-selector-title")?.value).toBe("Cozy desk setup")
    expect(document.querySelector("[aria-label='Add a detailed description']")?.textContent).toBe("Ideas for a calm workspace")
    expect(skip).toHaveBeenCalledTimes(1)
    expect(result.warnings).toEqual([
      "Pinterest 每个 Pin 只能使用一张图片，已使用第一张，跳过其余 1 张",
      "Pinterest 不再使用话题标签，已跳过标签",
      "请在 Pinterest 编辑页手动选择要保存到的画板（Board）"
    ])
    expect(boardClick).not.toHaveBeenCalled()
    expect(published).not.toHaveBeenCalled()
  })

  test("requires an image", async () => {
    await expect(pinterestPostAdapter.prepareDraft({
      task: overseasTask({ id: "pinterest-post" }),
      getAssetData: async () => DATA_URL
    })).rejects.toThrow("Pinterest 需要一张图片")
  })

  test("reports the login page", async () => {
    history.replaceState({}, "", "/login/")
    document.body.innerHTML = "<main><button>Log in</button></main>"
    await expect(pinterestPostAdapter.detectAccount()).resolves.toEqual({ loggedIn: false, message: "请先登录 Pinterest，登录完成后重试" })
  })
})
