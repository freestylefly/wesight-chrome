import { PLATFORM_CATALOG, hostPatterns, type PlatformDefinition } from "~platforms/catalog"

export interface DiagnosticEnvironment {
  extensionVersion: string
  buildCommit: string
  buildTime: string
  /** "development" for an unpacked test build, "normal" for a store install. */
  installType: string
  extensionId: string
  browser: string
  os: string
  language: string
  grantedOptionalPlatforms: string[]
  missingOptionalPlatforms: string[]
  obsidianPaired: boolean
  obsidianConnected: boolean
  wesightSignedIn: boolean
  wesightAccountSource: string
  membership: string
  collectedAt: string
}

function browserVersion(): string {
  const agent = navigator.userAgent
  const edge = /Edg\/([\d.]+)/.exec(agent)?.[1]
  if (edge) return `Edge ${edge}`
  const chrome = /Chrome\/([\d.]+)/.exec(agent)?.[1]
  return chrome ? `Chrome ${chrome}` : "unknown"
}

async function installType(): Promise<string> {
  try {
    // getSelf needs no "management" permission.
    const self = await chrome.management.getSelf()
    return self.installType
  } catch {
    return "update_url" in chrome.runtime.getManifest() ? "normal" : "development"
  }
}

export async function collectEnvironment(state: {
  paired: boolean
  connected: boolean
  signedIn: boolean
  source: string | null
  membership: string
}): Promise<DiagnosticEnvironment> {
  const manifest = chrome.runtime.getManifest()
  const platform = await chrome.runtime.getPlatformInfo().catch(() => null)
  const granted: string[] = []
  const missing: string[] = []
  for (const definition of PLATFORM_CATALOG as readonly PlatformDefinition[]) {
    if (definition.permission !== "optional") continue
    const has = await chrome.permissions.contains({ origins: hostPatterns(definition) }).catch(() => false)
    ;(has ? granted : missing).push(definition.id)
  }
  return {
    extensionVersion: manifest.version,
    buildCommit: process.env.PLASMO_PUBLIC_BUILD_COMMIT || "unknown",
    buildTime: process.env.PLASMO_PUBLIC_BUILD_TIME || "unknown",
    installType: await installType(),
    extensionId: chrome.runtime.id,
    browser: browserVersion(),
    os: platform ? `${platform.os} ${platform.arch}` : "unknown",
    language: navigator.language,
    grantedOptionalPlatforms: granted,
    missingOptionalPlatforms: missing,
    obsidianPaired: state.paired,
    obsidianConnected: state.connected,
    wesightSignedIn: state.signedIn,
    wesightAccountSource: state.source ?? "none",
    membership: state.membership,
    collectedAt: new Date().toISOString()
  }
}
