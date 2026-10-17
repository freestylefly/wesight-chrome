import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { toutiaoAdapter } from "~platforms/toutiao"
import { cropWeiboCover, resolveWeiboUid, weiboAdapter } from "~platforms/weibo"
import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"

const fixture = (name: string) => readFileSync(resolve(process.cwd(), "tests", "fixtures", `${name}.html`), "utf8")

function makeTask(count = 0, title = "这是一个包含中文标题、摘要、列表、引用和代码块的多平台测试文章"): PublishTaskV1 {
  const assets = Array.from({ length: count }, (_, index): PublishAssetV1 => ({
    id: String(index + 1).repeat(64),
    fileName: `正文图片-${index + 1}.png`,
    mimeType: "image/png",
    size: 3,
    sha256: String(index + 1).repeat(64)
  }))
  const createdAt = Date.now()
  return {
    protocolVersion: 1,
    taskId: "new-platform-fixture",
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + 600_000).toISOString(),
    source: { vaultPath: "验收文章.md", contentHash: "a".repeat(64) },
    article: {
      title,
      digest: "这是一段摘要",
      markdown: ["## 小标题", "", "> 引用", "", "- 列表", "", "```ts", "const ready = true", "```", ...assets.map(asset => `![图](wesight-asset://${asset.id})`)].join("\n"),
      html: `<h2>小标题</h2><blockquote>引用</blockquote><ul><li>列表</li></ul><pre><code>const ready = true</code></pre>${assets.map(asset => `<img src="wesight-asset://${asset.id}">`).join("")}`,
      coverAssetId: null,
      tags: ["AI"],
      original: true
    },
    assets,
    targets: ["toutiao", "weibo-article"],
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

class TestDataTransfer {
  files: File[] = []
  private readonly values = new Map<string, string>()
  items = { add: (file: File) => this.files.push(file) }
  setData(type: string, value: string) { this.values.set(type, value) }
  getData(type: string) { return this.values.get(type) ?? "" }
}

describe("new platform adapter fixtures", () => {
  const nativeFetch = globalThis.fetch

  beforeEach(() => {
    vi.stubGlobal("DataTransfer", TestDataTransfer)
  })

  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test("fills Toutiao, uploads the body image through its native control, and truncates to 30 characters", async () => {
    document.body.innerHTML = fixture("toutiao")
    document.querySelector<HTMLButtonElement>(".syl-toolbar-tool.image button")?.addEventListener("click", () => {
      const panel = document.createElement("div")
      panel.dataset.e2e = "image-upload"
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "image/*"
      Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
      input.addEventListener("change", () => {
        const image = document.createElement("img")
        image.src = "https://p3-sign.toutiaoimg.com/tos-cn-i-fixture.png"
        document.body.appendChild(image)
      })
      panel.appendChild(input)
      document.body.appendChild(panel)
    })
    const complete = vi.fn()
    const result = await toutiaoAdapter.prepareDraft({
      task: makeTask(1),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete, fail: vi.fn() }
    })

    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toHaveLength(30)
    expect(document.querySelector<HTMLElement>(".ProseMirror")?.innerHTML).toContain("https://p3-sign.toutiaoimg.com/")
    expect(complete).toHaveBeenCalledOnce()
    expect(result.warnings.join(" ")).toContain("分类、声明和发布选项")
  })

  test("closes the Toutiao body image drawer before uploading and confirming the cover", async () => {
    document.body.innerHTML = fixture("toutiao")
    const task = makeTask(2)
    const [bodyAsset, coverAsset] = task.assets
    task.article.html = `<p>正文</p><img src="wesight-asset://${bodyAsset!.id}">`
    task.article.markdown = `正文\n\n![正文图](wesight-asset://${bodyAsset!.id})`
    task.article.coverAssetId = coverAsset!.id

    const bodyDrawer = document.createElement("div")
    bodyDrawer.className = "byte-drawer"
    Object.defineProperty(bodyDrawer, "getBoundingClientRect", {
      value: () => ({ width: 960 })
    })
    const closeBody = document.createElement("button")
    closeBody.className = "byte-drawer-close-icon"
    closeBody.addEventListener("click", () => bodyDrawer.remove())
    bodyDrawer.append("上传图片", closeBody)
    document.body.appendChild(bodyDrawer)

    document.querySelector<HTMLButtonElement>(".syl-toolbar-tool.image button")?.addEventListener("click", () => {
      const panel = document.createElement("div")
      panel.dataset.e2e = "image-upload"
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "image/*"
      Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
      input.addEventListener("change", () => {
        const image = document.createElement("img")
        image.src = "https://p3-sign.toutiaoimg.com/body.png"
        document.body.appendChild(image)
      })
      panel.appendChild(input)
      bodyDrawer.appendChild(panel)
    })

    let coverConfirmed = false
    const coverAdd = document.createElement("button")
    coverAdd.className = "article-cover-add"
    coverAdd.addEventListener("click", () => {
      const drawer = document.createElement("div")
      drawer.className = "byte-drawer"
      Object.defineProperty(drawer, "getBoundingClientRect", {
        value: () => ({ width: 960 })
      })
      drawer.append("封面图尺寸建议")
      const tab = document.createElement("button")
      tab.className = "byte-tabs-header-title"
      tab.textContent = "上传图片"
      const panel = document.createElement("div")
      panel.dataset.e2e = "image-upload"
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "image/*"
      Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
      input.addEventListener("change", () => {
        const confirm = document.createElement("button")
        confirm.dataset.e2e = "imageUploadConfirm-btn"
        confirm.textContent = "确定"
        confirm.addEventListener("click", () => { coverConfirmed = true })
        drawer.appendChild(confirm)
      })
      panel.appendChild(input)
      drawer.append(tab, panel)
      document.body.appendChild(drawer)
    })
    document.body.appendChild(coverAdd)

    const complete = vi.fn()
    await toutiaoAdapter.prepareDraft({
      task,
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete, fail: vi.fn() }
    })

    expect(bodyDrawer.isConnected).toBe(false)
    expect(coverConfirmed).toBe(true)
    expect(complete).toHaveBeenCalledTimes(2)
  })

  test("reads the current Weibo v5 account from the page JSON config", async () => {
    document.body.innerHTML = `<script>window.__WB_GET_CONFIG = function () {
      return { config: JSON.parse('{"uid":5512547482,"nick":"苍何ya"}') }
    }</script>`

    await expect(resolveWeiboUid()).resolves.toBe("5512547482")
  })

  test("creates and saves one Weibo v5 draft and returns its real editor address", async () => {
    document.body.innerHTML = fixture("weibo")
    let uploadIndex = 0
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith("data:")) return nativeFetch(input, init)
      if (url.startsWith("https://picupload.weibo.com/")) {
        uploadIndex += 1
        return new Response(JSON.stringify({ data: { pics: { pic_1: { pid: `pid${uploadIndex}`, width: 1200, height: 800 } } } }), { status: 200 })
      }
      if (url.includes("/draft/create")) return new Response(JSON.stringify({ code: 100000, data: { id: "draft-v5" } }), { status: 200 })
      if (url.includes("/draft/save")) return new Response(JSON.stringify({ code: 100000, data: { edit_url: "/article/v5/editor?id=draft-v5" } }), { status: 200 })
      throw new Error(`unexpected fetch ${url}`)
    })
    const result = await weiboAdapter.prepareDraft({
      task: makeTask(3),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete: vi.fn(), fail: vi.fn() }
    })

    const urls = fetchMock.mock.calls.map(call => String(call[0]))
    expect(urls.filter(url => url.includes("/v5/aj/editor/draft/create"))).toHaveLength(1)
    expect(urls.filter(url => url.includes("/draft/save"))).toHaveLength(1)
    expect(urls.some(url => /publish/i.test(url))).toBe(false)
    expect(result.draftUrl).toBe("https://card.weibo.com/article/v5/editor?id=draft-v5")
  })

  test("limits Weibo body image uploads to three concurrent requests", async () => {
    document.body.innerHTML = fixture("weibo")
    let active = 0
    let maxActive = 0
    let uploadIndex = 0
    const releases: Array<() => void> = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith("data:")) return nativeFetch(input, init)
      if (url.startsWith("https://picupload.weibo.com/")) {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise<void>(resolve => releases.push(resolve))
        active -= 1
        uploadIndex += 1
        return new Response(JSON.stringify({ data: { pics: { pic_1: { pid: `p${uploadIndex}` } } } }), { status: 200 })
      }
      if (url.includes("/draft/create")) return new Response(JSON.stringify({ data: { id: "parallel" } }), { status: 200 })
      if (url.includes("/draft/save")) return new Response(JSON.stringify({ code: 100000 }), { status: 200 })
      throw new Error(`unexpected fetch ${url}`)
    })
    const preparing = weiboAdapter.prepareDraft({ task: makeTask(4), getAssetData: async () => "data:image/png;base64,AQID" })
    await vi.waitFor(() => expect(releases).toHaveLength(3))
    expect(maxActive).toBe(3)
    releases.splice(0).forEach(release => release())
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    releases.splice(0).forEach(release => release())
    await preparing
    expect(maxActive).toBe(3)
  })

  test("does not create a v3 duplicate after a v5 draft was created but saving failed", async () => {
    document.body.innerHTML = fixture("weibo")
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input)
      if (url.includes("/v5/aj/editor/draft/create")) return new Response(JSON.stringify({ data: { id: "keep-me" } }), { status: 200 })
      if (url.includes("/v5/aj/editor/draft/save")) return new Response(JSON.stringify({ code: 500001, msg: "保存失败" }), { status: 200 })
      throw new Error(`unexpected fetch ${url}`)
    })
    await expect(weiboAdapter.prepareDraft({ task: makeTask(), getAssetData: async () => "" }))
      .rejects.toThrow("已保留同一草稿且未创建重复草稿")
    expect(fetchMock.mock.calls.map(call => String(call[0])).some(url => url.includes("/v3/"))).toBe(false)
  })

  test("saves paragraph spacing in the Weibo draft payload and preserves the shared article", async () => {
    document.body.innerHTML = fixture("weibo")
    const task = makeTask()
    task.article.html = '<p>第一段。</p><p>第二段。</p><p><br></p><p>第三段。</p><pre><code>代码\n第二行</code></pre>'
    const source = task.article.html
    const saves: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes("/draft/create")) return new Response(JSON.stringify({ data: { id: "spacing" } }), { status: 200 })
      if (url.includes("/draft/save")) {
        saves.push(String((init!.body as FormData).get("content")))
        return new Response(JSON.stringify({ code: saves.length === 1 ? 500001 : 100000 }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    await weiboAdapter.prepareDraft({ task, getAssetData: async () => "" })
    expect(saves).toEqual(Array(2).fill('<p>第一段。</p><p><br></p><p>第二段。</p><p><br></p><p>第三段。</p><pre><code>代码\n第二行</code></pre>'))
    expect(task.article.html).toBe(source)
  })

  test("crops Weibo covers to 16:9", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1600, height: 1200, close: vi.fn() }))
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["cover"], { type: "image/png" })))
    const cropped = await cropWeiboCover("data:image/png;base64,AQID", "image/png")
    expect(cropped.type).toBe("image/png")
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 150, 1600, 900, 0, 0, 1600, 900)
  })

})
