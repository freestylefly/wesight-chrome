import "fake-indexeddb/auto"

import { describe, expect, test } from "vitest"

import { buildDynamicTask, createDynamicDraft, dynamicDraftFromTask, dynamicVariant, getDynamicValidationErrors, hasDynamicContent, nextDynamicDraft, type DynamicDraft, type DynamicMedia } from "~lib/dynamic-draft"
import { getCurrentDraft, getCurrentDynamicDraft, getLocalTask, getStoredAsset, pruneAssets, saveCurrentDraft, saveCurrentDynamicDraft, saveLocalTask, type ComposeDraft } from "~lib/draft-store"
import { taskForPlatform } from "~lib/platform-task"
import { DYNAMIC_PLATFORM_IDS, MAX_ASSET_BYTES, MAX_VIDEO_BYTES, getPublishTaskValidationError, isPublishTaskV1 } from "~types/protocol"

const ORIGINAL_DYNAMIC_PLATFORMS = DYNAMIC_PLATFORM_IDS.filter(id => id !== "x-post")

function image(letter: string): DynamicMedia {
  return { id: letter.repeat(64), sha256: letter.repeat(64), fileName: `${letter}.png`, mimeType: "image/png", size: 1, kind: "image" }
}

function draft(overrides: Partial<DynamicDraft> = {}): DynamicDraft {
  return { ...createDynamicDraft(), title: "共享标题", body: "共享正文第一段\n\n第二段", tags: ["AI"], selected: [...ORIGINAL_DYNAMIC_PLATFORMS], media: [image("a"), image("b"), image("c")], ...overrides }
}

function video(): DynamicMedia {
  return { ...image("e"), fileName: "演示.mp4", mimeType: "video/mp4", kind: "video", size: MAX_VIDEO_BYTES, duration: 42, width: 1920, height: 1080 }
}

