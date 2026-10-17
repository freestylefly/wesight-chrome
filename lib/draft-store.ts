import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"
import type { DynamicDraft } from "~lib/dynamic-draft"

const DB_NAME = "wesight-publish"
const DB_VERSION = 1
const DRAFTS = "drafts"
const ASSETS = "assets"
const TASKS = "tasks"
const CURRENT_DRAFT_KEY = "current"

export type DraftSource =
  | { kind: "obsidian"; vaultPath: string }
  | { kind: "file"; fileName: string }
  | { kind: "url"; url: string }

export interface ComposeDraft {
  id: string
  source: DraftSource
  title: string
  digest: string
  markdown: string
  html: string
  coverAssetId: string | null
  coverSelection?: "auto" | "custom" | "none"
  tags: string[]
  original?: boolean
  assets: PublishAssetV1[]
  warnings: string[]
  importedAt: string
  updatedAt: string
}

export interface StoredAsset {
  id: string
  mimeType: string
  bytes: ArrayBuffer
}

interface DraftRow {
  key: string
  draft: ComposeDraft | DynamicDraft
}

let databasePromise: Promise<IDBDatabase> | null = null

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("本地草稿库读写失败"))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("本地草稿库写入失败"))
    transaction.onabort = () => reject(transaction.error ?? new Error("本地草稿库写入已中止"))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(DRAFTS)) database.createObjectStore(DRAFTS, { keyPath: "key" })
      if (!database.objectStoreNames.contains(ASSETS)) database.createObjectStore(ASSETS, { keyPath: "id" })
      if (!database.objectStoreNames.contains(TASKS)) database.createObjectStore(TASKS, { keyPath: "taskId" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error("无法打开本地草稿库"))
    }
  })
  return databasePromise
}

export async function getCurrentDraft(): Promise<ComposeDraft | null> {
  const database = await openDatabase()
  const row = await requestResult<DraftRow | undefined>(
    database.transaction(DRAFTS, "readonly").objectStore(DRAFTS).get(CURRENT_DRAFT_KEY)
  )
  return row?.draft as ComposeDraft ?? null
}

export async function getCurrentDynamicDraft(): Promise<DynamicDraft | null> {
  const database = await openDatabase()
  const row = await requestResult<DraftRow | undefined>(database.transaction(DRAFTS, "readonly").objectStore(DRAFTS).get("dynamic"))
  return row?.draft as DynamicDraft ?? null
}

export async function saveCurrentDynamicDraft(draft: DynamicDraft, assets: StoredAsset[] = []): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([DRAFTS, ASSETS], "readwrite")
  transaction.objectStore(DRAFTS).put({ key: "dynamic", draft } satisfies DraftRow)
  for (const asset of assets) transaction.objectStore(ASSETS).put(asset)
  await transactionDone(transaction)
}

/** Saves the draft and any new image bytes in one transaction. */
export async function saveCurrentDraft(draft: ComposeDraft, assets: StoredAsset[] = []): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([DRAFTS, ASSETS], "readwrite")
  transaction.objectStore(DRAFTS).put({ key: CURRENT_DRAFT_KEY, draft } satisfies DraftRow)
  const assetStore = transaction.objectStore(ASSETS)
  for (const asset of assets) assetStore.put(asset)
  await transactionDone(transaction)
}

export async function getStoredAsset(id: string): Promise<StoredAsset | null> {
  const database = await openDatabase()
  const asset = await requestResult<StoredAsset | undefined>(
    database.transaction(ASSETS, "readonly").objectStore(ASSETS).get(id)
  )
  return asset ?? null
}

export async function saveLocalTask(task: PublishTaskV1): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(TASKS, "readwrite")
  const store = transaction.objectStore(TASKS)
  // Only the latest publish-center task is resumable, matching the single
  // task summary kept in chrome.storage.
  store.clear()
  store.put(task)
  await transactionDone(transaction)
}

export async function getLocalTask(taskId: string): Promise<PublishTaskV1 | null> {
  const database = await openDatabase()
  const task = await requestResult<PublishTaskV1 | undefined>(
    database.transaction(TASKS, "readonly").objectStore(TASKS).get(taskId)
  )
  return task ?? null
}

/** Removes image bytes no longer referenced by the current draft or task. */
export async function pruneAssets(): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([DRAFTS, ASSETS, TASKS], "readwrite")
  const drafts = await requestResult<DraftRow[]>(transaction.objectStore(DRAFTS).getAll())
  const tasks = await requestResult<PublishTaskV1[]>(transaction.objectStore(TASKS).getAll())
  const keep = new Set<string>([
    ...drafts.flatMap(row => "media" in row.draft ? row.draft.media.map(asset => asset.id) : row.draft.assets.map(asset => asset.id)),
    ...tasks.flatMap(task => task.assets.map(asset => asset.id))
  ])
  const assetStore = transaction.objectStore(ASSETS)
  const keys = await requestResult<IDBValidKey[]>(assetStore.getAllKeys())
  for (const key of keys) {
    if (typeof key === "string" && !keep.has(key)) assetStore.delete(key)
  }
  await transactionDone(transaction)
}
