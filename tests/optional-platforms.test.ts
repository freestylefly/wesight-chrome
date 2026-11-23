import { afterEach, describe, expect, it, vi } from "vitest"

import { postTextLength } from "~lib/dynamic-draft"
import { syncOptionalContentScripts } from "~lib/optional-platforms"

const STATIC_MATCHES = ["https://www.zhihu.com/*", "https://zhuanlan.zhihu.com/*", "https://juejin.cn/*", "https://passport.juejin.cn/*", "https://mp.toutiao.com/*", "https://sso.toutiao.com/*", "https://passport.bilibili.com/*"]

function mockChrome(granted: (origin: string) => boolean) {
  const registered: { id: string; matches: string[] }[] = []
  const scripting = {
    getRegisteredContentScripts: vi.fn(async () => registered.map(script => ({ ...script }))),
    registerContentScripts: vi.fn(async (scripts: { id: string; matches: string[] }[]) => {
      await new Promise(resolve => setTimeout(resolve, 5))
      if (registered.some(script => script.id === scripts[0]!.id)) throw new Error("Duplicate script ID")
      registered.push(...scripts)
    }),
    updateContentScripts: vi.fn(async (scripts: { id: string; matches: string[] }[]) => {
      registered.splice(0, registered.length, ...scripts)
    }),
    unregisterContentScripts: vi.fn(async () => { registered.splice(0) })
  }
  vi.stubGlobal("chrome", {
    runtime: { getManifest: () => ({ content_scripts: [{ matches: STATIC_MATCHES, js: ["platform.js"] }] }) },
    permissions: { contains: vi.fn(async ({ origins }: { origins: string[] }) => origins.every(granted)) },
    scripting
  })
  return { registered, scripting }
}

afterEach(() => { vi.unstubAllGlobals() })

describe("optional platform content scripts", () => {
  it("never registers a second copy on hosts the manifest script covers", async () => {
    const { registered } = mockChrome(origin => STATIC_MATCHES.includes(origin) || origin === "https://t.bilibili.com/*")
    await syncOptionalContentScripts()
    const matches = registered[0]?.matches ?? []
    expect(matches).toContain("https://t.bilibili.com/*")
    expect(matches.filter(origin => STATIC_MATCHES.includes(origin))).toEqual([])
  })

  it("registers nothing when only bundled hosts are allowed", async () => {
    const { registered, scripting } = mockChrome(origin => STATIC_MATCHES.includes(origin))
    await syncOptionalContentScripts()
    expect(registered).toEqual([])
    expect(scripting.registerContentScripts).not.toHaveBeenCalled()
  })

  it("serializes overlapping syncs instead of racing on one script id", async () => {
    const { registered, scripting } = mockChrome(() => true)
    await Promise.all([syncOptionalContentScripts(), syncOptionalContentScripts(), syncOptionalContentScripts()])
    expect(registered).toHaveLength(1)
    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(1)
    expect(scripting.updateContentScripts).toHaveBeenCalledTimes(2)
  })
})

describe("postTextLength", () => {
  it("counts an emoji once and includes appended hashtags", () => {
    expect(postTextLength({ body: "hi 👋🏽", tags: [] })).toBe(4)
    expect(postTextLength({ body: "hi", tags: ["#tag", "two"] })).toBe("hi\n\n#tag #two".length)
  })
})
