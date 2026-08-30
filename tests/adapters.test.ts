import { bilibiliAdapter } from "~platforms/bilibili"
import { csdnAdapter } from "~platforms/csdn"
import { juejinAdapter } from "~platforms/juejin"
import { zhihuAdapter } from "~platforms/zhihu"
import type { PlatformAdapter } from "~platforms/types"
import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"

function task(title = "多平台测试文章"): PublishTaskV1 {
  const createdAt = Date.now()
  return {
    protocolVersion: 1,
    taskId: "task-fixture",
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + 10 * 60 * 1_000).toISOString(),
    source: { vaultPath: "文章.md", contentHash: "a".repeat(64) },
    article: {
      title,
      digest: "摘要",
      markdown: "# 小标题\n\n正文",
      html: "<h1>小标题</h1><p>正文</p>",
      coverAssetId: null,
      tags: ["AI"],
      original: true
    },
    assets: [],
    targets: ["zhihu", "csdn", "juejin", "bilibili-article"],
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

function taskWithBodyImage(): PublishTaskV1 {
  const image: PublishAssetV1 = {
    id: "b".repeat(64),
    fileName: "正文图片.png",
    mimeType: "image/png",
    size: 3,
    sha256: "b".repeat(64)
  }
  const imageToken = `wesight-asset://${image.id}`
  return {
    ...task(),
    article: {
      ...task().article,
      markdown: `正文\n\n![产品界面](${imageToken})`,
      html: `<p>正文</p><img src="${imageToken}" alt="产品界面">`
    },
    assets: [image]
  }
}

function taskWithBodyImages(count: number): PublishTaskV1 {
  const images = Array.from({ length: count }, (_, index): PublishAssetV1 => ({
    id: String(index + 1).repeat(64),
    fileName: `正文图片-${index + 1}.png`,
    mimeType: "image/png",
    size: 3,
    sha256: String(index + 1).repeat(64)
  }))
  return {
    ...task(),
    article: {
      ...task().article,
      markdown: images.map(image => `![${image.fileName}](wesight-asset://${image.id})`).join("\n\n"),
      html: images.map(image => `<img src="wesight-asset://${image.id}" alt="${image.fileName}">`).join("")
    },
    assets: images
  }
}

async function prepareWithFixture(
  adapter: PlatformAdapter,
  titleHtml: string,
  editorHtml: string
): Promise<void> {
  document.body.innerHTML = `${titleHtml}${editorHtml}`
  const result = await adapter.prepareDraft({ task: task(), getAssetData: async () => "" })
  const title = document.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")
  const editor = document.querySelector<HTMLElement>("[contenteditable='true'], textarea.editor__inner, .bytemd-editor textarea")
    ?? document.querySelector<HTMLIFrameElement>("iframe.cke_wysiwyg_frame")?.contentDocument?.body
  expect(title?.value).toBe("多平台测试文章")
  expect(editor?.textContent || (editor as HTMLTextAreaElement | null)?.value).toContain("正文")
  expect(result.draftUrl).toBeTruthy()
}

describe("platform adapter fixtures", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test("fills the Zhihu rich editor", async () => {
    await prepareWithFixture(zhihuAdapter, '<textarea placeholder="请输入标题（最多 100 个字）"></textarea>', '<div data-contents="true" contenteditable="true"></div>')
  })

  test("uses an HTML-only paste payload to bypass Zhihu's format detector", async () => {
    document.body.innerHTML = '<textarea placeholder="请输入标题（最多 100 个字）"></textarea><div data-contents="true" contenteditable="true"></div>'
    const values = new Map<string, string>()
    class TestDataTransfer {
      setData(type: string, value: string) { values.set(type, value) }
      getData(type: string) { return values.get(type) ?? "" }
    }
    class TestClipboardEvent extends Event {
      clipboardData: TestDataTransfer
      constructor(type: string, init: EventInit & { clipboardData: TestDataTransfer }) {
        super(type, init)
        this.clipboardData = init.clipboardData
      }
    }
    vi.stubGlobal("DataTransfer", TestDataTransfer)
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent)

    await zhihuAdapter.prepareDraft({ task: task(), getAssetData: async () => "" })

    expect(values.get("text/html")).toContain("<h1>小标题</h1>")
    expect(values.get("text/plain")).toBe("")
  })

  test("uploads Zhihu body images before filling the rich editor", async () => {
    document.body.innerHTML = '<textarea placeholder="请输入标题（最多 100 个字）"></textarea><div data-contents="true" contenteditable="true"></div>'
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ src: "https://picx.zhimg.com/v2-fixture.png" })
    } as Response)

    await zhihuAdapter.prepareDraft({
      task: taskWithBodyImage(),
      getAssetData: async () => "data:image/png;base64,AQID"
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://zhuanlan.zhihu.com/api/uploaded_images")
    const request = fetchMock.mock.calls[0]?.[1]
    expect(request?.method).toBe("POST")
    const picture = (request?.body as FormData).get("picture")
    expect(picture).toBeInstanceOf(File)
    expect((picture as File).name).toBe("正文图片.png")
    const editor = document.querySelector<HTMLElement>("[data-contents='true']")
    expect(editor?.querySelector("img")?.getAttribute("src")).toBe("https://picx.zhimg.com/v2-fixture.png")
    expect(editor?.innerHTML).not.toContain("wesight-asset://")
  })

  test("uploads Zhihu body images through the page login bridge", async () => {
    document.body.innerHTML = '<textarea placeholder="请输入标题（最多 100 个字）"></textarea><div data-contents="true" contenteditable="true"></div>'
    const uploadAsset = vi.fn().mockResolvedValue("https://picx.zhimg.com/v2-bridge-fixture.png")

    await zhihuAdapter.prepareDraft({
      task: taskWithBodyImage(),
      getAssetData: async () => "data:image/png;base64,AQID",
      pageBridge: {
        fillEditor: vi.fn(),
        uploadAsset
      }
    })

    expect(uploadAsset).toHaveBeenCalledOnce()
    expect(uploadAsset).toHaveBeenCalledWith("zhihu", expect.objectContaining({ fileName: "正文图片.png" }))
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://picx.zhimg.com/v2-bridge-fixture.png")
  })

  test("reports a clear error when a Zhihu body image upload fails", async () => {
    document.body.innerHTML = '<textarea placeholder="请输入标题（最多 100 个字）"></textarea><div data-contents="true" contenteditable="true"></div>'
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response)

    await expect(zhihuAdapter.prepareDraft({
      task: taskWithBodyImage(),
      getAssetData: async () => "data:image/png;base64,AQID"
    })).rejects.toThrow("知乎图片“正文图片.png”上传失败（HTTP 500）")
  })

  test("fills the CSDN editor without a signing secret", async () => {
    document.body.innerHTML = '<input class="article-bar__title"><iframe class="cke_wysiwyg_frame"></iframe>'
    const frame = document.querySelector<HTMLIFrameElement>("iframe.cke_wysiwyg_frame")
    expect(frame?.contentDocument?.body).toBeTruthy()
    frame!.contentDocument!.body.setAttribute("contenteditable", "true")
    frame!.contentDocument!.body.className = "htmledit_views cke_editable"

    const result = await csdnAdapter.prepareDraft({ task: task(), getAssetData: async () => "" })

    expect(document.querySelector<HTMLInputElement>("input.article-bar__title")?.value).toBe("多平台测试文章")
    expect(frame!.contentDocument!.body.textContent).toContain("正文")
    expect(result.draftUrl).toBeTruthy()
  })

  test("fills the live CSDN CKEditor through the page bridge", async () => {
    document.body.innerHTML = '<textarea id="txtTitle" placeholder="请输入文章标题"></textarea>'
    const fillEditor = vi.fn().mockResolvedValue(undefined)
    const uploadAsset = vi.fn().mockResolvedValue("https://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com/fixture.png")

    await csdnAdapter.prepareDraft({
      task: taskWithBodyImage(),
      getAssetData: async () => "data:image/png;base64,AQID",
      pageBridge: {
        fillEditor,
        uploadAsset
      }
    })

    expect(uploadAsset).toHaveBeenCalledOnce()
    expect(fillEditor).toHaveBeenCalledWith(expect.objectContaining({
      platformId: "csdn",
      title: "多平台测试文章",
      html: expect.stringContaining("https://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com/fixture.png")
    }))
  })

  test("uploads up to three CSDN images in parallel", async () => {
    document.body.innerHTML = '<textarea id="txtTitle" placeholder="请输入文章标题"></textarea>'
    let active = 0
    let maxActive = 0
    const releases: Array<() => void> = []
    const uploadAsset = vi.fn(async (_platformId: string, asset: PublishAssetV1) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>(resolve => releases.push(resolve))
      active -= 1
      return `https://i-blog.csdnimg.cn/direct/${asset.id}.png`
    })
    const fillEditor = vi.fn().mockResolvedValue(undefined)
    const preparing = csdnAdapter.prepareDraft({
      task: taskWithBodyImages(4),
      getAssetData: async () => "data:image/png;base64,AQID",
      pageBridge: { fillEditor, uploadAsset }
    })

    await vi.waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(3))
    expect(maxActive).toBe(3)
    releases.splice(0).forEach(release => release())
    await vi.waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(4))
    releases.splice(0).forEach(release => release())
    await preparing

    expect(maxActive).toBe(3)
    expect(fillEditor).toHaveBeenCalledOnce()
  })

  test("fills the Juejin Markdown editor", async () => {
    await prepareWithFixture(juejinAdapter, '<input class="title-input">', '<div class="bytemd-editor"><textarea></textarea></div>')
  })

  test("uploads Juejin body images and fills the CodeMirror data model through the page bridge", async () => {
    document.body.innerHTML = '<input class="title-input"><div class="CodeMirror-code" role="presentation"></div>'
    const uploadAsset = vi.fn().mockResolvedValue("https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/fixture.png")
    const fillEditor = vi.fn().mockResolvedValue(undefined)

    await juejinAdapter.prepareDraft({
      task: taskWithBodyImage(),
      getAssetData: async () => "data:image/png;base64,AQID",
      pageBridge: { fillEditor, uploadAsset }
    })

    expect(uploadAsset).toHaveBeenCalledOnce()
    expect(fillEditor).toHaveBeenCalledWith(expect.objectContaining({
      platformId: "juejin",
      markdown: expect.stringContaining("https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/fixture.png")
    }))
    expect(fillEditor.mock.calls[0]?.[0].markdown).not.toContain("wesight-asset://")
  })

  test("creates only a Bilibili draft and returns its editor URL", async () => {
    vi.useFakeTimers()
    const timeoutSpy = vi.spyOn(window, "setTimeout")
    document.cookie = "bili_jct=csrf-fixture"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { aid: 12345 } })
    } as Response)
    const result = await bilibiliAdapter.prepareDraft({ task: task("这是一个用于验证B站标题上限和草稿接口的很长很长的标题文本"), getAssetData: async () => "" })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/x/article/creative/draft/addupdate")
    expect(result.draftUrl).toBe("https://member.bilibili.com/york/read-editor?aid=12345")
    expect(result.warnings).toContain("分区、分类、封面和原创声明请在 B站专栏页确认")
    expect(timeoutSpy).not.toHaveBeenCalled()
  })

  test("detects a login form", async () => {
    document.body.innerHTML = '<form action="/login"><input type="password"></form>'
    await expect(zhihuAdapter.detectAccount()).resolves.toMatchObject({ loggedIn: false })
  })

  test("ignores CSDN's hidden disabled password decoy on the editor page", async () => {
    document.body.innerHTML = [
      '<input id="txtTitle" placeholder="请输入文章标题">',
      '<input type="password" autocomplete="new-password" readonly disabled',
      ' style="display:none;position:absolute;left:-9999999px;width:0;height:0">'
    ].join("")

    await expect(csdnAdapter.detectAccount()).resolves.toEqual({ loggedIn: true })
  })

  test("still detects a visible enabled password field", async () => {
    document.body.innerHTML = '<input type="password" autocomplete="current-password">'

    await expect(csdnAdapter.detectAccount()).resolves.toMatchObject({ loggedIn: false })
  })
})
