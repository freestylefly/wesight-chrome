export const PROTOCOL_VERSION = 1 as const
export const TASK_TTL_MS = 10 * 60 * 1000
export const MAX_ASSET_BYTES = 10 * 1024 * 1024
export const MAX_TASK_BYTES = 100 * 1024 * 1024
export const BRIDGE_CAPABILITIES = ["target-payloads-v1", "compose-v1", "dynamic-compose-v1", "bridge-connect-v1"] as const
export const DYNAMIC_PLATFORM_IDS = ["xiaohongshu", "weibo-post", "jike-post", "x-post"] as const
export type DynamicPlatformId = typeof DYNAMIC_PLATFORM_IDS[number]
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024

export const ARTICLE_PLATFORM_IDS = [
  "zhihu",
  "csdn",
  "juejin",
  "bilibili-article",
  "toutiao",
  "weibo-article",
  "x-article"
] as const

export const PLATFORM_IDS = [
  "zhihu",
  "csdn",
  "juejin",
  "bilibili-article",
  "toutiao",
  "weibo-article",
  "x-article",
  "xiaohongshu",
  "weibo-post",
  "jike-post",
  "x-post"
] as const
export type PlatformId = (typeof PLATFORM_IDS)[number]
export type ArticlePlatformId = (typeof ARTICLE_PLATFORM_IDS)[number]

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
  xArticle?: {
    skipExcessImages: boolean
  }
  xPost?: {
    includeTitle: boolean
  }
  jikePost?: {
    circle: string
  }
}

export interface PublishTargetPayloadV1 {
  article: PublishArticleV1
  assetIds: string[]
  targetOptions?: PublishTargetOptionsV1
}

