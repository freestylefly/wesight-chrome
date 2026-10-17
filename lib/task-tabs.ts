import type { TaskSummary } from "~lib/storage"
import { PLATFORM_CONFIG } from "~platforms/config"
import { PLATFORM_IDS, type PlatformId } from "~types/protocol"

export interface TaskTab {
  platformId: PlatformId
  tab: chrome.tabs.Tab
}

export interface TaskTabFailure {
  platformId: PlatformId
  error: unknown
}

interface CreateTaskTabsOptions {
  windowId?: number
  beforeOpen?: (platformId: PlatformId) => Promise<void>
  afterOpen?: (platformId: PlatformId, tab: chrome.tabs.Tab) => Promise<void>
  onFailure?: (platformId: PlatformId, error: unknown) => Promise<void>
}

interface RestoreTaskTabsOptions {
  windowId?: number
  afterRestore?: (platformId: PlatformId, tab: chrome.tabs.Tab) => Promise<void>
}

function createProperties(url: string, windowId?: number): chrome.tabs.CreateProperties {
  return {
    url,
    // Arc only promotes extension-created pages into its Space/sidebar model
    // after they have been active. Chrome and Edge also tolerate this flow.
    active: true,
    ...(windowId === undefined ? {} : { windowId })
  }
}

function selectedPlatforms(summary: TaskSummary): PlatformId[] {
  if (summary.targets?.length) return summary.targets
  return PLATFORM_IDS.filter(platformId => summary.platforms[platformId].status !== "cancelled")
}

async function focusFirst(tabs: TaskTab[]): Promise<void> {
  const first = tabs[0]?.tab
  if (first?.windowId !== undefined) await chrome.windows.update(first.windowId, { focused: true })
  if (first?.id !== undefined) await chrome.tabs.update(first.id, { active: true })
}

export async function createTaskTabs(
  platforms: PlatformId[],
  options: CreateTaskTabsOptions = {}
): Promise<{ opened: TaskTab[]; failures: TaskTabFailure[] }> {
  const opened: TaskTab[] = []
  const failures: TaskTabFailure[] = []

  for (const platformId of platforms) {
    await options.beforeOpen?.(platformId)
    try {
      const tab = await chrome.tabs.create(createProperties(PLATFORM_CONFIG[platformId].editorUrl, options.windowId))
      if (tab.id === undefined) throw new Error("浏览器未返回标签页编号")
      opened.push({ platformId, tab })
      await options.afterOpen?.(platformId, tab)
    } catch (error) {
      failures.push({ platformId, error })
      await options.onFailure?.(platformId, error)
    }
  }

  await focusFirst(opened)
  return { opened, failures }
}

export async function restoreTaskTabs(
  summary: TaskSummary,
  options: RestoreTaskTabsOptions = {}
): Promise<{ opened: TaskTab[]; failures: TaskTabFailure[] }> {
  const opened: TaskTab[] = []
  const failures: TaskTabFailure[] = []
  let windowId = options.windowId

  for (const platformId of selectedPlatforms(summary)) {
    const state = summary.platforms[platformId]
    let tab = state.tabId === undefined
      ? null
      : await chrome.tabs.get(state.tabId).catch(() => null)

    if (!tab?.id) {
      try {
        tab = await chrome.tabs.create(createProperties(
          state.draftUrl || PLATFORM_CONFIG[platformId].editorUrl,
          windowId
        ))
      } catch (error) {
        failures.push({ platformId, error })
        continue
      }
    }

    if (tab.id === undefined) {
      failures.push({ platformId, error: new Error("浏览器未返回标签页编号") })
      continue
    }
    windowId ??= tab.windowId
    opened.push({ platformId, tab })
    await options.afterRestore?.(platformId, tab)
  }

  if (!opened.length) throw new Error("无法恢复任务草稿页")
  await focusFirst(opened)
  return { opened, failures }
}
