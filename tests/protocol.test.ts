import { createInitialPlatformStates, isPublishTaskV1, MAX_ASSET_BYTES, PROTOCOL_VERSION } from "~types/protocol"

function task() {
  const createdAt = new Date(Date.now() - 1_000)
  return {
    protocolVersion: PROTOCOL_VERSION,
    taskId: "task-1",
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 10 * 60 * 1_000).toISOString(),
    source: { vaultPath: "Article.md", contentHash: "a".repeat(64) },
    article: { title: "标题", digest: "摘要", markdown: "正文", html: "<p>正文</p>", coverAssetId: null, tags: [] },
    assets: [],
    targets: ["zhihu"],
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

describe("publish task protocol", () => {
  test("accepts a valid manual task", () => expect(isPublishTaskV1(task())).toBe(true))
  test("rejects automatic publication and expired tasks", () => {
    expect(isPublishTaskV1({ ...task(), behavior: { finalAction: "publish", groupTabs: true } })).toBe(false)
    expect(isPublishTaskV1({ ...task(), expiresAt: new Date(Date.now() - 1).toISOString() })).toBe(false)
  })
  test("enforces asset size and hash", () => {
    expect(isPublishTaskV1({ ...task(), assets: [{ id: "a", fileName: "a.png", mimeType: "image/png", size: MAX_ASSET_BYTES + 1, sha256: "x" }] })).toBe(false)
  })
  test("starts selected platforms as queued", () => {
    const states = createInitialPlatformStates(["juejin"])
    expect(states.juejin.status).toBe("queued")
    expect(states.zhihu.status).toBe("cancelled")
  })
})
