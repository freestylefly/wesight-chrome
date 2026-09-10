import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { xiaohongshuAdapter } from "~platforms/xiaohongshu"
import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"

const fixture = readFileSync(resolve(process.cwd(), "tests", "fixtures", "xiaohongshu.html"), "utf8")

class TestDataTransfer {
  files: File[] = []
  private readonly values = new Map<string, string>()
  items = { add: (file: File) => this.files.push(file) }
  setData(type: string, value: string) { this.values.set(type, value) }
  getData(type: string) { return this.values.get(type) ?? "" }
}

function makeTask(count = 3): PublishTaskV1 {
  const assets = Array.from({ length: count }, (_, index): PublishAssetV1 => ({
    id: String(index + 1).repeat(64),
    fileName: `小红书-${index + 1}.png`,
    mimeType: "image/png",
    size: 3,
    sha256: String(index + 1).repeat(64)
  }))
  const createdAt = Date.now()
  return {
    protocolVersion: 1,
    taskId: "xiaohongshu-fixture",
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + 600_000).toISOString(),
    source: { vaultPath: "文章.md", contentHash: "a".repeat(64) },
    article: {
      title: "这是一个超过二十个字符的小红书标题需要被安全截断",
      digest: "摘要",
      markdown: "正文第一段。\n\n正文第二段。",
      html: "<p>正文第一段。</p><p>正文第二段。</p>",
      coverAssetId: assets[0]?.id ?? null,
      tags: ["AI工具", "#效率#"]
    },
    assets,
    targets: ["xiaohongshu"],
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

function prepareUploadFixture(uploadedCount: number, failureText = ""): HTMLInputElement {
  document.body.innerHTML = fixture
  const tab = document.querySelector<HTMLElement>(".creator-tab")!
  vi.spyOn(tab, "getBoundingClientRect").mockReturnValue({
    x: 100, y: 20, width: 96, height: 40, top: 20, right: 196, bottom: 60, left: 100,
    toJSON: () => undefined
  })
  const input = document.querySelector<HTMLInputElement>("input[type='file']")!
  Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
  input.addEventListener("change", () => {
    const preview = document.querySelector<HTMLElement>(".img-preview-area")!
    for (let index = 0; index < uploadedCount; index += 1) {
      const item = document.createElement("div")
      item.className = "img-container"
      const image = document.createElement("img")
      image.src = `https://ci.xiaohongshu.com/fixture-${index + 1}.png`
      item.appendChild(image)
      preview.appendChild(item)
    }
    if (failureText) preview.append(failureText)
  })
  return input
}

function installImageUploadInput(uploadedCount: number): HTMLInputElement {
  const oldInput = document.querySelector<HTMLInputElement>("input[type='file']")
  oldInput?.remove()
  const input = document.createElement("input")
  input.className = "upload-input"
  input.type = "file"
  input.multiple = true
  input.accept = ".jpg,.jpeg,.png,.webp"
  Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
  input.addEventListener("change", () => {
    const preview = document.createElement("div")
    preview.className = "img-preview-area"
    for (let index = 0; index < uploadedCount; index += 1) {
      const item = document.createElement("div")
      item.className = "img-container"
      item.appendChild(document.createElement("img"))
      preview.appendChild(item)
    }
    document.body.appendChild(preview)
  })
  document.body.appendChild(input)
  return input
}

describe("xiaohongshu adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("DataTransfer", TestDataTransfer)
  })

  afterEach(() => {
    xiaohongshuAdapter.dispose()
    document.body.innerHTML = ""
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test.each([1, 3, 6])("uploads %i ordered images and fills title, body, and tags", async count => {
    const input = prepareUploadFixture(count)
    const inputEvent = vi.fn()
    input.addEventListener("input", inputEvent)
    const complete = vi.fn()
    const result = await xiaohongshuAdapter.prepareDraft({
      task: makeTask(count),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete, fail: vi.fn() }
    })

    expect(Array.from(input.files ?? []).map(file => file.name)).toEqual(
      Array.from({ length: count }, (_, index) => `小红书-${index + 1}.png`)
    )
    expect(complete).toHaveBeenCalledTimes(count)
    expect(inputEvent).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>("input.d-text")?.value).toHaveLength(20)
    expect(document.querySelector<HTMLElement>(".ql-editor")?.textContent).toContain("正文第一段")
    expect(document.querySelector<HTMLElement>(".ql-editor")?.textContent).toContain("#AI工具 #效率")
    expect(document.querySelector<HTMLElement>(".ql-editor")?.textContent).not.toContain("#AI工具#")
    expect(document.querySelector<HTMLElement>(".ql-editor")?.textContent).not.toContain("#效率#")
    expect(result.warnings.join(" ")).toContain("标题超过小红书上限")
    expect(result.draftUrl).toContain("http://localhost")
  })

  test("reports platform upload failures and leaves publishing to the user", async () => {
    prepareUploadFixture(2, "第 3 张上传失败，请重新上传")
    const fail = vi.fn()
    await expect(xiaohongshuAdapter.prepareDraft({
      task: makeTask(3),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete: vi.fn(), fail }
    })).rejects.toThrow("小红书图片上传失败")
    expect(fail).toHaveBeenCalled()
    expect(document.querySelectorAll("button")).toHaveLength(1)
    expect(document.body.textContent).not.toContain("自动发布")
  })

  test("ignores offscreen duplicate tabs and switches from video to the real image uploader", async () => {
    document.body.innerHTML = `
      <nav>
        <div class="creator-tab" id="offscreen">上传图文</div>
        <div class="creator-tab" aria-hidden="true">上传图文</div>
        <div class="creator-tab" id="visible">上传图文</div>
      </nav>
      <input class="upload-input" type="file" accept=".mp4,.mov">
      <input class="d-text" type="text" placeholder="填写标题">
      <div class="ql-editor" contenteditable="true"></div>
    `
    const offscreen = document.querySelector<HTMLElement>("#offscreen")!
    const visible = document.querySelector<HTMLElement>("#visible")!
    vi.spyOn(offscreen, "getBoundingClientRect").mockReturnValue({
      x: -9999, y: -9999, width: 96, height: 40, top: -9999, right: -9903, bottom: -9959, left: -9999,
      toJSON: () => undefined
    })
    vi.spyOn(visible, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 20, width: 96, height: 40, top: 20, right: 196, bottom: 60, left: 100,
      toJSON: () => undefined
    })
    const clicked = vi.fn(() => {
      visible.classList.add("active")
      installImageUploadInput(1)
    })
    visible.addEventListener("click", clicked)

    await xiaohongshuAdapter.prepareDraft({
      task: makeTask(1),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete: vi.fn(), fail: vi.fn() }
    })

    expect(clicked).toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>("input.upload-input")?.multiple).toBe(true)
  })

  test("waits for the image upload tab when the creator page renders it asynchronously", async () => {
    document.body.innerHTML = `
      <input class="upload-input" type="file" accept=".mp4,.mov">
      <input class="d-text" type="text" placeholder="填写标题">
      <div class="ql-editor" contenteditable="true"></div>
    `
    const clicked = vi.fn()
    window.setTimeout(() => {
      const tab = document.createElement("div")
      tab.className = "creator-tab"
      tab.textContent = "上传图文"
      vi.spyOn(tab, "getBoundingClientRect").mockReturnValue({
        x: 100, y: 20, width: 96, height: 40, top: 20, right: 196, bottom: 60, left: 100,
        toJSON: () => undefined
      })
      tab.addEventListener("click", () => {
        clicked()
        tab.classList.add("active")
        installImageUploadInput(1)
      })
      document.body.prepend(tab)
    }, 350)

    await xiaohongshuAdapter.prepareDraft({
      task: makeTask(1),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete: vi.fn(), fail: vi.fn() }
    })

    expect(clicked).toHaveBeenCalledTimes(1)
    expect(document.querySelector<HTMLInputElement>("input.upload-input")?.multiple).toBe(true)
  })

  test("does not mistake the existing video file input for the delayed image input", async () => {
    document.body.innerHTML = `
      <div class="creator-tab" id="visible">上传图文</div>
      <section class="upload-wrapper">
        <input class="upload-input" type="file" accept=".mp4,.mov">
      </section>
      <input class="d-text" type="text" placeholder="填写标题">
      <div class="ql-editor" contenteditable="true"></div>
    `
    const tab = document.querySelector<HTMLElement>("#visible")!
    vi.spyOn(tab, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 20, width: 96, height: 40, top: 20, right: 196, bottom: 60, left: 100,
      toJSON: () => undefined
    })
    tab.addEventListener("click", () => {
      tab.classList.add("active")
      window.setTimeout(() => installImageUploadInput(1), 350)
    })

    await xiaohongshuAdapter.prepareDraft({
      task: makeTask(1),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete: vi.fn(), fail: vi.fn() }
    })

    expect(document.querySelector<HTMLInputElement>("input[type='file'][multiple]")?.accept).toContain(".png")
  })

  test("detects the creator login page", async () => {
    document.body.innerHTML = '<section class="login-container"><input type="password"><span>扫码登录</span></section>'
    await expect(xiaohongshuAdapter.detectAccount()).resolves.toEqual({
      loggedIn: false,
      message: "请先登录小红书创作服务平台"
    })
  })
})
