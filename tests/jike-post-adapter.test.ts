import { readFileSync } from "fs"
import { resolve } from "path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { jikePostAdapter, jikePostFixtureHelpers } from "~platforms/jike-post"
import type { PublishTaskV1 } from "~types/protocol"

const fixture = readFileSync(resolve(process.cwd(), "tests", "fixtures", "jike-post.html"), "utf8")

class TestDataTransfer {
  files: File[] = []
  private data = new Map<string, string>()
  items = { add: (file: File) => this.files.push(file) }
  setData(type: string, value: string) {
    this.data.set(type, value)
  }
  getData(type: string) {
    return this.data.get(type) ?? ""
  }
}

class TestClipboardEvent extends Event {
  clipboardData: TestDataTransfer | null

  constructor(type: string, init: EventInit & { clipboardData?: TestDataTransfer } = {}) {
    super(type, init)
    this.clipboardData = init.clipboardData ?? null
  }
}

function task(count = 3): PublishTaskV1 {
  return {
    protocolVersion: 1,
    taskId: "jike-post-fixture",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    source: { vaultPath: "文章.md", contentHash: "a".repeat(64) },
    article: {
      title: "即刻动态",
      digest: "",
      markdown: "正文第一段\n\n正文第二段",
      html: "<p>正文第一段</p><p>正文第二段</p>",
      coverAssetId: count ? "asset-1" : null,
      tags: ["AI", "世界模型"]
    },
    targetOptions: { jikePost: { circle: "AI 探索站" } },
    assets: Array.from({ length: count }, (_, index) => ({
      id: `asset-${index + 1}`,
      fileName: `image-${index + 1}.png`,
      mimeType: "image/png",
      size: 3,
      sha256: String(index + 1).repeat(64).slice(0, 64)
    })),
    targets: ["jike-post"],
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

describe("jike post adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("DataTransfer", TestDataTransfer)
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent)
    document.documentElement.innerHTML = fixture
    history.replaceState({}, "", "/")
    const input = document.querySelector<HTMLInputElement>("input[type='file']")!
    Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
    input.addEventListener("change", () => {
      const list = document.querySelector<HTMLElement>(".image-list")!
      Array.from(input.files ?? []).forEach((file, index) => {
        const image = document.createElement("img")
        image.src = `https://jike.test/${index}-${file.name}`
        list.appendChild(image)
      })
    })
  })

  afterEach(() => {
    jikePostAdapter.dispose()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test("fills body without topics, uploads ordered images, selects circle, and never publishes", async () => {
    const complete = vi.fn()
    const circleOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='dialog'] button"))[0]!
    const circleClick = vi.fn()
    circleOption.addEventListener("click", circleClick)
    const publish = document.createElement("button")
    publish.textContent = "发布"
    const publishClick = vi.fn()
    publish.addEventListener("click", publishClick)
    document.body.appendChild(publish)

    const result = await jikePostAdapter.prepareDraft({
      task: task(),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete, fail: vi.fn() }
    })

    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value)
      .toBe("正文第一段\n\n正文第二段")
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).not.toContain("#AI")
    expect(Array.from(document.querySelector<HTMLInputElement>("input[type='file']")?.files ?? [])
      .map(file => file.name)).toEqual(["image-1.png", "image-2.png", "image-3.png"])
    expect(document.querySelectorAll(".image-list img")).toHaveLength(3)
    expect(complete).toHaveBeenCalledTimes(3)
    expect(circleClick).toHaveBeenCalledTimes(1)
    expect(result.warnings).toEqual([])
    expect(publishClick).not.toHaveBeenCalled()
  })

  test("supports text-only posts and reports a missing circle selector as a warning", async () => {
    document.querySelector(".circle-trigger")?.remove()
    const result = await jikePostAdapter.prepareDraft({
      task: task(0),
      getAssetData: async () => "data:image/png;base64,AQID"
    })
    expect(result.warnings[0]).toContain("请在即刻编辑页确认")
  })

  test("fills the modal rich-text editor when Jike renders duplicate editors", async () => {
    document.body.innerHTML = `
      <button type="button">创建动态</button>
      <div class="inline-editor" contenteditable="true" role="textbox"><p><br></p></div>
      <div role="dialog">
        <div class="modal-editor" contenteditable="true" data-lexical-editor="true" role="textbox"><p>旧内容</p></div>
      </div>
    `
    const modalEditor = document.querySelector<HTMLElement>(".modal-editor")!
    modalEditor.addEventListener("paste", event => {
      const clipboardEvent = event as TestClipboardEvent
      modalEditor.innerHTML = clipboardEvent.clipboardData?.getData("text/html") ?? ""
      event.preventDefault()
    })

    await jikePostAdapter.prepareDraft({
      task: task(0),
      getAssetData: async () => "data:image/png;base64,AQID"
    })

    expect(modalEditor.innerHTML).toBe("<p>正文第一段<br><br>正文第二段</p>")
    expect(modalEditor.querySelectorAll("p")).toHaveLength(1)
    expect(modalEditor.querySelectorAll("br")).toHaveLength(2)
    expect(modalEditor.textContent).not.toContain("#AI")
    expect(modalEditor.textContent).not.toContain("旧内容")
    expect(modalEditor.textContent?.match(/正文第一段/g)).toHaveLength(1)
    expect(document.querySelector(".inline-editor")?.textContent).toBe("")
    expect(jikePostFixtureHelpers.findComposerAction()?.textContent).toBe("创建动态")
  })

  test("preserves every source newline inside one Jike paragraph", () => {
    expect(jikePostFixtureHelpers.composerHtml("第一段\n\n第二段\n同段换行\n\n结尾"))
      .toBe("<p>第一段<br><br>第二段<br>同段换行<br><br>结尾</p>")
  })

  test("counts uploaded thumbnails inside Jike's hashed Dropzone classes", async () => {
    document.body.innerHTML = `
      <main>
        <textarea placeholder="分享此刻的想法"></textarea>
        <div class="_root_4nwi0_1 mantine-Dropzone-root" role="presentation">
          <input type="file" accept="image/*" multiple>
          <div class="_content_1kcvz_5"></div>
        </div>
      </main>
    `
    const input = document.querySelector<HTMLInputElement>("input[type='file']")!
    Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
    input.addEventListener("change", () => {
      const list = document.querySelector<HTMLElement>("._content_1kcvz_5")!
      Array.from(input.files ?? []).forEach((file, index) => {
        const image = document.createElement("img")
        image.className = "_image_1thm6_1"
        image.src = `https://jike.test/${index}-${file.name}`
        image.style.width = "80px"
        image.style.height = "80px"
        list.appendChild(image)
      })
    })
    const complete = vi.fn()

    await jikePostAdapter.prepareDraft({
      task: task(4),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete, fail: vi.fn() }
    })

    expect(jikePostFixtureHelpers.previewCount(jikePostFixtureHelpers.findUploadRoot(input))).toBe(4)
    expect(complete).toHaveBeenCalledTimes(4)
  })

  test("finishes progress when a retried task already has all image previews", async () => {
    document.body.innerHTML = `
      <main>
        <textarea placeholder="分享此刻的想法"></textarea>
        <div class="_root_4nwi0_1 mantine-Dropzone-root" role="presentation">
          <input type="file" accept="image/*" multiple>
          <img class="mantine-Avatar-image" src="https://jike.test/avatar" style="width:40px;height:40px">
          <img class="sponsor-icon" src="https://jike.test/sponsor" style="width:14px;height:14px">
          <div class="_content_1kcvz_5">
            ${Array.from({ length: 4 }, (_, index) => (
              `<img class="_image_1thm6_1" src="https://jike.test/upload-${index}" style="width:80px;height:80px">`
            )).join("")}
          </div>
        </div>
      </main>
    `
    const input = document.querySelector<HTMLInputElement>("input[type='file']")!
    Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
    const complete = vi.fn()

    await jikePostAdapter.prepareDraft({
      task: task(4),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete, fail: vi.fn() }
    })

    expect(jikePostFixtureHelpers.previewCount(jikePostFixtureHelpers.findUploadRoot(input))).toBe(4)
    expect(complete).toHaveBeenCalledTimes(4)
  })

  test("reports the QR login page", async () => {
    history.replaceState({}, "", "/login")
    document.body.innerHTML = "<main>可使用即刻 App 扫码</main>"
    await expect(jikePostAdapter.detectAccount()).resolves.toEqual({
      loggedIn: false,
      message: "请先登录即刻，登录完成后重试"
    })
  })
})
