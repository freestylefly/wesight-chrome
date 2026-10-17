import { buildComposeTask, validateComposeTargets } from "~lib/compose-task"
import type { ComposeDraft } from "~lib/draft-store"
import { isPublishTaskV1 } from "~types/protocol"

const COVER = "c".repeat(64)
const BODY = "b".repeat(64)
const UNUSED = "d".repeat(64)

function draft(): ComposeDraft {
  const asset = (id: string) => ({ id, fileName: `${id.slice(0, 4)}.png`, mimeType: "image/png", size: 3, sha256: id })
  return {
    id: "draft-1",
    source: { kind: "url", url: "https://example.com/post" },
    title: "  发布中心测试  ",
    digest: "摘要",
    markdown: `第一段\n\n![图](wesight-asset://${BODY})\n\n第二段`,
    html: `<p>第一段</p><p><img src="wesight-asset://${BODY}" alt="图"></p><p>第二段</p>`,
    coverAssetId: COVER,
    tags: ["AI"],
    assets: [asset(COVER), asset(BODY), asset(UNUSED)],
    warnings: [],
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

describe("publish center tasks", () => {
  test("builds a valid manual task with only the images it uses", () => {
    const task = buildComposeTask(draft(), ["zhihu", "juejin"], { taskId: "t1", keepImages: true, maxTargets: null })
    expect(isPublishTaskV1(task)).toBe(true)
    expect(task.article.title).toBe("发布中心测试")
    expect(task.targets).toEqual(["zhihu", "juejin"])
    expect(task.assets.map(asset => asset.id)).toEqual([COVER, BODY])
    expect(task.source.vaultPath).toBe("https://example.com/post")
  })

  test("drops body images but keeps the cover when images are turned off", () => {
    const task = buildComposeTask(draft(), ["csdn"], { taskId: "t2", keepImages: false, maxTargets: 1 })
    expect(task.article.markdown).toBe("第一段\n\n第二段")
    expect(task.article.html).not.toContain("<img")
    expect(task.assets.map(asset => asset.id)).toEqual([COVER])
    expect(task.article.coverAssetId).toBe(COVER)
  })

  test("enforces the membership limit and article platforms", () => {
    expect(() => validateComposeTargets(["zhihu", "csdn"], 1)).toThrow("非会员仅支持一个平台")
    expect(() => validateComposeTargets(["zhihu"], 0)).toThrow("登录 WeSight")
    expect(() => validateComposeTargets(["xiaohongshu"], null)).toThrow("不支持")
    expect(() => validateComposeTargets([], null)).toThrow("至少选择")
    expect(validateComposeTargets(["toutiao", "toutiao"], 1)).toEqual(["toutiao"])
  })

  test("requires a title", () => {
    expect(() => buildComposeTask({ ...draft(), title: " " }, ["zhihu"], { taskId: "t3", keepImages: true, maxTargets: null }))
      .toThrow("标题")
  })

  test("protocol accepts compose metadata and rejects malformed limits", () => {
    const task = buildComposeTask(draft(), ["zhihu"], { taskId: "t4", keepImages: true, maxTargets: null })
    expect(isPublishTaskV1({ ...task, compose: { maxTargets: 1 } })).toBe(true)
    expect(isPublishTaskV1({ ...task, compose: { maxTargets: null } })).toBe(true)
    expect(isPublishTaskV1({ ...task, compose: { maxTargets: -1 } })).toBe(false)
    expect(isPublishTaskV1({ ...task, compose: {} })).toBe(false)
  })
})
