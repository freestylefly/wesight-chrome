import type { POST_CN_PLATFORMS } from "~platforms/catalog/post-cn"
import type { PlatformAdapter } from "~platforms/types"

/** 国内动态（批 2）: one adapter per catalog entry in platforms/catalog/post-cn.ts. */
export const POST_CN_ADAPTERS: Record<(typeof POST_CN_PLATFORMS)[number]["id"], PlatformAdapter> = {
}
