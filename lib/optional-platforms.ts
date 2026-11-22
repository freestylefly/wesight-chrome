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

export async function assertPlatformPermission(platformId: PlatformId, label: string): Promise<void> {
  if ((await platformsMissingPermission([platformId])).length) {
    throw new Error(`尚未授权访问${label}，请在 WeSight 发布中心勾选该平台并允许访问后重试`)
  }
}

function staticPlatformScript(): string[] | null {
  const entry = chrome.runtime.getManifest().content_scripts?.find(script => script.matches?.includes(STATIC_SCRIPT_MARKER))
  return entry?.js?.length ? entry.js : null
}

/**
 * Register the same platform content script for every optional platform the
 * user has granted. Called on startup and whenever permissions change.
 */
export async function syncOptionalContentScripts(): Promise<void> {
  const js = staticPlatformScript()
  const granted: string[] = []
  for (const definition of PLATFORM_CATALOG as readonly PlatformDefinition[]) {
    if (definition.permission !== "optional") continue
    const origins = hostPatterns(definition)
    if (await chrome.permissions.contains({ origins })) granted.push(...origins)
  }
  const matches = [...new Set(granted)]
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [OPTIONAL_SCRIPT_ID] })
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [OPTIONAL_SCRIPT_ID] })
  if (!js || !matches.length) return
  await chrome.scripting.registerContentScripts([{
    id: OPTIONAL_SCRIPT_ID,
    js,
    matches,
    runAt: "document_idle",
    persistAcrossSessions: true
  }])
}
