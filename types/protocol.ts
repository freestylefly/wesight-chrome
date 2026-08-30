export const PROTOCOL_VERSION = 1 as const
export const TASK_TTL_MS = 10 * 60 * 1000
export const MAX_ASSET_BYTES = 10 * 1024 * 1024
export const MAX_TASK_BYTES = 100 * 1024 * 1024

export const PLATFORM_IDS = ["zhihu", "csdn", "juejin", "bilibili-article"] as const
export type PlatformId = (typeof PLATFORM_IDS)[number]

export const PLATFORM_TASK_STATUSES = [
  "queued",
  "opening",
  "login_required",
  "filling",
  "ready",
  "failed",
  "cancelled"
] as const

export type PlatformTaskStatus = (typeof PLATFORM_TASK_STATUSES)[number]

export interface PublishAssetV1 {
  id: string
  fileName: string
  mimeType: string
  size: number
  sha256: string
}

export interface PublishTaskV1 {
  protocolVersion: typeof PROTOCOL_VERSION
  taskId: string
  createdAt: string
  expiresAt: string
  source: {
    vaultPath: string
    contentHash: string
  }
  article: {
    title: string
    digest: string
    markdown: string
    html: string
    coverAssetId: string | null
    tags: string[]
    original?: boolean
  }
  assets: PublishAssetV1[]
  targets: PlatformId[]
  behavior: {
    finalAction: "manual"
    groupTabs: true
  }
}

export interface PlatformTaskEventV1 {
  protocolVersion: typeof PROTOCOL_VERSION
  taskId: string
  platformId: PlatformId
  status: PlatformTaskStatus
  message?: string
  tabId?: number
  draftUrl?: string
  warnings?: string[]
  occurredAt: string
}

export interface BridgeHandoff {
  baseUrl: string
  taskId: string
  taskToken: string
  pairToken?: string
  retryPlatform?: PlatformId
  openPlatform?: PlatformId
}

export interface PlatformTaskState {
  platformId: PlatformId
  status: PlatformTaskStatus
  message?: string
  tabId?: number
  draftUrl?: string
  warnings: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && PLATFORM_IDS.includes(value as PlatformId)
}

export function isPublishTaskV1(value: unknown, now = Date.now()): value is PublishTaskV1 {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION) return false
  if (typeof value.taskId !== "string" || !value.taskId) return false
  if (typeof value.createdAt !== "string" || typeof value.expiresAt !== "string") return false
  const createdAt = Date.parse(value.createdAt)
  const expiresAt = Date.parse(value.expiresAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= now) return false
  if (expiresAt <= createdAt || expiresAt - createdAt > TASK_TTL_MS) return false
  if (!isRecord(value.source) || typeof value.source.vaultPath !== "string" || typeof value.source.contentHash !== "string") return false
  if (!isRecord(value.article) || typeof value.article.title !== "string" || !value.article.title.trim()) return false
  if (typeof value.article.digest !== "string" || typeof value.article.markdown !== "string" || typeof value.article.html !== "string") return false
  if (!(value.article.coverAssetId === null || typeof value.article.coverAssetId === "string")) return false
  if (!Array.isArray(value.article.tags) || !value.article.tags.every(tag => typeof tag === "string")) return false
  if (!Array.isArray(value.assets) || !value.assets.every(asset => {
    if (!isRecord(asset)) return false
    return typeof asset.id === "string"
      && typeof asset.fileName === "string"
      && typeof asset.mimeType === "string"
      && typeof asset.size === "number"
      && asset.size >= 0
      && asset.size <= MAX_ASSET_BYTES
      && typeof asset.sha256 === "string"
      && /^[a-f0-9]{64}$/i.test(asset.sha256)
  })) return false
  if (value.assets.reduce((total, asset) => total + Number((asset as { size: number }).size), 0) > MAX_TASK_BYTES) return false
  if (new Set(value.assets.map(asset => (asset as { id: string }).id)).size !== value.assets.length) return false
  if (!Array.isArray(value.targets) || value.targets.length === 0 || !value.targets.every(isPlatformId)) return false
  if (new Set(value.targets).size !== value.targets.length) return false
  if (!isRecord(value.behavior) || value.behavior.finalAction !== "manual" || value.behavior.groupTabs !== true) return false
  return true
}

export function createInitialPlatformStates(targets: PlatformId[]): Record<PlatformId, PlatformTaskState> {
  return Object.fromEntries(PLATFORM_IDS.map(platformId => [
    platformId,
    {
      platformId,
      status: targets.includes(platformId) ? "queued" : "cancelled",
      warnings: []
    }
  ])) as unknown as Record<PlatformId, PlatformTaskState>
}
