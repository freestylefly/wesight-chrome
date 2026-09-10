import type { PlatformId, PublishTaskV1 } from "~types/protocol"

export function taskForPlatform(task: PublishTaskV1, platformId: PlatformId): PublishTaskV1 {
  if (!task.targetPayloads) return task
  const payload = task.targetPayloads[platformId]
  if (!payload) throw new Error(`任务缺少 ${platformId} 的平台内容`)

  const assetsById = new Map(task.assets.map(asset => [asset.id, asset]))
  const assets = payload.assetIds.map(assetId => {
    const asset = assetsById.get(assetId)
    if (!asset) throw new Error(`${platformId} 的图片映射已失效`)
    return asset
  })

  return {
    ...task,
    article: payload.article,
    assets,
    targetOptions: payload.targetOptions
  }
}
