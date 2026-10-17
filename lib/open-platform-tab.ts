import type { TaskSummary } from "~lib/storage"
import { PLATFORM_CONFIG } from "~platforms/config"
import type { PlatformId } from "~types/protocol"

export interface OpenPlatformTabResult {
  tabId: number
  created: boolean
  currentUrl?: string
}

export async function focusOrOpenPlatformTab(
  summary: TaskSummary,
  platformId: PlatformId,
  preferredWindowId?: number
): Promise<OpenPlatformTabResult> {
  const state = summary.platforms[platformId]
  if (!state) throw new Error("找不到对应的平台任务")

  if (state.tabId !== undefined) {
    const tab = await chrome.tabs.get(state.tabId).catch(() => null)
    if (tab?.id !== undefined) {
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
      await chrome.tabs.update(tab.id, { active: true })
      return { tabId: tab.id, created: false, currentUrl: tab.url }
    }
  }

  const tab = await chrome.tabs.create({
    url: state.draftUrl || PLATFORM_CONFIG[platformId].editorUrl,
    active: true,
    ...(preferredWindowId === undefined ? {} : { windowId: preferredWindowId })
  })
  if (tab.id === undefined) throw new Error("浏览器未返回标签页编号")
  return { tabId: tab.id, created: true, currentUrl: tab.url }
}
