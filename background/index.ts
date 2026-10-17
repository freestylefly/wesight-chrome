import { xPublicScriptUrl } from "~lib/x-article-api"
import { discoverPublicXPostApi } from "~lib/x-post-api"
import { runXPostComposerInPage } from "~lib/x-post-composer"
import { buildXPostText } from "~lib/x-post-content"
import { normalizeDraft } from "~lib/article-preparation"
import { completeWeSightLogin, loginPending, publishAuthState, signOutWeSight, startWeSightLogin, verifyCloudIdentity } from "~lib/cloud-auth"
import type { WeSightAuthState } from "~types/auth"
import { probeAccount } from "~lib/accounts"
import { fetchAccess, fetchAsset, fetchTask, getPairing, pairWithBridge, postTaskEvent } from "~lib/bridge-client"
import { assertBridgeSender, BRIDGE_HEARTBEAT_ALARM, BridgeConnectionMonitor } from "~lib/bridge-connection"
import { shouldMirrorBridgeEvent } from "~lib/bridge-event-policy"
import { buildComposeTask } from "~lib/compose-task"
import { buildDynamicTask, dynamicDraftFromTask, getCurrentDynamicDraft, saveCurrentDynamicDraft, type DynamicPlatformId } from "~lib/dynamic-draft"
import {
  getCurrentDraft,
  getLocalTask,
  getStoredAsset,
  pruneAssets,
  saveCurrentDraft,
  saveLocalTask,
  type ComposeDraft,
  type StoredAsset
} from "~lib/draft-store"
import { writeLog } from "~lib/logs"
import { focusOrOpenPlatformTab } from "~lib/open-platform-tab"
import { taskForPlatform } from "~lib/platform-task"
import { PlatformLoginMonitor } from "~lib/platform-login"
import { sendTabMessageWithRetry } from "~lib/tab-message"
import { createTaskTabs, restoreTaskTabs } from "~lib/task-tabs"
import {
  getLocal,
  getSession,
  removeSession,
  setLocal,
  SESSION_KEYS,
  setSession,
  STORAGE_KEYS,
  type AccessRecord,
  type AccountStateMap,
  type AccountRecord,
  type BridgeTaskAccess,
  type ComposeBridgeRecord,
  type PairingRecord,
  type TaskAccessRecord,
  type TaskSummary
} from "~lib/storage"
import { accountPlatformIds, PLATFORM_CONFIG, platformForOwnedPage } from "~platforms/config"
import { runXiaohongshuPageTask } from "~platforms/xiaohongshu-runner"
import {
  fillPlatformEditorInPage,
  uploadCsdnImageInPage,
  uploadJuejinImageInPage,
  uploadZhihuImageInPage
} from "~platforms/page-editor"
import type { ContentRequest, ExtensionRequest, ExtensionResponse, PopupState, PublishCenterState } from "~types/messages"
import {
  ARTICLE_PLATFORM_IDS,
  createInitialPlatformStates,
  PLATFORM_IDS,
  PROTOCOL_VERSION,
  type PlatformId,
  type PlatformTaskEventV1,
  type PlatformTaskStatus,
  type PublishAssetV1,
  type PublishTaskV1
} from "~types/protocol"

interface RuntimeTask {
  task: PublishTaskV1
  local: boolean
  readAsset: (asset: PublishAssetV1) => Promise<Blob>
  postEvent: ((event: PlatformTaskEventV1) => Promise<void>) | null
}

const runtimes = new Map<string, RuntimeTask>()
const xiaohongshuRuns = new Set<number>()
const prepareRuns = new Set<string>()
const PUBLISH_CENTER_PATH = "tabs/publish.html"
const ASSET_IMPORT_CONCURRENCY = 4
const assetBlobs = new Map<string, Blob>()
const bridgeConnection = new BridgeConnectionMonitor()

function defaultAccounts(): AccountStateMap {
  return Object.fromEntries(PLATFORM_IDS.map(platformId => [platformId, { state: "unknown" }])) as AccountStateMap
}

async function getAccounts(): Promise<AccountStateMap> {
  const stored = await getLocal<Partial<AccountStateMap>>(STORAGE_KEYS.accountStates)
  return { ...defaultAccounts(), ...(stored ?? {}) }
}

let accountWrites: Promise<unknown> = Promise.resolve()
function mutateAccounts(update: (accounts: AccountStateMap) => void): Promise<AccountStateMap> {
  const written = accountWrites.then(async () => {
    const accounts = await getAccounts()
    update(accounts)
    await setLocal(STORAGE_KEYS.accountStates, accounts)
    return accounts
  })
  accountWrites = written.catch(() => undefined)
  return written
}

