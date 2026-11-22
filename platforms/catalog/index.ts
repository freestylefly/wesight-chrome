import { ARTICLE_MEDIA_PLATFORMS } from "~platforms/catalog/article-media"
import { ARTICLE_TECH_PLATFORMS } from "~platforms/catalog/article-tech"
import { CORE_PLATFORMS } from "~platforms/catalog/core"
import { OVERSEAS_PLATFORMS } from "~platforms/catalog/overseas"
import { PODCAST_PLATFORMS } from "~platforms/catalog/podcast"
import { POST_CN_PLATFORMS } from "~platforms/catalog/post-cn"
import type { PlatformDefinition, PlatformGroup } from "~platforms/catalog/types"
import { VIDEO_PLATFORMS } from "~platforms/catalog/video"

export { PLATFORM_GROUPS, type PlatformDefinition, type PlatformGroup } from "~platforms/catalog/types"

/** Order here is the display order inside each group. */
export const PLATFORM_CATALOG = [
  ...CORE_PLATFORMS,
  ...ARTICLE_TECH_PLATFORMS,
  ...ARTICLE_MEDIA_PLATFORMS,
  ...POST_CN_PLATFORMS,
  ...OVERSEAS_PLATFORMS,
  ...VIDEO_PLATFORMS,
  ...PODCAST_PLATFORMS
] as const

type CatalogEntry = (typeof PLATFORM_CATALOG)[number]
export type CatalogPlatformId = CatalogEntry["id"]
export type CatalogGroupId<G extends PlatformGroup> = Extract<CatalogEntry, { group: G }>["id"]

export const CATALOG_IDS = PLATFORM_CATALOG.map(entry => entry.id) as readonly CatalogPlatformId[]

export function catalogIdsInGroup<G extends PlatformGroup>(group: G): readonly CatalogGroupId<G>[] {
  return PLATFORM_CATALOG.filter(entry => entry.group === group).map(entry => entry.id) as CatalogGroupId<G>[]
}

const BY_ID = new Map<string, PlatformDefinition>(PLATFORM_CATALOG.map(entry => [entry.id, entry]))

export function platformDefinition(id: CatalogPlatformId): PlatformDefinition {
  return BY_ID.get(id)!
}

export function findPlatformDefinition(id: string): PlatformDefinition | undefined {
  return BY_ID.get(id)
}

/** Match patterns for a platform's pages, used for permissions and content scripts. */
export function hostPatterns(definition: Pick<PlatformDefinition, "hosts">): string[] {
  return definition.hosts.map(host => `https://${host}/*`)
}
