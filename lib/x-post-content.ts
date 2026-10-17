import twitterText from "twitter-text"
import { supportedXImages } from "~lib/x-image-policy"
import type { PublishAssetV1 } from "~types/protocol"

export const X_POST_TEXT_LIMIT = 280
export const X_POST_IMAGE_LIMIT = 4
export const X_POST_IMAGE_BYTES = 5 * 1024 * 1024

/** Topics are not synced to X by default; hashtags typed into the body are kept. */
export function buildXPostText(copy: { title: string; body: string }): string {
  return [copy.title.trim(), copy.body.trim()].filter(Boolean).join("\n\n").normalize("NFC")
}

/** Official X weighting includes CJK, emoji sequences and shortened URLs. */
export function xPostWeightedLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength
}

export function xPostTextError(text: string): string | null {
  if (!text) return null
  const parsed = twitterText.parseTweet(text)
  if (parsed.weightedLength > X_POST_TEXT_LIMIT) return `X 动态最多 ${X_POST_TEXT_LIMIT} 字符（中文通常计 2），当前 ${parsed.weightedLength}；请为 X 单独精简文案`
  return parsed.valid ? null : "X 动态包含无效字符，请检查文案后重试"
}

export function supportedXPostImages(assets: readonly PublishAssetV1[]): { images: PublishAssetV1[]; skipped: PublishAssetV1[] } {
  const plan = supportedXImages(assets.map(asset => `wesight-asset://${asset.id}`), null, assets)
  return {
    images: assets.filter(asset => !plan.skipped.has(`wesight-asset://${asset.id}`)),
    skipped: assets.filter(asset => plan.skipped.has(`wesight-asset://${asset.id}`))
  }
}
