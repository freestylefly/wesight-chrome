import { createTaskTabs, restoreTaskTabs } from "~lib/task-tabs"
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
    taskId: "task-tabs",
    title: "多平台文章",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    targets: ["zhihu", "csdn"],
    bridge: { baseUrl: "http://127.0.0.1:43210" },
    platforms
  }
}

describe("cross-browser task tabs", () => {
  const tabsCreate = vi.fn()
  const tabsGet = vi.fn()
  const tabsUpdate = vi.fn()
  const windowsUpdate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", {
      tabs: { create: tabsCreate, get: tabsGet, update: tabsUpdate },
      windows: { update: windowsUpdate }
    })
    tabsUpdate.mockResolvedValue(undefined)
    windowsUpdate.mockResolvedValue(undefined)
  })

  afterEach(() => vi.unstubAllGlobals())

  test("activates every new platform page so Arc persists it in the current Space", async () => {
    tabsCreate
      .mockResolvedValueOnce({ id: 41, windowId: 7 })
      .mockResolvedValueOnce({ id: 42, windowId: 7 })
    const afterOpen = vi.fn().mockResolvedValue(undefined)

    const result = await createTaskTabs(["zhihu", "csdn"], { windowId: 7, afterOpen })

    expect(result.failures).toEqual([])
    expect(result.opened.map(item => item.tab.id)).toEqual([41, 42])
    expect(tabsCreate).toHaveBeenNthCalledWith(1, {
      url: "https://zhuanlan.zhihu.com/write",
      active: true,
      windowId: 7
    })
    expect(tabsCreate).toHaveBeenNthCalledWith(2, {
      url: "https://mp.csdn.net/mp_blog/creation/editor",
      active: true,
      windowId: 7
    })
    expect(afterOpen).toHaveBeenCalledTimes(2)
    expect(tabsUpdate).toHaveBeenLastCalledWith(41, { active: true })
  })

  test("continues opening later platforms when one tab fails", async () => {
    tabsCreate
      .mockRejectedValueOnce(new Error("Arc refused the first tab"))
      .mockResolvedValueOnce({ id: 52, windowId: 8 })
    const onFailure = vi.fn().mockResolvedValue(undefined)

    const result = await createTaskTabs(["zhihu", "csdn"], { windowId: 8, onFailure })

    expect(result.opened.map(item => item.platformId)).toEqual(["csdn"])
    expect(result.failures.map(item => item.platformId)).toEqual(["zhihu"])
    expect(onFailure).toHaveBeenCalledWith("zhihu", expect.any(Error))
    expect(tabsUpdate).toHaveBeenLastCalledWith(52, { active: true })
  })

  test("reopens missing tabs from saved draft URLs", async () => {
    tabsGet
      .mockResolvedValueOnce({ id: 31, windowId: 9, url: "https://zhuanlan.zhihu.com/p/123/edit" })
      .mockRejectedValueOnce(new Error("No tab with id: 32"))
    tabsCreate.mockResolvedValueOnce({
      id: 62,
      windowId: 9,
      url: "https://mp.csdn.net/mp_blog/creation/editor/456"
    })
    const afterRestore = vi.fn().mockResolvedValue(undefined)

    const result = await restoreTaskTabs(summary(), { afterRestore })

    expect(result.opened.map(item => item.tab.id)).toEqual([31, 62])
    expect(tabsCreate).toHaveBeenCalledWith({
      url: "https://mp.csdn.net/mp_blog/creation/editor/456",
      active: true,
      windowId: 9
    })
    expect(afterRestore).toHaveBeenCalledWith("csdn", expect.objectContaining({ id: 62 }))
    expect(windowsUpdate).toHaveBeenCalledWith(9, { focused: true })
    expect(tabsUpdate).toHaveBeenLastCalledWith(31, { active: true })
  })
})