describe("dynamic draft publishing model", () => {
  test("new content starts a blank draft with a new id and keeps platform choices", () => {
    const previous = draft({ mode: "per-platform", jikeCircle: "AI", selected: ["weibo-post", "x-post"], variants: { "x-post": { title: "", body: "X 文案", tags: [] } } })
    const next = nextDynamicDraft(previous)
    expect(next.id).not.toBe(previous.id)
    expect(next).toMatchObject({ source: { kind: "manual" }, mode: "unified", title: "", body: "", tags: [], media: [], variants: {}, jikeCircle: "", selected: ["weibo-post", "x-post"] })
    expect(next.selected).not.toBe(previous.selected)
    expect(hasDynamicContent(previous)).toBe(true)
    expect(hasDynamicContent(next)).toBe(false)
    expect(hasDynamicContent({ ...next, variants: { "x-post": { title: "", body: " 只有 X ", tags: [] } } })).toBe(true)
  })

  test("shares one copy in unified mode even when an older platform variant exists", () => {
    const input = draft({ variants: { "weibo-post": { title: "旧标题", body: "旧微博正文", tags: ["旧话题"], mediaIds: [] } } })
    const task = buildDynamicTask(input, [...DYNAMIC_PLATFORM_IDS], null)
    expect(isPublishTaskV1(task)).toBe(true)
    for (const platform of DYNAMIC_PLATFORM_IDS) {
      expect(dynamicVariant(input, platform).body).toBe(input.body)
      expect(task.targetPayloads![platform]!.article.markdown).toContain(input.body)
      expect(task.targetPayloads![platform]!.article.markdown).not.toContain("旧微博正文")
      expect(task.targetPayloads![platform]!.article.tags).toEqual(["AI"])
      expect(task.targetPayloads![platform]!.assetIds).toEqual(input.media.map(item => item.id))
    }
    expect(task.behavior).toEqual({ finalAction: "manual", groupTabs: true })
  })

  test("keeps all four copies, topics, image order, and circle independent", () => {
    const [first, second, third] = [image("a"), image("b"), image("c")]
    const input = draft({
      mode: "per-platform",
      media: [first!, second!, third!, image("d")],
      jikeCircle: " AI 探索站 ",
      variants: {
        xiaohongshu: { title: "小红书标题", body: "小红书正文", tags: ["小红书话题"], mediaIds: [third!.id, first!.id] },
        "weibo-post": { title: "微博标题", body: "微博独立正文", tags: ["微博话题"], mediaIds: [second!.id] },
        "jike-post": { title: "即刻标题", body: "即刻纯文字\n\n保留空行", tags: [], mediaIds: [] },
        "x-post": { title: "", body: "X 独立正文", tags: ["X话题"], mediaIds: [third!.id] }
      }
    })
    const before = JSON.stringify(input)
    const task = buildDynamicTask(input, [...DYNAMIC_PLATFORM_IDS], null)
    expect(isPublishTaskV1(task)).toBe(true)
    expect(task.assets.map(asset => asset.id)).toEqual([first!.id, second!.id, third!.id])
    const xhs = taskForPlatform(task, "xiaohongshu")
    expect(xhs.assets.map(asset => asset.id)).toEqual([third!.id, first!.id])
    expect(xhs.article.coverAssetId).toBe(third!.id)
    expect(xhs.article.markdown).toBe("小红书正文")
    expect(xhs.article.title).toBe("小红书标题")
    expect(xhs.article.tags).toEqual(["小红书话题"])
    expect(taskForPlatform(task, "weibo-post").article.markdown).toContain("微博独立正文")
    expect(taskForPlatform(task, "weibo-post").assets.map(asset => asset.id)).toEqual([second!.id])
    expect(taskForPlatform(task, "jike-post").article.markdown).toBe("即刻纯文字\n\n保留空行")
    expect(taskForPlatform(task, "jike-post").assets).toEqual([])
    expect(taskForPlatform(task, "jike-post").targetOptions?.jikePost?.circle).toBe("AI 探索站")
    expect(taskForPlatform(task, "x-post").article.markdown).toBe("X 独立正文")
    expect(taskForPlatform(task, "x-post").assets.map(asset => asset.id)).toEqual([third!.id])
    expect(taskForPlatform(task, "x-post").targetOptions?.xPost?.includeTitle).toBe(false)
    expect(JSON.stringify(input)).toBe(before)
  })

  test("allows text-only Weibo and Jike with no title or media", () => {
    const input = draft({ title: "", media: [], tags: [], selected: ["weibo-post", "jike-post"] })
    expect(getDynamicValidationErrors(input)).toEqual([])
    const task = buildDynamicTask(input, input.selected, null)
    expect(isPublishTaskV1(task)).toBe(true)
    expect(task.assets).toEqual([])
    expect(task.article.title).toBeTruthy()
    expect(task.article.coverAssetId).toBeNull()
    expect(task.media).toBeUndefined()
  })

  test("keeps X's actual empty title distinct from the protocol placeholder and restores its copy", () => {
    const input = draft({ title: "", body: "Only my post", tags: [], media: [], selected: ["x-post"] })
    const task = buildDynamicTask(input, input.selected, 1)
    const payload = taskForPlatform(task, "x-post")
    expect(payload.article.title).toBe("动态")
    expect(payload.targetOptions?.xPost?.includeTitle).toBe(false)
    expect(payload.article.markdown).toBe("Only my post")
    expect(dynamicDraftFromTask(task).variants["x-post"]?.title).toBe("")
    expect(task.behavior.finalAction).toBe("manual")
    expect(buildDynamicTask({ ...input, title: "Actual title" }, input.selected, 1).targetPayloads?.["x-post"]?.targetOptions?.xPost?.includeTitle).toBe(true)
  })

  test("applies X's supported-image count, byte limit and weighted full-text limit only to X", () => {
    const images = Array.from({ length: 5 }, (_, index) => image(index.toString(16)))
    const input = draft({ title: "", body: "hello", tags: [], media: images, selected: ["x-post"] })
    expect(getDynamicValidationErrors(input).join(" ")).toContain("X 动态最多 4 张")
    const perPlatform = { ...input, selected: ["xiaohongshu", "x-post"] as const, mode: "per-platform" as const, variants: {
      xiaohongshu: { title: "标题", body: "笔记", tags: [], mediaIds: images.map(asset => asset.id) },
      "x-post": { title: "", body: "Post", tags: [], mediaIds: images.slice(0, 4).map(asset => asset.id) }
    } }
    const task = buildDynamicTask({ ...perPlatform, selected: [...perPlatform.selected] }, [...perPlatform.selected], null)
    expect(taskForPlatform(task, "xiaohongshu").assets).toHaveLength(5)
    expect(taskForPlatform(task, "x-post").assets).toHaveLength(4)
    expect(getDynamicValidationErrors({ ...input, media: [{ ...image("a"), size: 5 * 1024 * 1024 + 1 }] }).join(" ")).toContain("5 MB")
    expect(getDynamicValidationErrors({ ...input, media: [], body: "中".repeat(141) }).join(" ")).toContain("当前 282")
    expect(getDynamicValidationErrors({ ...input, media: [], body: "中".repeat(140) })).toEqual([])
    const gif = { ...image("f"), fileName: "animation.gif", mimeType: "image/gif" }
    expect(getDynamicValidationErrors({ ...input, media: [...images.slice(0, 4), gif] })).toEqual([])
    expect(getDynamicValidationErrors({ ...input, body: "", media: [gif] }).join(" ")).toContain("需要文字或支持格式")
  })

  test("blocks X video without limiting the other platforms or X's text-only variant", () => {
    const input = draft({ title: "", body: "post", tags: [], selected: ["x-post"], media: [video()] })
    expect(getDynamicValidationErrors(input).join(" ")).toContain("视频请取消勾选 X")
    expect(getDynamicValidationErrors({ ...input, selected: ["weibo-post"] })).toEqual([])
    expect(getDynamicValidationErrors({ ...input, mode: "per-platform", variants: { "x-post": { title: "", body: "Text only", tags: [], mediaIds: [] } } })).toEqual([])
  })

  test("enforces the login and membership gate while deduplicating selected platforms", () => {
    const input = draft()
    expect(() => buildDynamicTask(input, ["weibo-post"], 0)).toThrow("请先登录")
    expect(() => buildDynamicTask(input, ["weibo-post", "jike-post"], 1)).toThrow("非会员仅支持一个平台")
    expect(buildDynamicTask(input, ["weibo-post", "weibo-post"], 1).targets).toEqual(["weibo-post"])
    expect(buildDynamicTask(input, [...DYNAMIC_PLATFORM_IDS], null).targets).toHaveLength(4)
  })

  test("checks the selected XHS copy's title, body, and required attachment", () => {
    expect(getDynamicValidationErrors(draft({ title: "", selected: ["xiaohongshu"] }))).toContain("小红书需要填写标题")
    expect(getDynamicValidationErrors(draft({ title: "😀".repeat(20), selected: ["xiaohongshu"] }))).toEqual([])
    expect(getDynamicValidationErrors(draft({ title: "😀".repeat(21), selected: ["xiaohongshu"] }))).toContain("小红书标题最多 20 字")
    expect(getDynamicValidationErrors(draft({ body: "字".repeat(1001), selected: ["xiaohongshu"] }))).toContain("小红书正文最多 1000 字")
    expect(getDynamicValidationErrors(draft({ media: [], selected: ["xiaohongshu"] }))).toContain("小红书需要添加图片或视频")
    expect(getDynamicValidationErrors(draft({ media: [{ ...image("a"), size: MAX_ASSET_BYTES + 1 }], selected: ["xiaohongshu"] })).join(" ")).toContain("图片不超过 10 MB")
  })

  test("rejects repeated media references before producing an invalid protocol payload", () => {
    const input = draft({ mode: "per-platform", selected: ["weibo-post"], variants: {
      "weibo-post": { title: "微博标题", body: "正文", tags: [], mediaIds: [image("a").id, image("a").id] }
    } })
    expect(() => buildDynamicTask(input, input.selected, null)).toThrow(/重复/)
  })

  test("applies the nine-image limit to each platform's selection rather than the shared asset union", () => {
    const images = Array.from({ length: 10 }, (_, index) => image(index.toString(16)))
    expect(getDynamicValidationErrors(draft({ media: images.slice(0, 9) }))).toEqual([])
    expect(getDynamicValidationErrors(draft({ media: images })).join(" ")).toMatch(/最多同步 9 张图片/)
    const input = draft({ mode: "per-platform", media: images, variants: {
      xiaohongshu: { title: "图片笔记", body: "正文", tags: [], mediaIds: images.slice(0, 9).map(asset => asset.id) },
      "weibo-post": { title: "", body: "微博正文", tags: [], mediaIds: images.slice(1).map(asset => asset.id) },
      "jike-post": { title: "", body: "即刻正文", tags: [], mediaIds: [] }
    } })
    expect(getDynamicValidationErrors(input)).toEqual([])
    const task = buildDynamicTask(input, input.selected, null)
    expect(task.assets).toHaveLength(10)
    expect(taskForPlatform(task, "xiaohongshu").assets).toHaveLength(9)
    expect(taskForPlatform(task, "weibo-post").assets).toHaveLength(9)
    expect(isPublishTaskV1(task)).toBe(true)
  })

  test("includes automatically appended topics when checking platform content limits", () => {
    const weibo = draft({ body: "字".repeat(1999), tags: ["AI"], selected: ["weibo-post"] })
    expect(getDynamicValidationErrors(weibo).join(" ")).toMatch(/微博.*2000/)
    const xhs = draft({ body: "字".repeat(999), tags: ["AI"], selected: ["xiaohongshu"] })
    expect(getDynamicValidationErrors(xhs).join(" ")).toMatch(/小红书.*1000/)
    // Jike's editor intentionally receives the body without appended topics.
    expect(getDynamicValidationErrors(draft({ body: "字".repeat(2000), tags: ["AI"], selected: ["jike-post"] }))).toEqual([])
  })

  test("accepts a 200 MB video as a dynamic task without converting it to an image", () => {
    const input = draft({ media: [video()] })
    const task = buildDynamicTask(input, [...ORIGINAL_DYNAMIC_PLATFORMS], null)
    expect(getPublishTaskValidationError(task)).toBeNull()
    expect(isPublishTaskV1(task)).toBe(true)
    expect(task.media).toEqual({ videoAssetId: video().id })
    expect(task.assets).toHaveLength(1)
    expect(task.assets[0]!.mimeType).toBe("video/mp4")
    expect(task.assets[0]).not.toHaveProperty("duration")
    for (const platform of ORIGINAL_DYNAMIC_PLATFORMS) {
      expect(task.targetPayloads![platform]!.assetIds).toEqual([video().id])
      expect(task.targetPayloads![platform]!.article.coverAssetId).toBeNull()
      expect(task.targetPayloads![platform]!.article.markdown).not.toContain("![图片]")
    }
    expect(isPublishTaskV1({ ...task, assets: [{ ...task.assets[0]!, size: MAX_VIDEO_BYTES + 1 }] })).toBe(false)
    expect(isPublishTaskV1({ ...task, targets: ["zhihu"], targetPayloads: undefined })).toBe(false)
  })

  test("rejects mixed image/video tasks, missing video metadata, and multiple videos", () => {
    const task = buildDynamicTask(draft({ media: [video()] }), ["weibo-post"], null)
    expect(isPublishTaskV1({ ...task, media: undefined })).toBe(false)
    expect(isPublishTaskV1({ ...task, assets: [...task.assets, image("a")] })).toBe(false)
    expect(() => buildDynamicTask(draft({ media: [video(), image("a")] }), ["weibo-post"], null)).toThrow("多张图片或一个视频")
    expect(() => buildDynamicTask(draft({ media: [video(), { ...video(), id: "f".repeat(64) }] }), ["weibo-post"], null)).toThrow("多张图片或一个视频")
  })

  test("restores all Obsidian payloads, image order, blank lines, and Jike circle", () => {
    const input = draft({ mode: "per-platform", jikeCircle: "AI 探索站", source: { kind: "obsidian", vaultPath: "公众号/原文.md" }, variants: {
      xiaohongshu: { title: "小红书标题", body: "小红书第一段\n\n第二段", tags: ["XHS"], mediaIds: [image("c").id, image("a").id] },
      "weibo-post": { title: "微博标题", body: "微博正文", tags: ["微博话题"], mediaIds: [image("b").id] },
      "jike-post": { title: "即刻标题", body: "即刻正文", tags: [], mediaIds: [] }
    } })
    const task = buildDynamicTask(input, [...ORIGINAL_DYNAMIC_PLATFORMS], null)
    const restored = dynamicDraftFromTask({ ...task, compose: { kind: "dynamic", maxTargets: null } })
    expect(restored.source).toEqual({ kind: "obsidian", vaultPath: "公众号/原文.md" })
    expect(restored.mode).toBe("per-platform")
    expect(restored.selected).toEqual([...ORIGINAL_DYNAMIC_PLATFORMS])
    expect(restored.jikeCircle).toBe("AI 探索站")
    for (const platform of ORIGINAL_DYNAMIC_PLATFORMS) expect(restored.variants[platform]).toEqual(input.variants[platform])
    expect(restored.media.map(item => item.id)).toEqual([image("a").id, image("b").id, image("c").id])
    expect(restored.variants.xiaohongshu!.body).not.toContain("wesight-asset://")
  })

  test("omits video metadata when the selected platform intentionally excludes that attachment", () => {
    const input = draft({ mode: "per-platform", media: [video()], selected: ["weibo-post"], variants: {
      "weibo-post": { title: "", body: "纯文字动态", tags: [], mediaIds: [] }
    } })
    const task = buildDynamicTask(input, input.selected, null)
    expect(task.assets).toEqual([])
    expect(task.media).toBeUndefined()
    expect(isPublishTaskV1(task)).toBe(true)
  })

  test("keeps a text-only platform separate from another platform's video", () => {
    const input = draft({ mode: "per-platform", media: [video()], selected: ["xiaohongshu", "weibo-post"], variants: {
      xiaohongshu: { title: "视频标题", body: "小红书视频正文", tags: [], mediaIds: [video().id] },
      "weibo-post": { title: "", body: "微博只发文字", tags: [], mediaIds: [] }
    } })
    const task = buildDynamicTask(input, input.selected, null)
    expect(isPublishTaskV1(task)).toBe(true)
    expect(taskForPlatform(task, "xiaohongshu").media?.videoAssetId).toBe(video().id)
    expect(taskForPlatform(task, "weibo-post").assets).toEqual([])
    expect(taskForPlatform(task, "weibo-post").media).toBeUndefined()
  })
})

