import type { OVERSEAS_PLATFORMS } from "~platforms/catalog/overseas"
import type { PlatformAdapter } from "~platforms/types"

/** 海外动态与文章（批 3）: one adapter per catalog entry in platforms/catalog/overseas.ts. */
export const OVERSEAS_ADAPTERS: Record<(typeof OVERSEAS_PLATFORMS)[number]["id"], PlatformAdapter> = {
}
