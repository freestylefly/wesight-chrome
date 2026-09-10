import { BRIDGE_CAPABILITIES, createInitialPlatformStates, isPublishTaskV1, MAX_ASSET_BYTES, PLATFORM_IDS, PROTOCOL_VERSION } from "~types/protocol"

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
  test("keeps protocol v1 while accepting all nine platform ids", () => {
    expect(PLATFORM_IDS).toEqual([
      "zhihu", "csdn", "juejin", "bilibili-article", "toutiao", "weibo-article", "xiaohongshu", "weibo-post", "jike-post"
    ])
    expect(isPublishTaskV1({ ...task(), targets: [...PLATFORM_IDS] })).toBe(true)
  })
  test("accepts isolated payloads for every selected platform", () => {
    const asset = { id: "image-1", fileName: "image.png", mimeType: "image/png", size: 3, sha256: "a".repeat(64) }
    const article = { title: "小红书标题", digest: "摘要", markdown: "小红书正文", html: "<p>小红书正文</p>", coverAssetId: "image-1", tags: ["AI"] }
    const batch = {
      ...task(),
      assets: [asset],
      targets: ["xiaohongshu", "weibo-post"],
      targetPayloads: {
        xiaohongshu: { article, assetIds: ["image-1"] },
        "weibo-post": {
          article: { ...article, title: "微博标题", markdown: "微博正文", html: "<p>微博正文</p>" },
          assetIds: ["image-1"]
        }
      }
    }
    expect(BRIDGE_CAPABILITIES).toContain("target-payloads-v1")
    expect(isPublishTaskV1(batch)).toBe(true)
    expect(isPublishTaskV1({
      ...batch,
      targetPayloads: { xiaohongshu: batch.targetPayloads.xiaohongshu }
    })).toBe(false)
    expect(isPublishTaskV1({
      ...batch,
      targetPayloads: {
        ...batch.targetPayloads,
        "weibo-post": { ...batch.targetPayloads["weibo-post"], assetIds: ["missing"] }
      }
    })).toBe(false)
  })
})
