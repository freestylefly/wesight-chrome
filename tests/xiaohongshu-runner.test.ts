import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { runXiaohongshuPageTask } from "~platforms/xiaohongshu-runner"
import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"

const fixture = readFileSync(resolve(process.cwd(), "tests", "fixtures", "xiaohongshu.html"), "utf8")

class TestDataTransfer {
  files: File[] = []
  private readonly values = new Map<string, string>()
  items = { add: (file: File) => this.files.push(file) }
  setData(type: string, value: string) { this.values.set(type, value) }
  getData(type: string) { return this.values.get(type) ?? "" }
}

class TestClipboardEvent extends Event {
  readonly clipboardData: TestDataTransfer

  constructor(type: string, options: EventInit & { clipboardData: TestDataTransfer }) {
    super(type, options)
    this.clipboardData = options.clipboardData
  }
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
    taskId: "xiaohongshu-one-shot",
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

describe("xiaohongshu one-shot runner", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ""
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test("uploads once without a persistent page overlay or an extra input event", async () => {
    document.body.innerHTML = fixture
    const tab = document.querySelector<HTMLElement>(".creator-tab")!
    vi.spyOn(tab, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 20, width: 96, height: 40, top: 20, right: 196, bottom: 60, left: 100,
      toJSON: () => undefined
    })
    const input = document.querySelector<HTMLInputElement>("input[type='file']")!
    Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
    const change = vi.fn(() => {
      const preview = document.querySelector<HTMLElement>(".img-preview-area")!
      for (let index = 0; index < 3; index += 1) {
        const item = document.createElement("div")
        item.className = "img-container"
        item.appendChild(document.createElement("img"))
        preview.appendChild(item)
      }
    })
    const inputEvent = vi.fn()
    input.addEventListener("change", change)
    input.addEventListener("input", inputEvent)

    const editor = document.querySelector<HTMLElement>(".ql-editor")!
    editor.addEventListener("paste", event => {
      const clipboardData = (event as unknown as TestClipboardEvent).clipboardData
      editor.textContent = clipboardData.getData("text/plain")
    })

    const messages: unknown[] = []
    const sendMessage = vi.fn(async (message: { type: string }) => {
      messages.push(message)
      if (message.type === "GET_ASSET_DATA") {
        return { ok: true, value: "data:image/png;base64,AQID" }
      }
      return { ok: true, value: true }
    })
    vi.stubGlobal("DataTransfer", TestDataTransfer)
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent)
    vi.stubGlobal("chrome", { runtime: { sendMessage } })

    const resultPromise = runXiaohongshuPageTask(makeTask())
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result).toMatchObject({ kind: "ready" })
    expect(change).toHaveBeenCalledTimes(1)
    expect(inputEvent).not.toHaveBeenCalled()
    expect(Array.from(input.files ?? []).map(file => file.name)).toEqual([
      "小红书-1.png",
      "小红书-2.png",
      "小红书-3.png"
    ])
    expect(document.querySelector<HTMLInputElement>("input.d-text")?.value).toHaveLength(20)
    expect(editor.textContent).toContain("正文第一段")
    expect(editor.textContent).toContain("#AI工具 #效率")
    expect(editor.textContent).not.toContain("#AI工具#")
    expect(editor.textContent).not.toContain("#效率#")
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "XIAOHONGSHU_UPLOAD_PROGRESS", completed: 0, total: 3 }),
      expect.objectContaining({ type: "XIAOHONGSHU_UPLOAD_PROGRESS", completed: 3, total: 3 })
    ]))
    expect(document.querySelector("#wesight-publish-upload-progress")).toBeNull()
    expect(document.querySelector("#wesight-publish-ready-banner")).toBeNull()
  })

  test("returns a login-required result without registering a page listener", async () => {
    document.body.innerHTML = "<main>扫码登录后创作</main>"
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn() } })

    await expect(runXiaohongshuPageTask(makeTask(1))).resolves.toEqual({
      kind: "login_required",
      message: "请先登录小红书创作服务平台"
    })
    expect(runXiaohongshuPageTask.toString()).not.toContain("onMessage.addListener")
  })
})
