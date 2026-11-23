import type { VIDEO_PLATFORMS } from "~platforms/catalog/video"
import type { PlatformAdapter } from "~platforms/types"

/** 短视频（批 4）: one adapter per catalog entry in platforms/catalog/video.ts. */
export const VIDEO_ADAPTERS: Record<(typeof VIDEO_PLATFORMS)[number]["id"], PlatformAdapter> = {
}
