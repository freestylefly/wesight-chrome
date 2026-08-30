describe("platform content bootstrap", () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  test("registers the task receiver before announcing that CSDN is ready", async () => {
    const order: string[] = []
    let receiverRegistered = false
    const addListener = vi.fn(() => {
      receiverRegistered = true
      order.push("receiver")
    })
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === "PLATFORM_PAGE_READY") {
        expect(receiverRegistered).toBe(true)
        order.push("ready")
      }
      return { ok: true, value: true }
    })

    vi.doMock("~platforms/config", () => ({ platformFromUrl: () => "csdn" }))
    vi.doMock("~platforms/index", () => ({
      PLATFORM_ADAPTERS: {
        csdn: { dispose: vi.fn() }
      }
    }))
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener },
        sendMessage
      }
    })

    await import("~contents/platform")
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())

    expect(order).toEqual(["receiver", "ready"])
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "PLATFORM_PAGE_READY",
      platformId: "csdn"
    }))
  })
})
