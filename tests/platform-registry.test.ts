import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { PLATFORM_CATALOG, type PlatformDefinition } from "~platforms/catalog"
import { CORE_PLATFORMS } from "~platforms/catalog/core"
import { platformFromUrl } from "~platforms/config"
import { PLATFORM_ADAPTERS } from "~platforms/index"
import { PLATFORM_IDS } from "~types/protocol"

const root = process.cwd()
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).manifest as { host_permissions: string[] }
const contentScript = readFileSync(resolve(root, "contents/platform.ts"), "utf8")
const catalog = PLATFORM_CATALOG as readonly PlatformDefinition[]
const coreIds = new Set<string>(CORE_PLATFORMS.map(entry => entry.id))
const GROUP_SUFFIX = { post: "post", article: "article", video: "video", podcast: "podcast" } as const
const REGISTRY_FILE = resolve(root, "docs/platform-registry.json")

/** The file the Obsidian plugin mirrors; regenerate with UPDATE_PLATFORM_REGISTRY=1 pnpm test. */
function exportedRegistry() {
  return {
    note: "Generated from platforms/catalog by tests/platform-registry.test.ts. The Obsidian plugin mirrors these ids.",
    platforms: catalog.map(entry => ({ id: entry.id, group: entry.group, label: entry.label, shortLabel: entry.shortLabel, stage: entry.stage }))
  }
}

describe("platform registry", () => {
  test("ids are unique, kebab-case and typed by group", () => {
    expect(new Set(PLATFORM_IDS).size).toBe(PLATFORM_IDS.length)
    for (const entry of catalog) {
      expect(entry.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      // Shipped ids are frozen; every new id is "<site>-<type>".
      if (!coreIds.has(entry.id)) expect(entry.id.endsWith(`-${GROUP_SUFFIX[entry.group]}`)).toBe(true)
    }
  })

  test("every platform has an adapter bound to its id", () => {
    expect(Object.keys(PLATFORM_ADAPTERS).sort()).toEqual([...PLATFORM_IDS].sort())
    for (const id of PLATFORM_IDS) expect(PLATFORM_ADAPTERS[id].id).toBe(id)
  })

  test("every editor URL routes back to its own platform", () => {
    for (const entry of catalog) {
      expect(new URL(entry.editorUrl).protocol).toBe("https:")
      expect(entry.hosts).toContain(new URL(entry.editorUrl).hostname)
      expect(platformFromUrl(entry.editorUrl)).toBe(entry.id)
      for (const pattern of entry.paths ?? []) expect(() => new RegExp(pattern)).not.toThrow()
    }
  })

  test("bundled hosts ship in the manifest and static content script; optional hosts do not", () => {
    for (const entry of catalog) {
      for (const host of entry.hosts) {
        const pattern = `https://${host}/*`
        if (entry.permission === "bundled") {
          expect(manifest.host_permissions, entry.id).toContain(pattern)
          expect(contentScript, entry.id).toContain(`"${pattern}"`)
        } else {
          const bundledElsewhere = catalog.some(other => other.permission === "bundled" && other.hosts.includes(host))
          if (!bundledElsewhere) expect(manifest.host_permissions, entry.id).not.toContain(pattern)
        }
      }
    }
  })

  test("platforms sharing a host share an account", () => {
    for (const entry of catalog) {
      for (const other of catalog) {
        if (entry.hosts.some(host => other.hosts.includes(host))) expect(other.accountKey, `${entry.id}/${other.id}`).toBe(entry.accountKey)
      }
    }
  })

  test("docs/platform-registry.json matches the catalog", () => {
    const expected = `${JSON.stringify(exportedRegistry(), null, 2)}\n`
    if (process.env.UPDATE_PLATFORM_REGISTRY === "1") writeFileSync(REGISTRY_FILE, expected)
    expect(readFileSync(REGISTRY_FILE, "utf8")).toBe(expected)
  })
})
