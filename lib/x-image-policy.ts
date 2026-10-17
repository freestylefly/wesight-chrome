import type { PublishAssetV1 } from "~types/protocol"

const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])
const UNSUPPORTED_EXTENSION = /\.(?:gif|svg|avif|bmp|ico|tiff?|heic|heif)(?:$|[?#])/i

export class XUnsupportedImageError extends Error {
  constructor(fileName: string) {
    super(`X 图片“${fileName}”格式不支持，仅支持 PNG、JPEG 或 WebP`)
    this.name = "XUnsupportedImageError"
  }
}

/** Shared by preflight, upload counts and the X adapter; leaves the source article intact. */
export function supportedXImages(sources: readonly string[], cover: string | null, assets: readonly PublishAssetV1[]) {
  const byId = new Map(assets.map(asset => [asset.id, asset]))
  const unsupported = (source: string) => {
    const asset = byId.get(source.replace(/^wesight-asset:\/\//, ""))
    const mimeType = asset?.mimeType.split(";", 1)[0]?.trim().toLowerCase()
    return UNSUPPORTED_EXTENSION.test(asset?.fileName ?? source)
      || !!(mimeType && mimeType !== "application/octet-stream" && !SUPPORTED_TYPES.has(mimeType))
  }
  const skipped = new Set([...sources, ...(cover ? [cover] : [])].filter(unsupported))
  return {
    sources: sources.filter(source => !skipped.has(source)),
    cover: cover && !skipped.has(cover) ? cover : null,
    skipped
  }
}

/** Inspect bytes before INIT so an incorrectly labelled GIF cannot reach X's upload API. */
export async function xImageMimeType(file: File): Promise<string> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error(`无法读取图片“${file.name}”`))
    reader.readAsArrayBuffer(file.slice(0, 12))
  })
  const bytes = new Uint8Array(buffer)
  const startsWith = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp"
  throw new XUnsupportedImageError(file.name)
}