// Compose tasks hand an article to the publish center; the user picks
// platforms in the extension instead of in Obsidian.
export interface PublishComposeV1 {
  maxTargets: number | null
  kind?: "article" | "dynamic"
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
  compose?: PublishComposeV1
  media?: { videoAssetId: string }
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
  compose?: boolean
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

export function isArticlePlatformId(value: unknown): value is ArticlePlatformId {
  return typeof value === "string" && ARTICLE_PLATFORM_IDS.includes(value as ArticlePlatformId)
}

function isCompose(value: unknown): value is PublishComposeV1 {
  if (!isRecord(value)) return false
  if (value.kind !== undefined && value.kind !== "article" && value.kind !== "dynamic") return false
  return value.maxTargets === null
    || (typeof value.maxTargets === "number" && Number.isInteger(value.maxTargets) && value.maxTargets >= 0)
}

function isTargetOptions(value: unknown): value is PublishTargetOptionsV1 {
  if (!isRecord(value)) return false
  if (value.xArticle !== undefined && (!isRecord(value.xArticle) || typeof value.xArticle.skipExcessImages !== "boolean")) return false
  if (value.xPost !== undefined && (!isRecord(value.xPost) || typeof value.xPost.includeTitle !== "boolean")) return false
  if (value.jikePost === undefined) return true
  return isRecord(value.jikePost) && typeof value.jikePost.circle === "string"
}

/** Returns a user-facing reason without exposing task tokens or article contents. */
export function getPublishTaskValidationError(value: unknown, now = Date.now()): string | null {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION) return "任务协议版本不兼容，请更新 Obsidian 插件和浏览器扩展"
  if (typeof value.taskId !== "string" || !value.taskId) return "任务编号无效，请从 Obsidian 重新发送文章"
  if (typeof value.createdAt !== "string" || typeof value.expiresAt !== "string") return "任务时间格式无效，请从 Obsidian 重新发送文章"
  const createdAt = Date.parse(value.createdAt)
  const expiresAt = Date.parse(value.expiresAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return "任务时间格式无效，请从 Obsidian 重新发送文章"
  if (expiresAt <= createdAt || expiresAt - createdAt > TASK_TTL_MS) return "任务有效期设置无效，请更新 Obsidian 插件后重新发送"
  if (expiresAt <= now) return "任务已过期，请回到 Obsidian 重新发送文章"
  if (!isRecord(value.source) || typeof value.source.vaultPath !== "string" || typeof value.source.contentHash !== "string") return "任务来源信息不完整，请从 Obsidian 重新发送文章"
  if (!isPublishArticle(value.article)) return "文章标题或正文格式不完整，请检查文章后重新发送"
  if (value.targetOptions !== undefined && !isTargetOptions(value.targetOptions)) return "平台同步选项无效，请更新 Obsidian 插件后重新发送"
  if (!Array.isArray(value.assets) || !value.assets.every(asset => {
    if (!isRecord(asset)) return false
    return typeof asset.id === "string"
      && typeof asset.fileName === "string"
      && typeof asset.mimeType === "string"
      && typeof asset.size === "number"
      && asset.size >= 0
      && asset.size <= (String(asset.mimeType).startsWith("video/") ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES)
      && typeof asset.sha256 === "string"
      && /^[a-f0-9]{64}$/i.test(asset.sha256)
  })) return "文章图片信息无效或单张图片超过 10 MB，请检查图片后重新发送"
  if (value.assets.reduce((total, asset) => total + Number((asset as { size: number }).size), 0) > (value.media ? MAX_VIDEO_BYTES : MAX_TASK_BYTES)) return "附件总大小超过上限，请减少附件后重试"
  const videos = value.assets.filter(asset => String(asset.mimeType).startsWith("video/"))
  if (value.media !== undefined && (!isRecord(value.media) || typeof value.media.videoAssetId !== "string"
    || videos.length !== 1 || videos[0]!.id !== value.media.videoAssetId || value.assets.length !== 1)) return "视频附件信息无效，请重新添加视频"
  if (videos.length && value.media === undefined) return "视频附件缺少发布信息"
  if (new Set(value.assets.map(asset => (asset as { id: string }).id)).size !== value.assets.length) return "文章图片清单包含重复图片，请更新 Obsidian 插件后重新发送"
  if (!Array.isArray(value.targets) || value.targets.length === 0 || !value.targets.every(isPlatformId)) return "任务包含不支持的平台，请更新 Obsidian 插件和浏览器扩展"
  if (new Set(value.targets).size !== value.targets.length) return "任务平台清单重复，请从 Obsidian 重新发送文章"
  if (videos.length && !value.targets.every(target => DYNAMIC_PLATFORM_IDS.includes(target as DynamicPlatformId))) return "视频仅支持动态发布平台"
  if (value.targetPayloads !== undefined) {
    if (!isRecord(value.targetPayloads) || !Object.keys(value.targetPayloads).every(isPlatformId)) return "平台文章内容格式无效，请更新 Obsidian 插件后重新发送"
    const assetIds = new Set(value.assets.map(asset => (asset as { id: string }).id))
    for (const platformId of value.targets) {
      const payload = value.targetPayloads[platformId]
      if (!isRecord(payload) || !isPublishArticle(payload.article)) return "部分平台的文章内容不完整，请从 Obsidian 重新发送文章"
      if (!Array.isArray(payload.assetIds)
        || !payload.assetIds.every(assetId => typeof assetId === "string" && assetIds.has(assetId))) return "部分平台引用的图片不存在，请从 Obsidian 重新发送文章"
      if (new Set(payload.assetIds).size !== payload.assetIds.length) return "平台图片清单包含重复图片，请更新 Obsidian 插件后重新发送"
      if (payload.article.coverAssetId !== null && !payload.assetIds.includes(payload.article.coverAssetId)) return "部分平台的封面图片不存在，请从 Obsidian 重新发送文章"
      if (payload.targetOptions !== undefined && !isTargetOptions(payload.targetOptions)) return "平台同步选项无效，请更新 Obsidian 插件后重新发送"
    }
  }
  if (value.compose !== undefined && !isCompose(value.compose)) return "发布中心配置无效，请更新 Obsidian 插件后重新发送"
  if (!isRecord(value.behavior) || value.behavior.finalAction !== "manual" || value.behavior.groupTabs !== true) return "任务发布方式不受支持，请更新 Obsidian 插件后重新发送"
  return null
}

export function isPublishTaskV1(value: unknown, now = Date.now()): value is PublishTaskV1 {
  return getPublishTaskValidationError(value, now) === null
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
