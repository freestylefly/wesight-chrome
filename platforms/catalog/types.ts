/**
 * Pure data describing one publishing destination. Keep this file free of
 * runtime imports: the protocol module, background worker, content scripts and
 * extension pages all derive their platform lists from it.
 */
export type PlatformGroup = "post" | "article" | "video" | "podcast"

export const PLATFORM_GROUPS: readonly { id: PlatformGroup; label: string }[] = [
  { id: "post", label: "动态" },
  { id: "article", label: "文章" },
  { id: "video", label: "短视频" },
  { id: "podcast", label: "播客" }
]

export interface PlatformDefinition {
  /** Wire id shared with the Obsidian plugin. Never rename a shipped id. */
  id: string
  group: PlatformGroup
  label: string
  shortLabel: string
  /** Page the extension opens to prepare a draft. */
  editorUrl: string
  titleLimit: number
  /** Platforms with the same key share one signed-in account (e.g. X article and post). */
  accountKey: string
  /** Exact hostnames whose pages belong to this platform, including its login hosts. */
  hosts: readonly string[]
  /**
   * When several platforms share a hostname, the first one whose pattern
   * matches `pathname + search` wins (e.g. "^/builder/rc/edit\\?(?:.*&)?type=events");
   * a platform without `paths` is the fallback for its hosts.
   */
  paths?: readonly string[]
  /**
   * "bundled" hosts ship in manifest host_permissions and the static content
   * script. "optional" hosts are requested at runtime and the content script is
   * registered dynamically, so adding platforms does not widen install-time access.
   */
  permission: "bundled" | "optional"
  stage: "stable" | "beta"
  media?: {
    /** Maximum images per post or article; omitted means no explicit limit. */
    images?: number
    video?: boolean
    audio?: boolean
    /** The platform rejects text-only posts (e.g. Douyin image-text). */
    requiresMedia?: boolean
  }
  /** Character limit for post bodies, when the platform has one. */
  textLimit?: number
  brand?: { glyph: string; color: string; caption?: string }
  /**
   * Optional JSON "current user" probe the background runs with the user's
   * cookies. Paths are dot-separated. Missing or unexpected data reports "unknown".
   */
  account?: { url: string; name: string; avatar?: string }
}
