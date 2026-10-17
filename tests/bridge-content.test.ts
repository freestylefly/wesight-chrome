const sendMessage = vi.fn()
const replaceState = vi.fn()

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal("chrome", { runtime: { sendMessage } })
  vi.stubGlobal("history", { replaceState })
  document.body.innerHTML = '<div id="wesight-bridge-status"></div>'
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("standalone bridge connection page", () => {
  test("pairs without sending a task request, then removes the pairing secret from the URL", async () => {
    vi.stubGlobal("location", new URL("http://127.0.0.1:34567/wesight-bridge?connect=1#pairToken=one-time-token"))
    sendMessage.mockResolvedValue({ ok: true, value: true })
    await import("~contents/bridge")
    await vi.waitFor(() => expect(document.body.textContent).toContain("浏览器插件已连接"))
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith({ type: "CONNECT_BRIDGE", baseUrl: "http://127.0.0.1:34567", pairToken: "one-time-token" })
    expect(replaceState).toHaveBeenCalledWith(null, "", "/wesight-bridge?connect=1")
  })

  test("shows an update instruction for an extension that cannot handle the connection protocol", async () => {
    vi.stubGlobal("location", new URL("http://127.0.0.1:34567/wesight-bridge?connect=1#pairToken=one-time-token"))
    sendMessage.mockResolvedValue(undefined)
    await import("~contents/bridge")
    await vi.waitFor(() => expect(document.body.textContent).toContain("请更新 WeSight 浏览器插件"))
    expect(replaceState).not.toHaveBeenCalled()
  })

  test("returns an incomplete connection link to settings without sending a task", async () => {
    vi.stubGlobal("location", new URL("http://127.0.0.1:34567/wesight-bridge?connect=1"))
    await import("~contents/bridge")
    expect(document.body.textContent).toContain("WeSight 设置 → 连接器重新连接")
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
