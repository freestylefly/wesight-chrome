import type { PODCAST_PLATFORMS } from "~platforms/catalog/podcast"
import type { PlatformAdapter } from "~platforms/types"

/** 播客（批 5）: one adapter per catalog entry in platforms/catalog/podcast.ts. */
export const PODCAST_ADAPTERS: Record<(typeof PODCAST_PLATFORMS)[number]["id"], PlatformAdapter> = {
}
