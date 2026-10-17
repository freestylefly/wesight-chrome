import {
  READY_BANNER_AUTO_DISMISS_MS,
  removeReadyBanner,
  showReadyBanner
} from "~lib/ready-banner"

describe("ready banner", () => {
  afterEach(() => {
    vi.useRealTimers()
    removeReadyBanner()
    document.body.innerHTML = ""
  })

  test("can be dismissed with the close button", () => {
    showReadyBanner(["分类与标签请在掘金发布设置中确认"])

    const banner = document.querySelector<HTMLElement>("#wesight-publish-ready-banner")
    const closeButton = banner?.querySelector<HTMLButtonElement>('button[aria-label="关闭 WeSight 提示"]')

    expect(banner?.textContent).toContain("分类与标签请在掘金发布设置中确认")
    expect(closeButton?.textContent).toBe("×")
    closeButton?.click()
    expect(document.querySelector("#wesight-publish-ready-banner")).toBeNull()
  })

  test("removes the upload progress and dismisses itself after completion", () => {
    vi.useFakeTimers()
    const uploadProgress = document.createElement("aside")
    uploadProgress.id = "wesight-publish-upload-progress"
    document.body.appendChild(uploadProgress)

    showReadyBanner([])

    expect(document.querySelector("#wesight-publish-upload-progress")).toBeNull()
    expect(document.querySelector("#wesight-publish-ready-banner")).not.toBeNull()

    vi.advanceTimersByTime(READY_BANNER_AUTO_DISMISS_MS)
    expect(document.querySelector("#wesight-publish-ready-banner")).toBeNull()
  })

  test("resets the auto-dismiss countdown when refreshed", () => {
    vi.useFakeTimers()
    showReadyBanner([])
    vi.advanceTimersByTime(READY_BANNER_AUTO_DISMISS_MS - 1_000)

    showReadyBanner(["请检查发布设置"])
    vi.advanceTimersByTime(1_000)
    expect(document.querySelector("#wesight-publish-ready-banner")).not.toBeNull()

    vi.advanceTimersByTime(READY_BANNER_AUTO_DISMISS_MS - 1_000)
    expect(document.querySelector("#wesight-publish-ready-banner")).toBeNull()
  })
})
