import type { PrepareDraftContext } from "~platforms/types"
import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"

/** A video task must never fall through to an image-only uploader. */
export function postVideoAsset(task: PublishTaskV1): PublishAssetV1 | null {
  const videoId = task.media?.videoAssetId
  const videos = task.assets.filter(asset => asset.mimeType.startsWith("video/"))
  if (!videoId && !videos.length) return null
  const asset = task.assets.find(item => item.id === videoId)
  if (!asset || !asset.mimeType.startsWith("video/")) throw new Error("视频附件无效，请重新添加视频")
  if (videos.length !== 1 || task.assets.some(item => item.mimeType.startsWith("image/"))) {
    throw new Error("一条动态支持一个视频，请先移除图片或多余视频")
  }
  return asset
}

export async function postAssetFile(context: PrepareDraftContext, asset: PublishAssetV1): Promise<File> {
  if (context.getAssetBlob) {
    return new File([await context.getAssetBlob(asset)], asset.fileName, { type: asset.mimeType })
  }
  const dataUrl = await context.getAssetData(asset)
  const [header = "", payload = ""] = dataUrl.split(",", 2)
  const binary = header.includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new File([bytes], asset.fileName, { type: asset.mimeType })
}
