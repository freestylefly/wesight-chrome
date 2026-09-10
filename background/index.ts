import { fetchAsset, fetchTask, getPairing, pairWithBridge, pingBridge, postTaskEvent } from "~lib/bridge-client"
import { writeLog } from "~lib/logs"
import { focusOrOpenPlatformTab } from "~lib/open-platform-tab"
import { taskForPlatform } from "~lib/platform-task"
import { sendTabMessageWithRetry } from "~lib/tab-message"
import {
  getLocal,
  getSession,
  removeSession,
  setLocal,
  setSession,
  STORAGE_KEYS,
  type AccountStateMap,
  type PairingRecord,
  type TaskAccessRecord,
  type TaskSummary
} from "~lib/storage"
import { PLATFORM_CONFIG } from "~platforms/config"
import { runXiaohongshuPageTask } from "~platforms/xiaohongshu-runner"
import {
  fillPlatformEditorInPage,
  uploadCsdnImageInPage,
  uploadJuejinImageInPage,
  uploadZhihuImageInPage
} from "~platforms/page-editor"
import type { ContentRequest, ExtensionRequest, ExtensionResponse, PopupState } from "~types/messages"
import {
  createInitialPlatformStates,
  PLATFORM_IDS,
  PROTOCOL_VERSION,
  type PlatformId,
  type PlatformTaskEventV1,
  type PlatformTaskStatus,
  type PublishTaskV1
} from "~types/protocol"

interface RuntimeTask {
  task: PublishTaskV1
  pairing: PairingRecord
  access: TaskAccessRecord
}

const runtimes = new Map<string, RuntimeTask>()
const xiaohongshuRuns = new Set<number>()
const TASK_ACCESS_KEY = "wesight_task_access_v1"

function defaultAccounts(): AccountStateMap {
  return Object.fromEntries(PLATFORM_IDS.map(platformId => [platformId, { state: "unknown" }])) as AccountStateMap
}

async function getAccounts(): Promise<AccountStateMap> {
  const stored = await getLocal<Partial<AccountStateMap>>(STORAGE_KEYS.accountStates)
  return { ...defaultAccounts(), ...(stored ?? {}) }
}

async function updateAccount(platformId: PlatformId, state: "logged_in" | "login_required"): Promise<void> {
  const accounts = await getAccounts()
  accounts[platformId] = { state, checkedAt: new Date().toISOString() }
  await setLocal(STORAGE_KEYS.accountStates, accounts)
}

async function getTaskSummary(taskId?: string): Promise<TaskSummary | null> {
  const summary = await getLocal<TaskSummary>(STORAGE_KEYS.currentTask)
  if (!summary || (taskId && summary.taskId !== taskId)) return null
  return {
    ...summary,
    platforms: {
      ...createInitialPlatformStates([]),
      ...summary.platforms
    }
  }
}

async function saveTaskSummary(summary: TaskSummary): Promise<void> {
  summary.updatedAt = new Date().toISOString()
  await setLocal(STORAGE_KEYS.currentTask, summary)
}

async function setPlatformStatus(
  taskId: string,
  platformId: PlatformId,
  status: PlatformTaskStatus,
  values: Partial<{ message: string; tabId: number; draftUrl: string; warnings: string[] }> = {}
): Promise<TaskSummary | null> {
  const summary = await getTaskSummary(taskId)
  if (!summary) return null
  summary.platforms[platformId] = {
    ...summary.platforms[platformId],
    status,
    ...values,
    warnings: values.warnings ?? summary.platforms[platformId].warnings
  }
  await saveTaskSummary(summary)
  return summary
}

async function ensureRuntime(taskId: string): Promise<RuntimeTask> {
  const current = runtimes.get(taskId)
  if (current) return current
  const access = await getSession<TaskAccessRecord>(TASK_ACCESS_KEY)
  const pairing = await getPairing()
  if (!access || access.taskId !== taskId || !pairing) throw new Error("任务凭据已失效，请从 Obsidian 重新启动")
  const task = await fetchTask(access.baseUrl, taskId, access.taskToken, pairing)
  const runtime = { task, pairing, access }
  runtimes.set(taskId, runtime)
  return runtime
}

