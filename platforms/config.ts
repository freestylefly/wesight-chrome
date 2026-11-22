import { PLATFORM_CATALOG, platformDefinition } from "~platforms/catalog"
import type { PlatformId } from "~types/protocol"

export interface PlatformConfigEntry {
  label: string
  shortLabel: string
  editorUrl: string
  titleLimit: number
}

export const PLATFORM_CONFIG = Object.fromEntries(PLATFORM_CATALOG.map(entry => [entry.id, {
  label: entry.label,
  shortLabel: entry.shortLabel,
  editorUrl: entry.editorUrl,
  titleLimit: entry.titleLimit
}])) as Record<PlatformId, PlatformConfigEntry>

export function isXPlatform(platformId: PlatformId | null | undefined): platformId is "x-article" | "x-post" {
  return platformId === "x-article" || platformId === "x-post"
}

/** Platforms sharing one signed-in account on the same site, in catalog order. */
export function accountPlatformIds(platformId: PlatformId): readonly PlatformId[] {
  const key = platformDefinition(platformId).accountKey
  return PLATFORM_CATALOG.filter(entry => entry.accountKey === key).map(entry => entry.id)
}

/** Whether two platforms live on the same site and share a signed-in account. */
export function sameAccountPlatform(a: PlatformId | null | undefined, b: PlatformId | null | undefined): boolean {
  if (!a || !b) return false
  return a === b || platformDefinition(a).accountKey === platformDefinition(b).accountKey
}

/**
 * Keep a task bound to its own adapter while a single-page app changes routes,
 * or when one site hosts several destinations (article, post, video).
 */
export function platformForOwnedPage(reported: PlatformId, owner: PlatformId | undefined, url: string): PlatformId {
  if (!owner || !sameAccountPlatform(reported, owner)) return reported
  try { return sameAccountPlatform(platformFromUrl(url), owner) ? owner : reported } catch { return reported }
}

export function platformFromUrl(url: string): PlatformId | null {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:") return null
  const candidates = PLATFORM_CATALOG.filter(entry => (entry.hosts as readonly string[]).includes(parsed.hostname))
  if (!candidates.length) return null
  const byPath = candidates.find(entry => "paths" in entry
    && (entry.paths as readonly string[]).some(pattern => new RegExp(pattern).test(parsed.pathname)))
  if (byPath) return byPath.id
  return (candidates.find(entry => !("paths" in entry)) ?? candidates[0]!).id
}
