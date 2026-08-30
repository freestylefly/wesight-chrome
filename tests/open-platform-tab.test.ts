import { focusOrOpenPlatformTab } from "~lib/open-platform-tab"
import type { TaskSummary } from "~lib/storage"
import { createInitialPlatformStates } from "~types/protocol"

function summary(): TaskSummary {
  const platforms = createInitialPlatformStates(["zhihu", "csdn"])
  platforms.zhihu = {
    ...platforms.zhihu,
    status: "ready",
    tabId: 31,
    draftUrl: "https://zhuanlan.zhihu.com/p/123/edit"
  }
  platforms.csdn = {
    ...platforms.csdn,
    status: "ready",
    tabId: 32,
    draftUrl: "https://mp.csdn.net/mp_blog/creation/editor/456"
  }
  return {
    taskId: "task-open",
    title: "已上传素材的文章",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    groupId: 8,
    bridge: { baseUrl: "http://127.0.0.1:43210" },
    platforms
  }
}

describe("open prepared platform tab", () => {
  const tabsGet = vi.fn()
  const tabsUpdate = vi.fn()
  const tabsCreate = vi.fn()
  const windowsUpdate = vi.fn()
  const groupsUpdate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", {
      tabs: { get: tabsGet, update: tabsUpdate, create: tabsCreate },
      windows: { update: windowsUpdate },
      tabGroups: { update: groupsUpdate }
    })
    tabsUpdate.mockResolvedValue(undefined)
    windowsUpdate.mockResolvedValue(undefined)
    groupsUpdate.mockResolvedValue(undefined)
  })

  afterEach(() => vi.unstubAllGlobals())

  test("focuses the original prepared tab without creating a blank editor", async () => {
    tabsGet.mockResolvedValue({
      id: 31,
      windowId: 6,
      url: "https://zhuanlan.zhihu.com/p/123/edit"
    })

    await expect(focusOrOpenPlatformTab(summary(), "zhihu")).resolves.toEqual({
      tabId: 31,
      created: false,
      currentUrl: "https://zhuanlan.zhihu.com/p/123/edit"
    })
    expect(groupsUpdate).toHaveBeenCalledWith(8, { collapsed: false })
    expect(windowsUpdate).toHaveBeenCalledWith(6, { focused: true })
    expect(tabsUpdate).toHaveBeenCalledWith(31, { active: true })
    expect(tabsCreate).not.toHaveBeenCalled()
  })

  test("reopens the recorded CSDN draft when the original tab was closed", async () => {
    tabsGet.mockRejectedValue(new Error("No tab with id: 32"))
    tabsCreate.mockResolvedValue({
      id: 41,
      url: "https://mp.csdn.net/mp_blog/creation/editor/456"
    })

    await expect(focusOrOpenPlatformTab(summary(), "csdn")).resolves.toEqual({
      tabId: 41,
      created: true,
      currentUrl: "https://mp.csdn.net/mp_blog/creation/editor/456"
    })
    expect(tabsCreate).toHaveBeenCalledWith({
      url: "https://mp.csdn.net/mp_blog/creation/editor/456",
      active: true
    })
  })
})