describe("dynamic and article draft persistence", () => {
  test("keeps the two current drafts isolated and prunes only unreferenced bytes", async () => {
    const [articleImage, taskImage, dynamicImage, orphanImage] = [image("a"), image("b"), image("c"), image("d")]
    const now = new Date().toISOString()
    const article: ComposeDraft = {
      id: "article-current", source: { kind: "file", fileName: "文章.md" }, title: "文章标题", digest: "文章摘要", markdown: "文章正文", html: "<p>文章正文</p>", coverAssetId: articleImage!.id,
      assets: [articleImage!], tags: [], warnings: [], importedAt: now, updatedAt: now
    }
    const stored = (asset: DynamicMedia) => ({ id: asset.id, mimeType: asset.mimeType, bytes: new Uint8Array([1]).buffer })
    await saveCurrentDraft(article, [articleImage!, taskImage!, orphanImage!].map(stored))
    const dynamic = draft({ id: "dynamic-current", media: [dynamicImage!], selected: ["weibo-post"] })
    await saveCurrentDynamicDraft(dynamic, [stored(dynamicImage!)])
    const task = buildDynamicTask(draft({ media: [taskImage!], selected: ["weibo-post"] }), ["weibo-post"], null)
    await saveLocalTask(task)

    expect(await getCurrentDraft()).toEqual(article)
    expect(await getCurrentDynamicDraft()).toEqual(dynamic)
    expect((await getLocalTask(task.taskId))?.assets[0]!.id).toBe(taskImage!.id)
    await pruneAssets()
    for (const asset of [articleImage!, taskImage!, dynamicImage!]) expect(await getStoredAsset(asset.id)).not.toBeNull()
    expect(await getStoredAsset(orphanImage!.id)).toBeNull()

    await saveCurrentDraft({ ...article, title: "修改后的文章", assets: [], coverAssetId: null })
    await pruneAssets()
    expect(await getStoredAsset(articleImage!.id)).toBeNull()
    expect(await getStoredAsset(dynamicImage!.id)).not.toBeNull()
    expect(await getCurrentDynamicDraft()).toEqual(dynamic)

    await saveCurrentDynamicDraft({ ...dynamic, body: "修改后的动态", media: [] })
    await pruneAssets()
    expect(await getStoredAsset(dynamicImage!.id)).toBeNull()
    expect(await getStoredAsset(taskImage!.id)).not.toBeNull()
    expect((await getCurrentDraft())?.title).toBe("修改后的文章")
    expect((await getCurrentDynamicDraft())?.body).toBe("修改后的动态")
  })
})
