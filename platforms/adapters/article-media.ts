import type { ARTICLE_MEDIA_PLATFORMS } from "~platforms/catalog/article-media"
import type { PlatformAdapter } from "~platforms/types"

/** 国内自媒体号文章（批 1b）: one adapter per catalog entry in platforms/catalog/article-media.ts. */
export const ARTICLE_MEDIA_ADAPTERS: Record<(typeof ARTICLE_MEDIA_PLATFORMS)[number]["id"], PlatformAdapter> = {
}
