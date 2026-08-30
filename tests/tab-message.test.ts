import { sendTabMessageWithRetry } from "~lib/tab-message"

describe("tab message delivery", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test("retries while a freshly opened content receiver is starting", async () => {
    vi.useFakeTimers()
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockRejectedValueOnce(new Error("The message port closed before a response was received."))
      .mockResolvedValue({ ok: true })

    const result = sendTabMessageWithRetry(send, { attempts: 4, delayMs: 100 })
    await vi.advanceTimersByTimeAsync(200)

    await expect(result).resolves.toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(3)
  })

  test("does not retry a platform task error", async () => {
    const send = vi.fn().mockRejectedValue(new Error("CSDN 图片上传失败"))

    await expect(sendTabMessageWithRetry(send)).rejects.toThrow("CSDN 图片上传失败")
    expect(send).toHaveBeenCalledOnce()
  })
})
