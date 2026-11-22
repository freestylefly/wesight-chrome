import type { ARTICLE_TECH_PLATFORMS } from "~platforms/catalog/article-tech"
import type { PlatformAdapter } from "~platforms/types"

/** 国内技术社区文章（批 1a）: one adapter per catalog entry in platforms/catalog/article-tech.ts. */
export const ARTICLE_TECH_ADAPTERS: Record<(typeof ARTICLE_TECH_PLATFORMS)[number]["id"], PlatformAdapter> = {
}
