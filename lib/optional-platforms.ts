import { PLATFORM_CATALOG, findPlatformDefinition, hostPatterns, type PlatformDefinition } from "~platforms/catalog"
import type { PlatformId } from "~types/protocol"

const OPTIONAL_SCRIPT_ID = "wesight-optional-platforms"
/** A host that only the static platform content script matches. */
const STATIC_SCRIPT_MARKER = "https://zhuanlan.zhihu.com/*"

function originsFor(platformIds: readonly PlatformId[]): string[] {
  return [...new Set(platformIds.flatMap(id => {
    const definition = findPlatformDefinition(id)
    return definition?.permission === "optional" ? hostPatterns(definition) : []
  }))]
}

/** Optional platforms among the ids whose site access has not been granted yet. */
export async function platformsMissingPermission(platformIds: readonly PlatformId[]): Promise<PlatformId[]> {
  const missing: PlatformId[] = []
  for (const id of platformIds) {
    const origins = originsFor([id])
    if (origins.length && !(await chrome.permissions.contains({ origins }))) missing.push(id)
  }
  return missing
}

/**
 * Ask for site access to newly selected optional platforms. Must run in an
 * extension page directly from a user gesture (Chrome rejects it otherwise).
 */
export async function requestPlatformPermissions(platformIds: readonly PlatformId[]): Promise<boolean> {
  const origins = originsFor(platformIds)
  if (!origins.length) return true
  return chrome.permissions.request({ origins })
}

/**
 * Fail early when an optional platform lacks site access, and make sure its
 * content script is registered before the caller opens a tab for it.
 */
/** Start of every "site access missing" failure message; the publish center keys its 授权并重试 button on it. */
export const PERMISSION_MISSING_TEXT = "尚未授权访问"

export function isPermissionFailure(message: string | undefined): boolean {
  return Boolean(message?.includes(PERMISSION_MISSING_TEXT))
}

export class PlatformPermissionError extends Error {
  constructor(readonly platformId: PlatformId, label: string) {
    super(`${PERMISSION_MISSING_TEXT}${label}，请在 WeSight 发布中心点“授权并重试”`)
    this.name = "PlatformPermissionError"
  }
}

export async function assertPlatformPermission(platformId: PlatformId, label: string): Promise<void> {
  if ((await platformsMissingPermission([platformId])).length) throw new PlatformPermissionError(platformId, label)
  if (findPlatformDefinition(platformId)?.permission === "optional") await syncOptionalContentScripts()
}

function staticPlatformScript(): { js: string[]; matches: string[] } | null {
  const entry = chrome.runtime.getManifest().content_scripts?.find(script => script.matches?.includes(STATIC_SCRIPT_MARKER))
  return entry?.js?.length ? { js: entry.js, matches: entry.matches ?? [] } : null
}

async function registerOptionalContentScripts(): Promise<void> {
  const script = staticPlatformScript()
  // Hosts the manifest script already covers must not get a second copy,
  // or both copies would answer PREPARE_DRAFT and fill the draft twice.
  const covered = new Set(script?.matches ?? [])
  const granted: string[] = []
  for (const definition of PLATFORM_CATALOG as readonly PlatformDefinition[]) {
    if (definition.permission !== "optional") continue
    const origins = hostPatterns(definition)
    if (await chrome.permissions.contains({ origins })) granted.push(...origins.filter(origin => !covered.has(origin)))
  }
  const matches = [...new Set(granted)]
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [OPTIONAL_SCRIPT_ID] })
  if (!script || !matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [OPTIONAL_SCRIPT_ID] })
    return
  }
  const registration = { id: OPTIONAL_SCRIPT_ID, js: script.js, matches, runAt: "document_idle" as const, persistAcrossSessions: true }
  if (existing.length) await chrome.scripting.updateContentScripts([registration])
  else await chrome.scripting.registerContentScripts([registration])
}

let syncing: Promise<void> = Promise.resolve()

/**
 * Register the platform content script for every granted optional platform.
 * Runs on startup, on permission changes and before opening a task tab; calls
 * are serialized so overlapping events never race on the same script id.
 */
export function syncOptionalContentScripts(): Promise<void> {
  const next = syncing.catch(() => undefined).then(registerOptionalContentScripts)
  syncing = next
  return next
}
