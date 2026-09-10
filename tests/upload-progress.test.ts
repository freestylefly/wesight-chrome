import { createUploadProgress, uploadAssetsForPlatform } from "~lib/upload-progress"
import type { PublishTaskV1 } from "~types/protocol"

function task(): PublishTaskV1 {
  const bodyAsset = { id: "a".repeat(64), fileName: "正文.png", mimeType: "image/png", size: 3, sha256: "a".repeat(64) }
  const coverAsset = { id: "b".repeat(64), fileName: "封面.png", mimeType: "image/png", size: 3, sha256: "b".repeat(64) }
  return {
    protocolVersion: 1,
    taskId: "task-progress",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    source: { vaultPath: "文章.md", contentHash: "c".repeat(64) },
    article: {
      title: "标题",
      digest: "摘要",
      markdown: `![正文](wesight-asset://${bodyAsset.id})`,
      html: `<img src="wesight-asset://${bodyAsset.id}">`,
      coverAssetId: coverAsset.id,
      tags: []
    },
    assets: [bodyAsset, coverAsset],
    targets: ["zhihu", "csdn", "juejin", "bilibili-article"],
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

describe("upload progress", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  test("shows completed image counts and removes itself", () => {
    const progress = createUploadProgress("CSDN 博客", 3)
    const card = document.querySelector<HTMLElement>("#wesight-publish-upload-progress")

    expect(card?.textContent).toContain("正在上传 0/3")
    progress.complete()
    expect(card?.textContent).toContain("正在上传 1/3")
    progress.complete()
    progress.complete()
    expect(card?.textContent).toContain("图片上传完成 3/3")
    expect(card?.querySelector<HTMLElement>("span")?.style.width).toBe("100%")

    progress.remove()
    expect(document.querySelector("#wesight-publish-upload-progress")).toBeNull()
  })

  test("keeps the failed file name visible while parallel uploads settle", () => {
    const progress = createUploadProgress("CSDN 博客", 3)
    const card = document.querySelector<HTMLElement>("#wesight-publish-upload-progress")

    progress.complete()
    progress.fail("第二张图.png")
    progress.complete()

    expect(card?.textContent).toContain("上传失败 2/3 · 第二张图.png")
  })

  test("counts the images each platform actually uploads", () => {
    const fixture = task()

    expect(uploadAssetsForPlatform("csdn", fixture).map(asset => asset.fileName)).toEqual(["正文.png"])
    expect(uploadAssetsForPlatform("juejin", fixture).map(asset => asset.fileName)).toEqual(["正文.png"])
    expect(uploadAssetsForPlatform("zhihu", fixture).map(asset => asset.fileName)).toEqual(["正文.png", "封面.png"])
    expect(uploadAssetsForPlatform("bilibili-article", fixture).map(asset => asset.fileName)).toEqual(["正文.png", "封面.png"])
    expect(uploadAssetsForPlatform("toutiao", fixture).map(asset => asset.fileName)).toEqual(["正文.png", "封面.png"])
    expect(uploadAssetsForPlatform("weibo-article", fixture).map(asset => asset.fileName)).toEqual(["正文.png", "封面.png"])
    expect(uploadAssetsForPlatform("xiaohongshu", fixture).map(asset => asset.fileName)).toEqual(["正文.png", "封面.png"])
    expect(uploadAssetsForPlatform("weibo-post", fixture).map(asset => asset.fileName)).toEqual(["正文.png", "封面.png"])
    expect(uploadAssetsForPlatform("jike-post", fixture).map(asset => asset.fileName)).toEqual(["正文.png", "封面.png"])
  })
})