async function reportStatus(
  runtime: RuntimeTask,
  platformId: PlatformId,
  status: PlatformTaskStatus,
  values: Partial<{ message: string; tabId: number; draftUrl: string; warnings: string[] }> = {}
): Promise<void> {
  await setPlatformStatus(runtime.task.taskId, platformId, status, values)
  const event: PlatformTaskEventV1 = {
    protocolVersion: PROTOCOL_VERSION,
    taskId: runtime.task.taskId,
    platformId,
    status,
    occurredAt: new Date().toISOString(),
    ...values
  }
  try {
    await postTaskEvent(runtime.access.baseUrl, runtime.access.taskToken, runtime.pairing, event)
  } catch (error) {
    await writeLog("warn", platformId, `状态回传失败：${error instanceof Error ? error.message : String(error)}`)
  }
  const summary = await getTaskSummary(runtime.task.taskId)
  if (summary && runtime.task.targets.every(target => ["ready", "cancelled"].includes(summary.platforms[target].status))) {
    runtimes.delete(runtime.task.taskId)
    await removeSession(TASK_ACCESS_KEY)
  }
}

async function sendPrepare(tabId: number, runtime: RuntimeTask, platformId: PlatformId): Promise<void> {
  await reportStatus(runtime, platformId, "filling", { tabId, message: "正在填充文章内容" })
  const request: ContentRequest = { type: "PREPARE_DRAFT", task: taskForPlatform(runtime.task, platformId) }
  try {
    await sendTabMessageWithRetry(() => chrome.tabs.sendMessage(tabId, request))
  } catch (error) {
    await reportStatus(runtime, platformId, "failed", {
      tabId,
      message: `无法连接平台页面：${error instanceof Error ? error.message : String(error)}`
    })
  }
}

async function prepareXiaohongshuTab(tabId: number, runtime: RuntimeTask): Promise<void> {
  if (xiaohongshuRuns.has(tabId)) return
  xiaohongshuRuns.add(tabId)
  await reportStatus(runtime, "xiaohongshu", "filling", {
    tabId,
    message: "正在准备小红书图文"
  })
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: runXiaohongshuPageTask,
      args: [taskForPlatform(runtime.task, "xiaohongshu")]
    })
    const result = results[0]?.result
    if (!result) throw new Error("小红书页面执行器未返回结果")
    if (result.kind === "login_required") {
      await updateAccount("xiaohongshu", "login_required")
      await reportStatus(runtime, "xiaohongshu", "login_required", {
        tabId,
        message: result.message
      })
      return
    }
    await updateAccount("xiaohongshu", "logged_in")
    await reportStatus(runtime, "xiaohongshu", "ready", {
      tabId,
      draftUrl: result.draftUrl,
      warnings: result.warnings,
      message: result.warnings.length ? "内容已填充，请检查提示后发布" : "内容已准备，请检查后发布"
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await reportStatus(runtime, "xiaohongshu", "failed", { tabId, message })
    await writeLog("error", "xiaohongshu", message)
  } finally {
    xiaohongshuRuns.delete(tabId)
  }
}

async function prepareXiaohongshuOnCompletedTab(tabId: number, url?: string): Promise<void> {
  if (!url || !url.startsWith("https://creator.xiaohongshu.com/")) return
  const summary = await getTaskSummary()
  const state = summary?.platforms.xiaohongshu
  if (!summary || !state || state.tabId !== tabId) return
  if (["filling", "ready", "cancelled"].includes(state.status)) return
  const runtime = await ensureRuntime(summary.taskId).catch(() => null)
  if (runtime) await prepareXiaohongshuTab(tabId, runtime)
}