function assignAccount(accounts: AccountStateMap, platformId: PlatformId, account: AccountRecord): void {
  for (const id of accountPlatformIds(platformId)) {
    const previousTime = Date.parse(accounts[id].checkedAt ?? "")
    const checkedTime = Date.parse(account.checkedAt ?? "")
    if (Number.isFinite(previousTime) && Number.isFinite(checkedTime) && previousTime > checkedTime) continue
    accounts[id] = account
  }
}

const platformLoginMonitor = new PlatformLoginMonitor(async (platformId, account: AccountRecord) => {
  await mutateAccounts(accounts => {
    assignAccount(accounts, platformId, account)
  })
})

async function updateAccount(platformId: PlatformId, state: "logged_in" | "login_required"): Promise<void> {
  await mutateAccounts(accounts => {
    const previous = accountPlatformIds(platformId).map(id => accounts[id]).find(account => account.state === "logged_in")
    const account: AccountRecord = state === "logged_in" && previous
      ? { ...previous, checkedAt: new Date().toISOString() }
      : { state, checkedAt: new Date().toISOString() }
    assignAccount(accounts, platformId, account)
  })
}

let accountRefresh: Promise<AccountStateMap> | null = null

async function collectAccounts(): Promise<AccountStateMap> {
  const results = await Promise.all(PLATFORM_IDS.map(async platformId => [platformId, await probeAccount(platformId)] as const))
  return mutateAccounts(accounts => {
    for (const [platformId, result] of results) {
      // An inconclusive probe keeps whatever the last editor visit observed.
      if (result.state !== "unknown") assignAccount(accounts, platformId, result)
    }
  })
}

function refreshAccounts(): Promise<AccountStateMap> {
  accountRefresh ??= collectAccounts().finally(() => { accountRefresh = null })
  return accountRefresh
}

