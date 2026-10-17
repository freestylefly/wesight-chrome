import { createHmac } from "node:crypto"

import { fetchTask, pingBridge } from "~lib/bridge-client"
import type { PairingRecord } from "~lib/storage"
import type { PublishTaskV1 } from "~types/protocol"

const pairing: PairingRecord = {
  clientId: "a".repeat(32), secret: "b".repeat(64),
  baseUrl: "http://127.0.0.1:34567", pairedAt: new Date().toISOString()
}

function task(): PublishTaskV1 {
  const createdAt = Date.now() - 1_000
  return {
    protocolVersion: 1, taskId: "new-article", createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + 600_000).toISOString(),
    source: { vaultPath: "新文章.md", contentHash: "c".repeat(64) },
    article: { title: "新文章", digest: "", markdown: "正文", html: "<p>正文</p>", coverAssetId: null, tags: [] },
    assets: [], targets: ["zhihu"], compose: { maxTargets: 1 },
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

function respond(value: PublishTaskV1, validSignature = true): void {
  const body = JSON.stringify(value)
  const signature = createHmac("sha256", pairing.secret).update(body).digest("hex")
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
    headers: { "X-WeSight-Signature": validSignature ? signature : "invalid" }
  })))
}

describe("signed bridge task import", () => {
  beforeEach(() => vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.0.0" }) } }))
  afterEach(() => vi.unstubAllGlobals())

  test("accepts a fresh compose task for a new article", async () => {
    const value = task()
    respond(value)
    await expect(fetchTask(pairing.baseUrl, value.taskId, "test-token", pairing)).resolves.toEqual(value)
  })

  test("identifies repeated image ids without reporting an expired task", async () => {
    const value = task()
    const asset = { id: "d".repeat(64), fileName: "image.png", mimeType: "image/png", size: 3, sha256: "d".repeat(64) }
    value.assets = [asset, { ...asset, fileName: "copy.png" }]
    respond(value)
    await expect(fetchTask(pairing.baseUrl, value.taskId, "test-token", pairing))
      .rejects.toThrow("文章图片清单包含重复图片，请更新 Obsidian 插件后重新发送")
  })

  test("reports a genuinely expired task separately", async () => {
    const value = task()
    value.createdAt = new Date(Date.now() - 700_000).toISOString()
    value.expiresAt = new Date(Date.now() - 100_000).toISOString()
    respond(value)
    await expect(fetchTask(pairing.baseUrl, value.taskId, "test-token", pairing))
      .rejects.toThrow("任务已过期，请回到 Obsidian 重新发送文章")
  })

  test("still rejects an invalid signature before trusting the task", async () => {
    respond(task(), false)
    await expect(fetchTask(pairing.baseUrl, "new-article", "test-token", pairing))
      .rejects.toThrow("任务签名校验失败")
  })

  test("bounds a stalled loopback heartbeat so connection checks can recover", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
    })))
    try {
      const ping = pingBridge(pairing)
      await vi.advanceTimersByTimeAsync(4_000)
      await expect(ping).resolves.toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test("a cleared Obsidian pairing is disconnected even when its health endpoint still responds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ protocolVersion: 1, paired: false }))))
    await expect(pingBridge(pairing)).resolves.toBe(false)
  })

  test("accepts a running paired bridge and rejects an unrelated loopback response", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ protocolVersion: 1, paired: true })))
      .mockResolvedValueOnce(new Response("<html>another local server</html>")))
    await expect(pingBridge(pairing)).resolves.toBe(true)
    await expect(pingBridge(pairing)).resolves.toBe(false)
  })
})
