import { fillCsdnEditorFrameBody } from "~contents/csdn-editor-frame"

describe("CSDN editor iframe content bridge", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    document.body.className = ""
    document.body.removeAttribute("contenteditable")
  })

  test("writes sanitized article HTML into the CKEditor body", () => {
    document.body.className = "htmledit_views cke_editable cke_editable_themed"
    document.body.setAttribute("contenteditable", "true")
    document.body.innerHTML = "<p><br></p>"
    const input = vi.fn()
    const change = vi.fn()
    document.body.addEventListener("input", input)
    document.body.addEventListener("change", change)

    expect(fillCsdnEditorFrameBody("<h2>小标题</h2><p>测试正文</p>")).toBe(true)
    expect(document.body.innerHTML).toBe("<h2>小标题</h2><p>测试正文</p>")
    expect(input).toHaveBeenCalledOnce()
    expect(change).toHaveBeenCalledOnce()
  })

  test("ignores unrelated about:blank frames", () => {
    document.body.innerHTML = "<p>AI 助手</p>"
    expect(fillCsdnEditorFrameBody("<p>测试正文</p>")).toBe(false)
    expect(document.body.textContent).toBe("AI 助手")
  })
})