function accessFromMaxTargets(maxTargets: number | null): AccessRecord {
  return {
    state: maxTargets === 0 ? "login-required" : maxTargets === null ? "multi-platform" : "single-platform",
    maxTargets,
    checkedAt: new Date().toISOString()
  }
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

async function clearPlatformTab(taskId: string, platformId: PlatformId): Promise<void> {
  const summary = await getTaskSummary(taskId)
  if (!summary) return
  const { tabId: _tabId, ...state } = summary.platforms[platformId]
  summary.platforms[platformId] = state
  await saveTaskSummary(summary)
}

function bridgeRuntime(task: PublishTaskV1, pairing: PairingRecord, access: BridgeTaskAccess): RuntimeTask {
  return {
    task,
    local: false,
    readAsset: asset => fetchAsset(access.baseUrl, task.taskId, access.taskToken, pairing, asset),
    postEvent: event => postTaskEvent(access.baseUrl, access.taskToken, pairing, event)
  }
}

async function localRuntime(task: PublishTaskV1, bridge?: BridgeTaskAccess): Promise<RuntimeTask> {
  const pairing = bridge ? await getPairing() : null
  return {
    task,
    local: true,
    readAsset: async asset => {
      const stored = await getStoredAsset(asset.id)
      if (!stored) throw new Error(`图片 ${asset.fileName} 已从本地草稿中移除`)
      return new Blob([stored.bytes], { type: stored.mimeType })
    },
    // Publish-center tasks that came from Obsidian mirror progress back to it.
    postEvent: bridge && pairing
      ? event => shouldMirrorBridgeEvent(bridge, event.platformId)
        ? postTaskEvent(bridge.baseUrl, bridge.taskToken, pairing, { ...event, taskId: bridge.taskId })
        : Promise.resolve()
      : null
  }
}

async function ensureRuntime(taskId: string): Promise<RuntimeTask> {
  const current = runtimes.get(taskId)
  if (current) return current
  const access = await getSession<TaskAccessRecord>(SESSION_KEYS.taskAccess)
  let runtime: RuntimeTask
  if (access?.taskId === taskId && access.kind !== "local") {
    const pairing = await getPairing()
    if (!pairing) throw new Error("任务凭据已失效，请从 Obsidian 重新启动")
    const task = await fetchTask(access.baseUrl, taskId, access.taskToken, pairing)
    runtime = bridgeRuntime(task, pairing, access)
  } else {
    const task = await getLocalTask(taskId)
    if (!task) throw new Error("任务已失效，请在发布中心重新同步")
    runtime = await localRuntime(task, access?.taskId === taskId && access.kind === "local" ? access.bridge : undefined)
  }
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
  if (runtime.postEvent) {
    try {
      await runtime.postEvent(event)
    } catch (error) {
      await writeLog("warn", platformId, `状态回传失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const summary = await getTaskSummary(runtime.task.taskId)
  if (summary && runtime.task.targets.every(target => ["ready", "cancelled"].includes(summary.platforms[target].status))) {
    runtimes.delete(runtime.task.taskId)
    // Local tasks stay resumable from IndexedDB; bridge tokens are dropped once done.
    if (!runtime.local) await removeSession(SESSION_KEYS.taskAccess)
  }
}

async function sendPrepare(tabId: number, runtime: RuntimeTask, platformId: PlatformId): Promise<void> {
  // Page completion and the content receiver can announce readiness together.
  // Claim the upload before identity checks or storage reads can yield.
  const key = `${runtime.task.taskId}:${platformId}:${tabId}`
  if (prepareRuns.has(key)) return
  prepareRuns.add(key)
  try {
    const { auth } = await currentAccess(false)
    if (!auth.user) {
      await reportStatus(runtime, platformId, "failed", { tabId, message: "请先登录 WeSight 后重试" })
      return
    }
    await reportStatus(runtime, platformId, "filling", { tabId, message: "正在准备同步内容" })
    const request: ContentRequest = { type: "PREPARE_DRAFT", platformId, task: taskForPlatform(runtime.task, platformId) }
    try {
      await sendTabMessageWithRetry(() => chrome.tabs.sendMessage(tabId, request))
    } catch (error) {
      await reportStatus(runtime, platformId, "failed", {
        tabId,
        message: `无法连接平台页面：${error instanceof Error ? error.message : String(error)}`
      })
    }
  } finally {
    prepareRuns.delete(key)
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
  if (runtime) {
    if (runtime.task.media?.videoAssetId) await sendPrepare(tabId, runtime, "xiaohongshu")
    else await prepareXiaohongshuTab(tabId, runtime)
  }
}

async function createPlatformTabs(runtime: RuntimeTask, windowId?: number): Promise<void> {
  await createTaskTabs(runtime.task.targets, {
    windowId,
    beforeOpen: platformId => reportStatus(runtime, platformId, "opening", { message: "正在打开编辑页" }),
    afterOpen: async (platformId, tab) => {
      await setPlatformStatus(runtime.task.taskId, platformId, "opening", { tabId: tab.id })
    },
    onFailure: async (platformId, error) => {
      const message = error instanceof Error ? error.message : String(error)
      await reportStatus(runtime, platformId, "failed", { message: `打开编辑页失败：${message}` })
      await writeLog("error", platformId, `打开编辑页失败：${message}`)
    }
  })
}

async function startTask(
  handoff: Extract<ExtensionRequest, { type: "BRIDGE_HANDOFF" }>["handoff"],
  windowId?: number
): Promise<void> {
  let pairing = await getPairing()
  if (handoff.pairToken) pairing = await pairWithBridge(handoff.baseUrl, handoff.pairToken)
  if (!pairing) throw new Error("浏览器连接已失效，请回到 Obsidian 的 WeSight 设置 → 连接器，重新连接浏览器插件。")
  if (new URL(pairing.baseUrl).hostname !== new URL(handoff.baseUrl).hostname) {
    throw new Error("本地通道主机与配对记录不一致，请重新配对")
  }
  if (handoff.openTask) {
    for (const [key, mode] of [[SESSION_KEYS.dynamicComposeBridge, "dynamic"], [SESSION_KEYS.composeBridge, "article"]] as const) {
      const imported = await getSession<ComposeBridgeRecord>(key)
      if (imported?.taskId === handoff.taskId && imported.taskToken === handoff.taskToken) {
        await setLocal(STORAGE_KEYS.publishMode, mode)
        await openPublishCenter(windowId)
        return
      }
    }
  }
  const task = await fetchTask(handoff.baseUrl, handoff.taskId, handoff.taskToken, pairing)
  if (pairing.baseUrl !== handoff.baseUrl) {
    pairing = { ...pairing, baseUrl: handoff.baseUrl }
    await setLocal(STORAGE_KEYS.pairing, pairing)
  }
  await bridgeConnection.refresh(pairing)
  if (task.compose) {
    await setLocal(STORAGE_KEYS.publishMode, task.compose.kind === "dynamic" ? "dynamic" : "article")
    // Follow-up links from Obsidian only bring the publish center forward, keeping local edits.
    if (!handoff.openTask && !handoff.openPlatform && !handoff.retryPlatform) {
      await importComposeTask(task, handoff, pairing)
    }
    await openPublishCenter(windowId)
    return
  }
  if (handoff.compose) throw new Error("该任务不支持在发布中心打开")
  const identity = await currentAccess(true)
  if (!identity.auth.user) throw new Error("请先登录 WeSight 后再同步平台")
  const access: BridgeTaskAccess = {
    taskId: task.taskId,
    taskToken: handoff.taskToken,
    baseUrl: handoff.baseUrl
  }
  await setSession(SESSION_KEYS.taskAccess, access)
  const runtime = bridgeRuntime(task, pairing, access)
  runtimes.set(task.taskId, runtime)
  const currentSummary = await getTaskSummary(task.taskId)
  if (!currentSummary) {
    const summary: TaskSummary = {
      taskId: task.taskId,
      title: task.article.title,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      targets: [...task.targets],
      origin: "bridge",
      bridge: { baseUrl: handoff.baseUrl },
      platforms: createInitialPlatformStates(task.targets)
    }
    await saveTaskSummary(summary)
  }
  if (handoff.openTask) {
    await openTaskTabs(task.taskId, windowId)
    return
  }
  if (handoff.openPlatform) {
    if (!task.targets.includes(handoff.openPlatform)) throw new Error("该平台不在当前任务中")
    await openPlatformTab(task.taskId, handoff.openPlatform, windowId)
    return
  }
  if (handoff.retryPlatform) {
    await retryPlatform(task.taskId, handoff.retryPlatform)
    return
  }
  await createPlatformTabs(runtime, windowId)
}

async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index]!)
    }
  }))
  return results
}

/** Copies an Obsidian article into the publish-center draft so the user can edit and pick platforms. */
async function importComposeTask(
  task: PublishTaskV1,
  handoff: Extract<ExtensionRequest, { type: "BRIDGE_HANDOFF" }>["handoff"],
  pairing: PairingRecord
): Promise<void> {
  const assets: StoredAsset[] = await mapLimited(task.assets, ASSET_IMPORT_CONCURRENCY, async asset => {
    const blob = await fetchAsset(handoff.baseUrl, task.taskId, handoff.taskToken, pairing, asset)
    return { id: asset.id, mimeType: asset.mimeType, bytes: await blob.arrayBuffer() }
  })
  const now = new Date().toISOString()
  if (task.compose?.kind === "dynamic") {
    const draft = dynamicDraftFromTask(task)
    await saveCurrentDynamicDraft(draft, assets)
    await pruneAssets()
    await setSession<ComposeBridgeRecord>(SESSION_KEYS.dynamicComposeBridge, { draftId: draft.id, taskId: task.taskId, taskToken: handoff.taskToken, baseUrl: handoff.baseUrl, targets: [...task.targets] })
    await setLocal(STORAGE_KEYS.access, accessFromMaxTargets(task.compose.maxTargets))
    await setLocal(STORAGE_KEYS.dynamicDraftRevision, { draftId: draft.id, at: now })
    return
  }
  const draft: ComposeDraft = normalizeDraft({
    id: crypto.randomUUID(),
    source: { kind: "obsidian", vaultPath: task.source.vaultPath },
    title: task.article.title,
    digest: task.article.digest,
    markdown: task.article.markdown,
    html: task.article.html,
    coverAssetId: task.article.coverAssetId,
    tags: task.article.tags,
    ...(task.article.original === undefined ? {} : { original: task.article.original }),
    assets: task.assets,
    warnings: [],
    importedAt: now,
    updatedAt: now
  })
  await saveCurrentDraft(draft, assets)
  await pruneAssets()
  await setSession<ComposeBridgeRecord>(SESSION_KEYS.composeBridge, {
    draftId: draft.id,
    taskId: task.taskId,
    taskToken: handoff.taskToken,
    baseUrl: handoff.baseUrl,
    targets: [...task.targets]
  })
  await setLocal(STORAGE_KEYS.access, accessFromMaxTargets(task.compose?.maxTargets ?? 0))
  await setLocal(STORAGE_KEYS.draftRevision, { draftId: draft.id, at: now })
}

async function openPublishCenter(windowId?: number): Promise<void> {
  const url = chrome.runtime.getURL(PUBLISH_CENTER_PATH)
  const tabs = await chrome.tabs.query({})
  const existing = tabs.find(tab => tab.url?.startsWith(url))
  if (existing?.id !== undefined) {
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true })
    await chrome.tabs.update(existing.id, { active: true })
    return
  }
  await chrome.tabs.create({ url, active: true, ...(windowId === undefined ? {} : { windowId }) })
}

async function currentAccess(refresh: boolean): Promise<{ access: AccessRecord | null; connected: boolean; auth: WeSightAuthState }> {
  const pairing = await getPairing()
  const connected = await bridgeConnection.refresh()
  let access: AccessRecord | null = null
  let source: WeSightAuthState["source"] = null
  let error: string | undefined
  if (!await getLocal<boolean>(STORAGE_KEYS.signedOut)) {
    try {
      const identity = await verifyCloudIdentity(refresh)
      if (identity) { access = identity.access; source = "cloud" }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "无法检查 WeSight 登录状态"
    }
    if (!access && pairing && connected) {
      const shared = await fetchAccess(pairing)
      if (shared?.user && shared.maxTargets !== 0) { access = shared; source = "obsidian" }
    }
  }
  const auth: WeSightAuthState = { user: access?.user ?? null, source, loginPending: await loginPending(), ...(error ? { error } : {}) }
  if (access) await setLocal(STORAGE_KEYS.access, access)
  await publishAuthState(auth)
  return { access, connected, auth }
}

async function startComposeSync(targets: PlatformId[], keepImages: boolean, windowId?: number, xSkipExcessImages = false): Promise<TaskSummary> {
  const draft = await getCurrentDraft()
  if (!draft) throw new Error("请先导入一篇文章")
  const { access } = await currentAccess(true)
  if (!access?.user) throw new Error("请先登录 WeSight 后再同步平台")
  const task = buildComposeTask(draft, targets, {
    taskId: crypto.randomUUID(),
    keepImages,
    xSkipExcessImages,
    maxTargets: access.maxTargets
  })
  await saveLocalTask(task)
  await pruneAssets()
  const composeBridge = await getSession<ComposeBridgeRecord>(SESSION_KEYS.composeBridge)
  const bridge = composeBridge?.draftId === draft.id
    ? { taskId: composeBridge.taskId, taskToken: composeBridge.taskToken, baseUrl: composeBridge.baseUrl, targets: composeBridge.targets }
    : undefined
  await setSession<TaskAccessRecord>(SESSION_KEYS.taskAccess, { kind: "local", taskId: task.taskId, ...(bridge ? { bridge } : {}) })
  const runtime = await localRuntime(task, bridge)
  runtimes.set(task.taskId, runtime)
  const now = new Date().toISOString()
  const summary: TaskSummary = {
    taskId: task.taskId,
    title: task.article.title,
    startedAt: now,
    updatedAt: now,
    targets: [...task.targets],
    origin: "compose",
    draftId: draft.id,
    bridge: { baseUrl: bridge?.baseUrl ?? "" },
    platforms: createInitialPlatformStates(task.targets)
  }
  await saveTaskSummary(summary)
  await createPlatformTabs(runtime, windowId)
  return (await getTaskSummary(task.taskId)) ?? summary
}

async function startDynamicSync(targets: DynamicPlatformId[], windowId?: number): Promise<TaskSummary> {
  const draft = await getCurrentDynamicDraft()
  if (!draft) throw new Error("请先填写动态内容")
  const { access } = await currentAccess(true)
  if (!access?.user) throw new Error("请先登录 WeSight 后再同步平台")
  const task = buildDynamicTask(draft, targets, access.maxTargets)
  await saveLocalTask(task)
  await pruneAssets()
  assetBlobs.clear()
  const record = await getSession<ComposeBridgeRecord>(SESSION_KEYS.dynamicComposeBridge)
  const bridge = record?.draftId === draft.id ? { taskId: record.taskId, taskToken: record.taskToken, baseUrl: record.baseUrl, targets: record.targets } : undefined
  await setSession<TaskAccessRecord>(SESSION_KEYS.taskAccess, { kind: "local", taskId: task.taskId, ...(bridge ? { bridge } : {}) })
  const runtime = await localRuntime(task, bridge)
  runtimes.set(task.taskId, runtime)
  const now = new Date().toISOString()
  const summary: TaskSummary = { taskId: task.taskId, title: task.article.title, startedAt: now, updatedAt: now, targets: task.targets,
    origin: "compose", contentKind: "dynamic", draftId: draft.id, bridge: { baseUrl: bridge?.baseUrl ?? "" }, platforms: createInitialPlatformStates(task.targets) }
  await saveTaskSummary(summary)
  await createPlatformTabs(runtime, windowId)
  return await getTaskSummary(task.taskId) ?? summary
}

async function retryPlatform(taskId: string, platformId: PlatformId): Promise<void> {
  const { auth } = await currentAccess(true)
  if (!auth.user) throw new Error("请先登录 WeSight 后重试")
  const runtime = await ensureRuntime(taskId)
  if (!runtime.task.targets.includes(platformId)) throw new Error("该平台不在当前任务中")
  const summary = await getTaskSummary(taskId)
  const existingTabId = summary?.platforms[platformId].tabId
  await reportStatus(runtime, platformId, "opening", { message: "正在重新打开编辑页" })
  if (existingTabId !== undefined) {
    if (platformId === "x-post") {
      const existing = await chrome.tabs.get(existingTabId).catch(() => null)
      let url: URL | undefined
      try { url = new URL(existing?.url ?? "") } catch { /* The old editor may be closed. */ }
      if (url?.origin === "https://x.com" && url.pathname === "/compose/post") {
        await chrome.tabs.update(existingTabId, { active: true })
        // Retry the native handoff in place so edits made in X stay intact.
        await sendPrepare(existingTabId, runtime, platformId)
        return
      }
    } else {
      try {
        await chrome.tabs.update(existingTabId, { url: PLATFORM_CONFIG[platformId].editorUrl, active: true })
        return
      } catch {
        // The original tab may have been closed.
      }
    }
  }
  const tab = await chrome.tabs.create({ url: PLATFORM_CONFIG[platformId].editorUrl, active: true })
  if (tab.id === undefined) throw new Error("无法创建重试标签页")
  await setPlatformStatus(taskId, platformId, "opening", { tabId: tab.id })
}

async function openTaskTabs(taskId: string, windowId?: number): Promise<void> {
  const summary = await getTaskSummary(taskId)
  if (!summary) throw new Error("找不到当前任务")
  const result = await restoreTaskTabs(summary, {
    windowId,
    afterRestore: async (platformId, tab) => {
      await setPlatformStatus(taskId, platformId, summary.platforms[platformId].status, { tabId: tab.id })
    }
  })
  for (const failure of result.failures) {
    await writeLog(
      "warn",
      failure.platformId,
      `恢复草稿页失败：${failure.error instanceof Error ? failure.error.message : String(failure.error)}`
    )
  }
}

async function openPlatformTab(taskId: string, platformId: PlatformId, windowId?: number): Promise<void> {
  const summary = await getTaskSummary(taskId)
  if (!summary || !summary.platforms[platformId]) throw new Error("找不到对应的平台任务")
  const state = summary.platforms[platformId]
  const result = await focusOrOpenPlatformTab(summary, platformId, windowId)
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
  if (["WESIGHT_LOGIN", "WESIGHT_LOGOUT", "START_COMPOSE_SYNC", "START_DYNAMIC_SYNC", "GET_PUBLISH_STATE", "OPEN_PLATFORM_LOGIN"].includes(message.type)
    && !sender.url?.startsWith(chrome.runtime.getURL(""))) throw new Error("请求来源无效")
  switch (message.type) {
    case "CONNECT_BRIDGE": {
      assertBridgeSender(message.baseUrl, sender, true)
      if (!message.pairToken || message.pairToken.length > 256) throw new Error("连接链接无效，请回到 Obsidian 设置重新连接。")
      const pairing = await pairWithBridge(message.baseUrl, message.pairToken)
      if (!await bridgeConnection.refresh(pairing)) throw new Error("已完成配对，但暂时无法连接 Obsidian，请回到设置重新检测。")
      return true
    }
    case "BRIDGE_HANDOFF":
      assertBridgeSender(message.handoff.baseUrl, sender)
      await startTask(message.handoff, sender.tab?.windowId)
      return true
    case "WESIGHT_LOGIN":
      await startWeSightLogin()
      return true
    case "WESIGHT_LOGOUT":
      await signOutWeSight()
      return true
    case "GET_POPUP_STATE": {
      const identity = await currentAccess(false)
      const pairing = await getPairing()
      const state: PopupState = {
        auth: identity.auth,
        pairing,
        connected: await bridgeConnection.refresh(),
        currentTask: await getTaskSummary(),
        accounts: await getAccounts()
      }
      return state
    }
    case "GET_PUBLISH_STATE": {
      const { access, connected, auth } = await currentAccess(Boolean(message.refreshAccess))
      const state: PublishCenterState = {
        auth,
        paired: Boolean(await getPairing()),
        connected,
        access,
        accounts: await getAccounts(),
        currentTask: await getTaskSummary()
      }
      return state
    }
    case "REFRESH_ACCOUNTS":
      return refreshAccounts()
    case "OPEN_PLATFORM_LOGIN":
      return { tabId: await platformLoginMonitor.open(message.platformId, sender.tab?.windowId) }
    case "START_COMPOSE_SYNC":
      return startComposeSync(message.targets, message.keepImages, sender.tab?.windowId, message.xSkipExcessImages === true)
    case "START_DYNAMIC_SYNC":
      return startDynamicSync(message.targets, sender.tab?.windowId)
    case "OPEN_PLATFORM_TAB":
      await openPlatformTab(message.taskId, message.platformId, sender.tab?.windowId)
      return true
    case "OPEN_PUBLISH_CENTER":
      await openPublishCenter(sender.tab?.windowId)
      return true
    case "RETRY_PLATFORM":
      await retryPlatform(message.taskId, message.platformId)
      return true
    case "OPEN_TASK_TABS":
      await openTaskTabs(message.taskId, sender.tab?.windowId)
      return true
    case "PLATFORM_PAGE_READY": {
      const summary = await getTaskSummary()
      const tabId = sender.tab?.id
      if (!summary || tabId === undefined || !summary.platforms[message.platformId]) return false
      const owner = Object.values(summary.platforms).find(state => state.tabId === tabId)
      const platformId = platformForOwnedPage(message.platformId, owner?.platformId, sender.url ?? message.url)
      const selected = summary.targets ?? PLATFORM_IDS.filter(id => summary.platforms[id].status !== "cancelled")
      if (!selected.includes(platformId) || owner?.platformId !== platformId) return false
      const expectedTabId = summary.platforms[platformId].tabId
      if (expectedTabId !== tabId) return false
      if (summary.platforms[platformId].status === "filling") return false
      if (summary.platforms[platformId].status === "ready") {
        const pageUrl = new URL(sender.url ?? message.url)
        // A restored prepared Post must load its saved native composer again.
        // Leaving the Post after publishing must never refill the home composer.
        if (platformId === "x-post" && pageUrl.origin === "https://x.com" && pageUrl.pathname === "/compose/post"
          && (pageUrl.searchParams.has("draft_tweet_id") || pageUrl.searchParams.get("wesight_x_post_task") === summary.taskId)
          && summary.platforms[platformId].draftUrl === pageUrl.href) {
          await sendPrepare(tabId, await ensureRuntime(summary.taskId), platformId)
          return true
        }
        const request: ContentRequest = {
          type: "SHOW_READY",
          warnings: summary.platforms[platformId].warnings
        }
        await chrome.tabs.sendMessage(tabId, request).catch(() => undefined)
        return true
      }
      const runtime = await ensureRuntime(summary.taskId)
      if (platformId === "xiaohongshu" && !runtime.task.media?.videoAssetId) return false
      await sendPrepare(tabId, runtime, platformId)
      return true
    }
    case "PLATFORM_RESULT": {
      const runtime = await ensureRuntime(message.taskId)
      await updateAccount(message.platformId, "logged_in")
      const tabId = sender.tab?.id
      const currentUrl = message.platformId === "x-post" && tabId !== undefined
        ? (await chrome.tabs.get(tabId)).url : sender.tab?.url
      await reportStatus(runtime, message.platformId, message.editorPending ? "opening" : "ready", {
        tabId,
        draftUrl: message.draftUrl ?? currentUrl,
        warnings: message.warnings,
        message: message.editorPending ? "正在打开 X Post 编辑窗口" : message.warnings.length ? "内容已填充，请检查提示后发布" : "内容已准备，请检查后发布"
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
    case "GET_X_POST_API_CONFIG": {
      const source = sender.url ? new URL(sender.url) : null
      if (!source || source.protocol !== "https:" || !["x.com", "twitter.com"].includes(source.hostname)) throw new Error("X 动态接口配置请求来源无效")
      return discoverPublicXPostApi()
    }
    case "PREPARE_X_POST_COMPOSER": {
      const input = message.input
      const tabId = sender.tab?.id
      const source = sender.url ? new URL(sender.url) : null
      const summary = await getTaskSummary(input.taskId)
      if (tabId === undefined || source?.origin !== "https://x.com" || source.pathname !== "/compose/post"
        || !summary?.targets?.includes("x-post") || summary.platforms["x-post"].tabId !== tabId) {
        throw new Error("X 编辑窗口装载来源无效")
      }
      const task = taskForPlatform((await ensureRuntime(input.taskId)).task, "x-post")
      const text = buildXPostText({ title: task.targetOptions?.xPost?.includeTitle ? task.article.title : "", body: task.article.markdown })
      if (input.text !== text || !/^[\w]{1,15}$/.test(input.account)) throw new Error("X 编辑窗口内容校验失败")
      if (!input.probe) {
        const checkpoints = await getLocal<Record<string, { account: string; draftId?: string; composerMode?: string; images: Record<string, { id: string }>; skippedImages: string[] }>>("wesight_x_post_checkpoints_v1")
        const checkpoint = checkpoints?.[input.taskId]
        const ownsComposer = input.direct ? checkpoint?.composerMode === "native" && !checkpoint.draftId && input.draftId === ""
          : Boolean(checkpoint?.draftId && checkpoint.draftId === input.draftId)
        if (!ownsComposer || checkpoint?.account !== input.account.toLowerCase()) throw new Error("X 草稿记录已改变，请重新发起同步")
        const images = task.assets.filter(asset => !checkpoint.skippedImages.includes(asset.id) && checkpoint.images[asset.id])
          .map(asset => ({ uploadId: checkpoint.images[asset.id]!.id, fileName: asset.fileName, mimeType: asset.mimeType }))
        if (JSON.stringify(input.images) !== JSON.stringify(images)) throw new Error("X 图片记录校验失败")
      }
      const results = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: runXPostComposerInPage, args: [input] })
      const result = results[0]?.result
      if (!result) throw new Error("X 编辑窗口未返回装载结果")
      return result
    }
    case "GET_X_PUBLIC_SCRIPT": {
      const source = sender.url ? new URL(sender.url) : null
      if (!source || source.protocol !== "https:" || !["x.com", "twitter.com"].includes(source.hostname) || !xPublicScriptUrl(message.url)) {
        throw new Error("X 公开脚本请求来源无效")
      }
      const response = await fetch(message.url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(20_000) })
      if (!response.ok || Number(response.headers.get("content-length")) > 10 * 1024 * 1024) throw new Error("X 公开脚本读取失败")
      const text = await response.text()
      if (text.length > 10 * 1024 * 1024) throw new Error("X 公开脚本超出大小限制")
      return text
    }
    case "PLATFORM_PROGRESS": {
      const summary = await getTaskSummary(message.taskId)
      const state = summary?.platforms[message.platformId]
      if (!state || sender.tab?.id !== state.tabId || state.status !== "filling") return false
      await setPlatformStatus(message.taskId, message.platformId, "filling", { message: message.message.slice(0, 200) })
      return true
    }
    case "GET_ASSET_DATA": {
      const runtime = await ensureRuntime(message.taskId)
      const asset = runtime.task.assets.find(candidate => candidate.id === message.asset.id)
      if (!asset) throw new Error("任务中找不到该图片")
      return blobToDataUrl(await runtime.readAsset(asset))
    }
    case "GET_ASSET_CHUNK": {
      const summary = await getTaskSummary(message.taskId)
      const senderTabId = sender.tab?.id
      if (senderTabId === undefined) throw new Error("附件读取来源无效")
      const owner = Object.values(summary?.platforms ?? {}).find(state => state.tabId === senderTabId)
      if (!owner || !(summary?.targets ?? []).includes(owner.platformId)) throw new Error("附件读取来源无效")
      const runtime = await ensureRuntime(message.taskId)
      const asset = taskForPlatform(runtime.task, owner.platformId).assets.find(item => item.id === message.assetId)
      if (!asset || !Number.isSafeInteger(message.offset) || message.offset < 0 || message.offset >= asset.size) throw new Error("附件分片无效")
      const key = `${message.taskId}:${asset.id}`
      let blob = assetBlobs.get(key)
      if (!blob) {
        blob = await runtime.readAsset(asset)
        if (blob.size !== asset.size) throw new Error("附件不完整，请重新添加后同步")
        assetBlobs.set(key, blob)
      }
      const dataUrl = await blobToDataUrl(blob.slice(message.offset, message.offset + 512 * 1024))
      const end = Math.min(blob.size, message.offset + 512 * 1024)
      if (end === blob.size) assetBlobs.delete(key)
      return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), end }
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
      const dataUrl = await blobToDataUrl(await runtime.readAsset(asset))
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
  void platformLoginMonitor.tabClosed(tabId).catch(() => undefined)
  void (async () => {
    const summary = await getTaskSummary()
    if (!summary) return
    const entry = Object.values(summary.platforms).find(state => state.tabId === tabId)
    if (!entry || entry.status === "cancelled") return
    if (["ready", "failed", "login_required"].includes(entry.status)) {
      await clearPlatformTab(summary.taskId, entry.platformId)
      return
    }
    const runtime = await ensureRuntime(summary.taskId).catch(() => null)
    if (runtime) await reportStatus(runtime, entry.platformId, "cancelled", { message: "平台标签页已关闭" })
  })()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) void platformLoginMonitor.tabChanged(tabId).catch(() => undefined)
  if (changeInfo.url?.startsWith("https://api.wesight.ai/oauth/desktop/complete?")
    || changeInfo.url?.startsWith(chrome.runtime.getURL("tabs/auth-callback.html") + "?")) {
    void completeWeSightLogin(tabId, changeInfo.url).catch(() => undefined)
  }
  if (changeInfo.status !== "complete") return
  void prepareXiaohongshuOnCompletedTab(tabId, tab.url)
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void platformLoginMonitor.tabChanged(tabId).catch(() => undefined)
})
void platformLoginMonitor.resume().catch(() => undefined)

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === BRIDGE_HEARTBEAT_ALARM) void bridgeConnection.refresh().catch(() => undefined)
})
chrome.runtime.onStartup.addListener(() => { void bridgeConnection.resume().catch(() => undefined) })
chrome.runtime.onInstalled.addListener(() => { void bridgeConnection.resume().catch(() => undefined) })
void bridgeConnection.resume().catch(() => undefined)
