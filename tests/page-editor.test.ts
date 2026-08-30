import {
  fillPlatformEditorInPage,
  uploadCsdnImageInPage,
  uploadJuejinImageInPage,
  uploadZhihuImageInPage
} from "~platforms/page-editor"

describe("main-world platform editors", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    document.body.className = ""
    document.body.removeAttribute("contenteditable")
    delete (window as typeof window & { CKEDITOR?: unknown }).CKEDITOR
    delete (window as typeof window & { csdn?: unknown }).csdn
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test("fills CSDN through its CKEditor instance", async () => {
    document.body.innerHTML = '<textarea id="txtTitle"></textarea>'
    const setData = vi.fn((value: string, options?: { callback?: () => void }) => options?.callback?.())
    const fire = vi.fn()
    Object.assign(window, { CKEDITOR: { instances: { editor1: { setData, fire } } } })

    await expect(fillPlatformEditorInPage("csdn", "测试标题", "<p>测试正文</p>", "测试正文"))
      .resolves.toEqual({ editor: "ckeditor" })
    expect(document.querySelector<HTMLTextAreaElement>("#txtTitle")?.value).toBe("测试标题")
    expect(setData).toHaveBeenCalledWith("<p>测试正文</p>", expect.any(Object))
    expect(fire).toHaveBeenCalledWith("change")
  })

  test("fills the CSDN CKEditor iframe document when executed in that frame", async () => {
    document.body.className = "htmledit_views cke_editable cke_editable_themed"
    document.body.setAttribute("contenteditable", "true")
    document.body.innerHTML = "<p><br></p>"
    const input = vi.fn()
    const change = vi.fn()
    const keyup = vi.fn()
    document.body.addEventListener("input", input)
    document.body.addEventListener("change", change)
    document.body.addEventListener("keyup", keyup)

    await expect(fillPlatformEditorInPage("csdn", "测试标题", "<p>测试正文</p>", "测试正文"))
      .resolves.toEqual({ editor: "ckeditor-frame" })
    expect(document.body.innerHTML).toBe("<p>测试正文</p>")
    expect(input).toHaveBeenCalledOnce()
    expect(change).toHaveBeenCalledOnce()
    expect(keyup).toHaveBeenCalledOnce()
  })

  test("returns no CSDN editor result in unrelated frames", async () => {
    document.body.innerHTML = '<div id="unrelated-frame"></div>'
    await expect(fillPlatformEditorInPage("csdn", "测试标题", "<p>测试正文</p>", "测试正文"))
      .resolves.toBeNull()
  })

  test("fills CSDN through the about:blank iframe bridge acknowledgement", async () => {
    document.body.innerHTML = '<textarea id="txtTitle"></textarea><iframe class="cke_wysiwyg_frame"></iframe>'
    const frame = document.querySelector<HTMLIFrameElement>("iframe")!
    const frameWindow = frame.contentWindow!
    Object.defineProperty(frame, "contentDocument", { configurable: true, get: () => null })
    vi.spyOn(frameWindow, "postMessage").mockImplementation(message => {
      const request = message as { requestId: string }
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          source: "wesight-csdn-editor-frame",
          type: "FILLED",
          requestId: request.requestId
        },
        source: frameWindow
      }))
    })

    await expect(fillPlatformEditorInPage("csdn", "测试标题", "<p>测试正文</p>", "测试正文"))
      .resolves.toEqual({ editor: "ckeditor-frame" })
    expect(frameWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: "wesight-csdn-editor-parent",
      type: "FILL",
      html: "<p>测试正文</p>"
    }), "*")
  })

  test("fills Juejin through the CodeMirror data model", async () => {
    document.body.innerHTML = '<input class="title-input"><div class="CodeMirror"><textarea></textarea></div>'
    const wrapper = document.querySelector<HTMLElement>(".CodeMirror")!
    const setValue = vi.fn()
    const focus = vi.fn()
    Object.assign(wrapper, { CodeMirror: { setValue, focus } })

    await expect(fillPlatformEditorInPage("juejin", "测试标题", "<p>测试正文</p>", "# 测试正文"))
      .resolves.toEqual({ editor: "codemirror" })
    expect(document.querySelector<HTMLInputElement>(".title-input")?.value).toBe("测试标题")
    expect(setValue).toHaveBeenCalledWith("# 测试正文")
    expect(focus).toHaveBeenCalled()
  })

  test("uses the Juejin paste uploader and returns its remote image URL", async () => {
    document.body.innerHTML = '<div class="CodeMirror"><textarea></textarea></div>'
    const wrapper = document.querySelector<HTMLElement>(".CodeMirror")!
    const input = wrapper.querySelector<HTMLTextAreaElement>("textarea")!
    let value = ""
    Object.assign(wrapper, {
      CodeMirror: {
        focus: vi.fn(),
        getValue: () => value,
        lineCount: () => 1,
        setCursor: vi.fn()
      }
    })

    class TestDataTransfer {
      files: File[] = []
      items = { add: (file: File) => this.files.push(file) }
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
    input.addEventListener("paste", event => {
      const transfer = (event as unknown as TestClipboardEvent).clipboardData
      expect(transfer.files[0]?.name).toBe("正文图片.png")
      value = "![正文图片](https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/fixture.png)"
    })

    await expect(uploadJuejinImageInPage("data:image/png;base64,AQID", "正文图片.png", "image/png"))
      .resolves.toBe("https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/fixture.png")
  })

  test("uploads CSDN images through the native page uploader", async () => {
    const uploadImg = vi.fn().mockResolvedValue([{
      code: 200,
      data: { imageUrl: "https://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com/fixture.png" }
    }])
    Object.assign(window, { csdn: { upload: { uploadImg } } })

    await expect(uploadCsdnImageInPage("data:image/png;base64,AQID", "正文图片.png", "image/png"))
      .resolves.toEqual({
        ok: true,
        url: "https://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com/fixture.png"
      })
    expect(uploadImg).toHaveBeenCalledWith(expect.objectContaining({
      appName: "direct_blog",
      type: "blog",
      imageTemplate: "",
      file: expect.any(File)
    }))
    expect(uploadImg.mock.contexts[0]).toBe((window as typeof window & { csdn: { upload: object } }).csdn.upload)
    const input = uploadImg.mock.calls[0]?.[0]
    expect(input.file.name).toBe("正文图片.png")
    expect(input.file.type).toBe("image/png")
  })

  test.each([
    [{ data: { data: { imageUrl: "https://i-blog.csdnimg.cn/fixture-nested.png" } } }],
    { data: { result: { image_url: "//i-blog.csdnimg.cn/fixture-protocol-relative.png" } } },
    [{ response: { body: { fileUrl: "https://i-blog.csdnimg.cn/fixture-response.png" } } }]
  ])("accepts current CSDN uploader response variants", async response => {
    const uploadImg = vi.fn().mockResolvedValue(response)
    Object.assign(window, { csdn: { upload: { uploadImg } } })

    const result = await uploadCsdnImageInPage("data:image/png;base64,AQID", "正文图片.png", "image/png")

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toMatch(/^https:\/\/i-blog\.csdnimg\.cn\//)
  })

  test("returns a redacted response-shape diagnostic for unknown CSDN responses", async () => {
    const uploadImg = vi.fn().mockResolvedValue([{
      code: 200,
      data: { status: "done", signature: "must-not-appear" }
    }])
    Object.assign(window, { csdn: { upload: { uploadImg } } })

    await expect(uploadCsdnImageInPage("data:image/png;base64,AQID", "正文图片.png", "image/png"))
      .resolves.toEqual({
        ok: false,
        message: "平台未返回图片地址",
        diagnostic: {
          rootType: "array",
          rootKeys: ["0"],
          firstType: "object",
          firstKeys: ["code", "data"],
          dataType: "object",
          dataKeys: ["status", "signature"]
        }
      })
  })

  test("adds Zhihu request and XSRF headers in the page login context", async () => {
    document.cookie = "_xsrf=xsrf-fixture"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ src: "https://picx.zhimg.com/v2-page-fixture.png" })
    } as Response)

    await expect(uploadZhihuImageInPage("data:image/png;base64,AQID", "正文图片.png", "image/png"))
      .resolves.toBe("https://picx.zhimg.com/v2-page-fixture.png")
    const request = fetchMock.mock.calls[0]?.[1]
    const headers = new Headers(request?.headers)
    expect(headers.get("x-requested-with")).toBe("fetch")
    expect(headers.get("x-xsrftoken")).toBe("xsrf-fixture")
    expect((request?.body as FormData).get("picture")).toBeInstanceOf(File)
  })
})
