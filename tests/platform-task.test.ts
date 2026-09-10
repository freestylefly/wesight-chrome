import { taskForPlatform } from "~lib/platform-task"
import type { PublishTaskV1 } from "~types/protocol"

function task(): PublishTaskV1 {
  const createdAt = new Date(Date.now() - 1_000)
  return {
    protocolVersion: 1,
    taskId: "batch-1",
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 10 * 60 * 1_000).toISOString(),
    source: { vaultPath: "Article.md", contentHash: "a".repeat(64) },
    article: { title: "默认标题", digest: "默认摘要", markdown: "默认正文", html: "<p>默认正文</p>", coverAssetId: null, tags: [] },
    assets: [
      { id: "first", fileName: "first.png", mimeType: "image/png", size: 1, sha256: "a".repeat(64) },
      { id: "second", fileName: "second.png", mimeType: "image/png", size: 1, sha256: "b".repeat(64) }
    ],
    targets: ["xiaohongshu", "weibo-post", "jike-post"],
    targetPayloads: {
      xiaohongshu: {
        article: { title: "小红书标题", digest: "小红书摘要", markdown: "小红书正文", html: "<p>小红书正文</p>", coverAssetId: "second", tags: ["小红书"] },
        assetIds: ["second", "first"]
      },
      "weibo-post": {
        article: { title: "微博标题", digest: "微博摘要", markdown: "微博正文", html: "<p>微博正文</p>", coverAssetId: "first", tags: ["微博"] },
        assetIds: ["first"]
      },
      "jike-post": {
        article: { title: "即刻标题", digest: "即刻摘要", markdown: "即刻正文", html: "<p>即刻正文</p>", coverAssetId: null, tags: ["即刻"] },
        assetIds: [],
        targetOptions: { jikePost: { circle: "AI 探索站" } }
      }
    },
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

describe("platform task projection", () => {
  test("projects independent copy, image order, and options per platform", () => {
    const xiaohongshu = taskForPlatform(task(), "xiaohongshu")
    expect(xiaohongshu.article.markdown).toBe("小红书正文")
    expect(xiaohongshu.assets.map(asset => asset.id)).toEqual(["second", "first"])

    const weibo = taskForPlatform(task(), "weibo-post")
    expect(weibo.article.markdown).toBe("微博正文")
    expect(weibo.assets.map(asset => asset.id)).toEqual(["first"])

    const jike = taskForPlatform(task(), "jike-post")
    expect(jike.article.markdown).toBe("即刻正文")
    expect(jike.assets).toEqual([])
    expect(jike.targetOptions?.jikePost?.circle).toBe("AI 探索站")
  })

  test("keeps legacy single-platform tasks compatible", () => {
    const legacy = task()
    delete legacy.targetPayloads
    expect(taskForPlatform(legacy, "xiaohongshu")).toBe(legacy)
  })
})
