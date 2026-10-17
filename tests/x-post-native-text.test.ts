import { prepareXPostNativeText, xPostNativeTextUrl } from "~lib/x-post-native-text"

const input = () => ({ taskId: "text-route-1", account: "fixture_user", text: "中文 & 链接 https://example.com/?a=1&b=2\n\n第二段 #测试", requested: false })
function setup(text = "") {
  document.body.innerHTML = '<div data-testid="SideNav_AccountSwitcher_Button"><span>@fixture_user</span></div><div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true"></div><div data-testid="attachments"></div><button>Post</button></div>'
  const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
  editor.textContent = text
  return editor
}
beforeEach(() => {
  vi.stubGlobal("location", new URL("https://x.com/compose/post"))
  vi.spyOn(history, "replaceState").mockImplementation((_state, _unused, url) => {
    if (url) vi.stubGlobal("location", new URL(String(url), "https://x.com"))
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test("native URL preserves the full text and opens Post without touching editor controls or APIs", async () => {
  const value = input(), editor = setup()
  const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy)
  const event = vi.spyOn(HTMLElement.prototype, "dispatchEvent"), click = vi.spyOn(HTMLElement.prototype, "click")
  const result = await prepareXPostNativeText(value)
  expect(result.editorPending).toBe(true)
  const url = new URL(result.draftUrl)
  expect(url.origin + url.pathname).toBe("https://x.com/compose/post")
  expect(url.searchParams.get("text")).toBe(value.text)
  expect(url.searchParams.get("wesight_x_post_task")).toBe(value.taskId)
  expect(editor.textContent).toBe("")
  expect(fetchSpy).not.toHaveBeenCalled(); expect(event).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled()
})

test("confirms only X's own rendered prefill and preserves later user edits, including clearing text", async () => {
  const value = { ...input(), requested: true }, editor = setup(valueText())
  function valueText() { return input().text }
  expect((await prepareXPostNativeText(value)).editorPending).toBeUndefined()
  expect(location.search).not.toContain("text=")
  expect(new URL(location.href).searchParams.get("wesight_x_post_task")).toBe(value.taskId)
  editor.textContent = "用户在 X 中改过的文案"
  expect((await prepareXPostNativeText(value)).warnings.join()).toContain("保留")
  expect(editor.textContent).toBe("用户在 X 中改过的文案")
  editor.textContent = ""
  await prepareXPostNativeText(value)
  expect(editor.textContent).toBe("")
})

test("does not accept arbitrary existing contents or another task's Post", async () => {
  setup("我自己的未发布内容")
  await expect(prepareXPostNativeText(input())).rejects.toThrow("已有未发布内容")
  setup()
  vi.stubGlobal("location", new URL("https://x.com/compose/post?wesight_x_post_task=someone-else"))
  await expect(prepareXPostNativeText(input())).rejects.toThrow("已有未发布内容")
})

test("rejects an occupied image or reply composer and an account switch", async () => {
  setup()
  document.querySelector('[data-testid="attachments"]')!.innerHTML = '<img src="data:image/png;base64,AA==">'
  await expect(prepareXPostNativeText(input())).rejects.toThrow("已有未发布内容")
  setup()
  vi.stubGlobal("location", new URL("https://x.com/compose/post?in_reply_to=123"))
  await expect(prepareXPostNativeText(input())).rejects.toThrow("已有未发布内容")
  vi.stubGlobal("location", new URL("https://x.com/compose/post"))
  document.querySelector("span")!.textContent = "@other_user"
  await expect(prepareXPostNativeText(input())).rejects.toThrow("账号已改变")
})

test("refresh of an owned Post reopens the native text URL; a failed native fill stops without a navigation loop", async () => {
  setup()
  const value = { ...input(), requested: true }
  vi.stubGlobal("location", new URL(`https://x.com/compose/post?wesight_x_post_task=${value.taskId}`))
  expect((await prepareXPostNativeText(value)).draftUrl).toBe(xPostNativeTextUrl(value.text, value.taskId))
  vi.stubGlobal("location", new URL("https://x.com/compose/post"))
  vi.useFakeTimers()
  const pending = expect(prepareXPostNativeText(value)).rejects.toThrow("尚未载入预填文案")
  await vi.runAllTimersAsync()
  await pending
})

test("waits for a background X tab to render Post instead of failing after a few seconds", async () => {
  vi.useFakeTimers()
  let visibility: DocumentVisibilityState = "hidden"
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility)
  document.body.innerHTML = '<div data-testid="SideNav_AccountSwitcher_Button"><span>@fixture_user</span></div>'
  const onHidden = vi.fn()
  const pending = prepareXPostNativeText({ ...input(), onHidden })
  await vi.advanceTimersByTimeAsync(120_000)
  expect(onHidden).toHaveBeenCalledTimes(1)
  visibility = "visible"
  setup()
  await vi.advanceTimersByTimeAsync(500)
  expect((await pending).editorPending).toBe(true)
})
