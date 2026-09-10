export const PROTOCOL_VERSION = 1 as const
export const TASK_TTL_MS = 10 * 60 * 1000
export const MAX_ASSET_BYTES = 10 * 1024 * 1024
export const MAX_TASK_BYTES = 100 * 1024 * 1024
export const BRIDGE_CAPABILITIES = ["target-payloads-v1"] as const

export const PLATFORM_IDS = [
  "zhihu",
  "csdn",
  "juejin",
  "bilibili-article",
  "toutiao",
  "weibo-article",
  "xiaohongshu",
  "weibo-post",
  "jike-post"
] as const
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

export interface PublishArticleV1 {
  title: string
  digest: string
  markdown: string
  html: string
  coverAssetId: string | null
  tags: string[]
  original?: boolean
}

export interface PublishTargetOptionsV1 {
  jikePost?: {
    circle: string
  }
}

export interface PublishTargetPayloadV1 {
  article: PublishArticleV1
  assetIds: string[]
  targetOptions?: PublishTargetOptionsV1
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
  article: PublishArticleV1
  targetOptions?: PublishTargetOptionsV1
  targetPayloads?: Partial<Record<PlatformId, PublishTargetPayloadV1>>
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
  openTask?: boolean
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

function isPublishArticle(value: unknown): value is PublishArticleV1 {
  if (!isRecord(value) || typeof value.title !== "string" || !value.title.trim()) return false
  if (typeof value.digest !== "string" || typeof value.markdown !== "string" || typeof value.html !== "string") return false
  if (!(value.coverAssetId === null || typeof value.coverAssetId === "string")) return false
  if (!Array.isArray(value.tags) || !value.tags.every(tag => typeof tag === "string")) return false
  return value.original === undefined || typeof value.original === "boolean"
}

function isTargetOptions(value: unknown): value is PublishTargetOptionsV1 {
  if (!isRecord(value)) return false
  if (value.jikePost === undefined) return true
  return isRecord(value.jikePost) && typeof value.jikePost.circle === "string"
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
  if (!isPublishArticle(value.article)) return false
  if (value.targetOptions !== undefined && !isTargetOptions(value.targetOptions)) return false
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
  if (value.targetPayloads !== undefined) {
    if (!isRecord(value.targetPayloads) || !Object.keys(value.targetPayloads).every(isPlatformId)) return false
    const assetIds = new Set(value.assets.map(asset => (asset as { id: string }).id))
    for (const platformId of value.targets) {
      const payload = value.targetPayloads[platformId]
      if (!isRecord(payload) || !isPublishArticle(payload.article)) return false
      if (!Array.isArray(payload.assetIds)
        || !payload.assetIds.every(assetId => typeof assetId === "string" && assetIds.has(assetId))) return false
      if (new Set(payload.assetIds).size !== payload.assetIds.length) return false
      if (payload.article.coverAssetId !== null && !payload.assetIds.includes(payload.article.coverAssetId)) return false
      if (payload.targetOptions !== undefined && !isTargetOptions(payload.targetOptions)) return false
    }
  }
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