async function createPlatformTabs(runtime: RuntimeTask): Promise<void> {
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const windowId = activeTabs[0]?.windowId
  const tabIds: number[] = []
  for (const platformId of runtime.task.targets) {
    await reportStatus(runtime, platformId, "opening", { message: "正在打开编辑页" })
    const tab = await chrome.tabs.create({
      url: PLATFORM_CONFIG[platformId].editorUrl,
      active: false,
      ...(windowId === undefined ? {} : { windowId })
    })
    if (tab.id === undefined) {
      await reportStatus(runtime, platformId, "failed", { message: "浏览器未返回标签页编号" })
      continue
    }
    tabIds.push(tab.id)
    await setPlatformStatus(runtime.task.taskId, platformId, "opening", { tabId: tab.id })
  }
  if (tabIds.length) {
    try {
      const groupId = await chrome.tabs.group({ tabIds })
      await chrome.tabGroups.update(groupId, {
        title: `WeSight 发布 · ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`,
        color: "orange",
        collapsed: false
      })
      const summary = await getTaskSummary(runtime.task.taskId)
      if (summary) {
        summary.groupId = groupId
        await saveTaskSummary(summary)
      }
    } catch (error) {
      await writeLog("warn", "tabs", `标签分组失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (tabIds[0] !== undefined) await chrome.tabs.update(tabIds[0], { active: true })
}

async function startTask(handoff: Extract<ExtensionRequest, { type: "BRIDGE_HANDOFF" }>["handoff"]): Promise<void> {
  let pairing = await getPairing()
  if (handoff.pairToken) pairing = await pairWithBridge(handoff.baseUrl, handoff.pairToken)
  if (!pairing) throw new Error("扩展尚未与 Obsidian 配对")
  if (new URL(pairing.baseUrl).hostname !== new URL(handoff.baseUrl).hostname) {
    throw new Error("本地通道主机与配对记录不一致，请重新配对")
  }
  const task = await fetchTask(handoff.baseUrl, handoff.taskId, handoff.taskToken, pairing)
  if (pairing.baseUrl !== handoff.baseUrl) {
    pairing = { ...pairing, baseUrl: handoff.baseUrl }
    await setLocal(STORAGE_KEYS.pairing, pairing)
  }
  const access: TaskAccessRecord = {
    taskId: task.taskId,
    taskToken: handoff.taskToken,
    baseUrl: handoff.baseUrl
  }
  await setSession(TASK_ACCESS_KEY, access)
  runtimes.set(task.taskId, { task, pairing, access })
  const currentSummary = await getTaskSummary(task.taskId)
  if (!currentSummary) {
    const summary: TaskSummary = {
      taskId: task.taskId,
      title: task.article.title,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bridge: { baseUrl: handoff.baseUrl },
      platforms: createInitialPlatformStates(task.targets)
    }
    await saveTaskSummary(summary)
  }
  await pingBridge(pairing)
  if (handoff.openTask) {
    await openTaskTabs(task.taskId)
    return
  }
  if (handoff.openPlatform) {
    if (!task.targets.includes(handoff.openPlatform)) throw new Error("该平台不在当前任务中")
    await openPlatformTab(task.taskId, handoff.openPlatform)
    return
  }
  if (handoff.retryPlatform) {
    await retryPlatform(task.taskId, handoff.retryPlatform)
    return
  }
  await createPlatformTabs({ task, pairing, access })
}

async function retryPlatform(taskId: string, platformId: PlatformId): Promise<void> {
  const runtime = await ensureRuntime(taskId)
  if (!runtime.task.targets.includes(platformId)) throw new Error("该平台不在当前任务中")
  const summary = await getTaskSummary(taskId)
  const existingTabId = summary?.platforms[platformId].tabId
  await reportStatus(runtime, platformId, "opening", { message: "正在重新打开编辑页" })
  if (existingTabId !== undefined) {
    try {
      await chrome.tabs.update(existingTabId, { url: PLATFORM_CONFIG[platformId].editorUrl, active: true })
      return
    } catch {
      // The original tab may have been closed.
    }
  }
  const tab = await chrome.tabs.create({ url: PLATFORM_CONFIG[platformId].editorUrl, active: true })
  if (tab.id === undefined) throw new Error("无法创建重试标签页")
  await setPlatformStatus(taskId, platformId, "opening", { tabId: tab.id })
}

async function openTaskTabs(taskId: string): Promise<void> {
  const summary = await getTaskSummary(taskId)
  if (!summary) throw new Error("找不到当前任务")
  const tabIds = Object.values(summary.platforms)
    .map(item => item.tabId)
    .filter((id): id is number => id !== undefined)
  const tabs = await Promise.all(tabIds.map(id => chrome.tabs.get(id).catch(() => null)))
  const existing = tabs.filter((tab): tab is chrome.tabs.Tab => Boolean(tab?.id))
  if (!existing.length) throw new Error("任务标签页已经关闭")
  const first = existing[0]!
  if (first.windowId !== undefined) await chrome.windows.update(first.windowId, { focused: true })
  if (first.id !== undefined) await chrome.tabs.update(first.id, { active: true })
  if (summary.groupId !== undefined) await chrome.tabGroups.update(summary.groupId, { collapsed: false }).catch(() => undefined)
}

async function openPlatformTab(taskId: string, platformId: PlatformId): Promise<void> {
  const summary = await getTaskSummary(taskId)
  if (!summary || !summary.platforms[platformId]) throw new Error("找不到对应的平台任务")
  const state = summary.platforms[platformId]
  const result = await focusOrOpenPlatformTab(summary, platformId)
  const draftUrl = result.currentUrl && result.currentUrl !== PLATFORM_CONFIG[platformId].editorUrl
    ? result.currentUrl
    : state.draftUrl
  await setPlatformStatus(taskId, platformId, state.status, {
    tabId: result.tabId,
    ...(draftUrl ? { draftUrl } : {})
  })
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`
}

async function handleMessage(message: ExtensionRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "BRIDGE_HANDOFF":
      await startTask(message.handoff)
      return true
    case "GET_POPUP_STATE": {
      const pairing = await getPairing()
      const state: PopupState = {
        pairing,
        connected: pairing ? await pingBridge(pairing) : false,
        currentTask: await getTaskSummary(),
        accounts: await getAccounts()
      }
      return state
    }
    case "RETRY_PLATFORM":
      await retryPlatform(message.taskId, message.platformId)
      return true
    case "OPEN_TASK_TABS":
      await openTaskTabs(message.taskId)
      return true
    case "PLATFORM_PAGE_READY": {
      if (message.platformId === "xiaohongshu") return false
      const summary = await getTaskSummary()
      const tabId = sender.tab?.id
      if (!summary || tabId === undefined || !summary.platforms[message.platformId]) return false
      const expectedTabId = summary.platforms[message.platformId].tabId
      if (expectedTabId !== undefined && expectedTabId !== tabId) return false
      if (summary.platforms[message.platformId].status === "ready") {
        const request: ContentRequest = {
          type: "SHOW_READY",
          warnings: summary.platforms[message.platformId].warnings
        }
        await chrome.tabs.sendMessage(tabId, request).catch(() => undefined)
        return true
      }
      const runtime = await ensureRuntime(summary.taskId)
      await setPlatformStatus(summary.taskId, message.platformId, "opening", { tabId })
      await sendPrepare(tabId, runtime, message.platformId)
      return true
    }
    case "PLATFORM_RESULT": {
      const runtime = await ensureRuntime(message.taskId)
      await updateAccount(message.platformId, "logged_in")
      const tabId = sender.tab?.id
      const currentUrl = sender.tab?.url
      await reportStatus(runtime, message.platformId, "ready", {
        tabId,
        draftUrl: message.draftUrl ?? currentUrl,
        warnings: message.warnings,
        message: message.warnings.length ? "内容已填充，请检查提示后发布" : "内容已准备，请检查后发布"
      })
      if (tabId !== undefined && message.draftUrl && message.draftUrl !== currentUrl) {
        globalThis.setTimeout(() => {
          void chrome.tabs.update(tabId, { url: message.draftUrl }).catch(async error => {
            await writeLog(
              "warn",
              message.platformId,
              `草稿已创建，但打开草稿编辑页失败：${error instanceof Error ? error.message : String(error)}`
            )
          })
        }, 100)
      }
      return true
    }
    case "PLATFORM_LOGIN_REQUIRED": {
      const runtime = await ensureRuntime(message.taskId)
      await updateAccount(message.platformId, "login_required")
      await reportStatus(runtime, message.platformId, "login_required", {
        tabId: sender.tab?.id,
        message: message.message
      })
      return true
    }
    case "PLATFORM_FAILED": {
      const runtime = await ensureRuntime(message.taskId)
      await reportStatus(runtime, message.platformId, "failed", {
        tabId: sender.tab?.id,
        message: message.message
      })
      await writeLog("error", message.platformId, message.message)
      return true
    }
    case "XIAOHONGSHU_UPLOAD_PROGRESS": {
      const runtime = await ensureRuntime(message.taskId)
      const summary = await getTaskSummary(message.taskId)
      const tabId = sender.tab?.id
      if (!summary || tabId === undefined || summary.platforms.xiaohongshu.tabId !== tabId) {
        throw new Error("小红书上传进度来源无效")
      }
      const total = Math.max(0, message.total)
      const completed = Math.min(total, Math.max(0, message.completed))
      await reportStatus(runtime, "xiaohongshu", "filling", {
        tabId,
        message: `正在上传图片 ${completed}/${total}`
      })
      return true
    }
    case "GET_ASSET_DATA": {
      const runtime = await ensureRuntime(message.taskId)
      const asset = runtime.task.assets.find(candidate => candidate.id === message.asset.id)
      if (!asset) throw new Error("任务中找不到该图片")
      return blobToDataUrl(await fetchAsset(
        runtime.access.baseUrl,
        runtime.task.taskId,
        runtime.access.taskToken,
        runtime.pairing,
        asset
      ))
    }
    case "FILL_PLATFORM_EDITOR": {
      const tabId = sender.tab?.id
      if (tabId === undefined) throw new Error("无法确定平台标签页")
      if (message.platformId !== "csdn" && message.platformId !== "juejin") {
        throw new Error(`平台 ${message.platformId} 不支持页面编辑桥`)
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: fillPlatformEditorInPage,
        args: [message.platformId, message.title, message.html, message.markdown]
      })
      const result = results.map(item => item.result).find(Boolean)
      if (!result) throw new Error(`${PLATFORM_CONFIG[message.platformId].label} 页面编辑桥未返回结果`)
      return result
    }
    case "UPLOAD_PLATFORM_ASSET": {
      if (message.platformId !== "juejin" && message.platformId !== "csdn" && message.platformId !== "zhihu") {
        throw new Error(`平台 ${message.platformId} 暂不支持编辑器图片上传`)
      }
      const tabId = sender.tab?.id
      if (tabId === undefined) throw new Error("无法确定平台标签页")
      const runtime = await ensureRuntime(message.taskId)
      const asset = runtime.task.assets.find(candidate => candidate.id === message.asset.id)
      if (!asset) throw new Error("任务中找不到该图片")
      const dataUrl = await blobToDataUrl(await fetchAsset(
        runtime.access.baseUrl,
        runtime.task.taskId,
        runtime.access.taskToken,
        runtime.pairing,
        asset
      ))
      let rawResult: unknown
      if (message.platformId === "csdn") {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: uploadCsdnImageInPage,
          args: [dataUrl, asset.fileName, asset.mimeType]
        })
        rawResult = results[0]?.result
      } else if (message.platformId === "juejin") {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: uploadJuejinImageInPage,
          args: [dataUrl, asset.fileName, asset.mimeType]
        })
        rawResult = results[0]?.result
      } else {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: uploadZhihuImageInPage,
          args: [dataUrl, asset.fileName, asset.mimeType]
        })
        rawResult = results[0]?.result
      }
      const url: unknown = message.platformId === "csdn"
        && rawResult
        && typeof rawResult === "object"
        && "ok" in rawResult
        ? (rawResult as { ok?: boolean; url?: unknown }).url
        : rawResult
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
        if (message.platformId === "csdn" && rawResult && typeof rawResult === "object" && "ok" in rawResult) {
          const failure = rawResult as {
            ok?: boolean
            message?: unknown
            diagnostic?: {
              rootType?: unknown
              rootKeys?: unknown
              firstType?: unknown
              firstKeys?: unknown
              dataType?: unknown
              dataKeys?: unknown
            }
          }
          const diagnostic = failure.diagnostic
          const parts = [
            `root=${String(diagnostic?.rootType ?? "unknown")}`,
            Array.isArray(diagnostic?.rootKeys) ? `keys=${diagnostic.rootKeys.join(",") || "-"}` : "",
            diagnostic?.firstType ? `first=${String(diagnostic.firstType)}` : "",
            Array.isArray(diagnostic?.firstKeys) ? `firstKeys=${diagnostic.firstKeys.join(",") || "-"}` : "",
            diagnostic?.dataType ? `data=${String(diagnostic.dataType)}` : "",
            Array.isArray(diagnostic?.dataKeys) ? `dataKeys=${diagnostic.dataKeys.join(",") || "-"}` : ""
          ].filter(Boolean).join("; ")
          const reason = typeof failure.message === "string" && failure.message.trim()
            ? failure.message.trim()
            : "平台未返回图片地址"
          throw new Error(`CSDN 图片“${asset.fileName}”上传失败：${reason}（响应结构：${parts || "unknown"}）`)
        }
        throw new Error(`${PLATFORM_CONFIG[message.platformId].label}图片“${asset.fileName}”上传返回数据无效`)
      }
      return url
    }
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionRequest, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then(value => sendResponse({ ok: true, value } satisfies ExtensionResponse))
    .catch(async (error: unknown) => {
      const messageText = error instanceof Error ? error.message : String(error)
      await writeLog("error", "background", messageText)
      sendResponse({ ok: false, error: messageText } satisfies ExtensionResponse)
    })
  return true
})

chrome.tabs.onRemoved.addListener(tabId => {
  void (async () => {
    const summary = await getTaskSummary()
    if (!summary) return
    const entry = Object.values(summary.platforms).find(state => state.tabId === tabId)
    if (!entry || ["ready", "failed", "cancelled"].includes(entry.status)) return
    const runtime = await ensureRuntime(summary.taskId).catch(() => null)
    if (runtime) await reportStatus(runtime, entry.platformId, "cancelled", { message: "平台标签页已关闭" })
  })()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return
  void prepareXiaohongshuOnCompletedTab(tabId, tab.url)
})
