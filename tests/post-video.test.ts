import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { postAssetFile, postVideoAsset } from "~lib/post-media"
import { findPostVideoRoot, uploadPostVideo } from "~platforms/post-video"
import { xiaohongshuAdapter } from "~platforms/xiaohongshu"
import { runXiaohongshuPageTask } from "~platforms/xiaohongshu-runner"
import { weiboPostAdapter } from "~platforms/weibo-post"
import { jikePostAdapter } from "~platforms/jike-post"
import type { PrepareDraftContext } from "~platforms/types"
import type { PlatformId, PublishTaskV1 } from "~types/protocol"

class TestDataTransfer {
  files: File[] = []
  items = { add: (file: File) => this.files.push(file) }
  setData() {}
}

function videoTask(platform: PlatformId = "weibo-post"): PublishTaskV1 {
  return {
    protocolVersion: 1,
    taskId: "dynamic-video-fixture",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    source: { vaultPath: "", contentHash: "a".repeat(64) },
    article: {
      title: "视频动态",
      digest: "",
      markdown: "视频正文第一段\n\n第二段",
      html: "<p>视频正文第一段</p><p>第二段</p>",
      tags: [],
      coverAssetId: null
    },
    assets: [{ id: "video-1", fileName: "演示.mp4", mimeType: "video/mp4", size: 3, sha256: "a".repeat(64) }],
    media: { videoAssetId: "video-1" },
    targets: [platform],
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

function context(task = videoTask()): PrepareDraftContext {
  return {
    task,
    getAssetData: vi.fn(async () => "data:video/mp4;base64,AQID"),
    getAssetBlob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" })),
    uploadProgress: { complete: vi.fn(), fail: vi.fn() }
  }
}

function fixture(onChange: (root: HTMLElement) => void) {
  document.body.innerHTML = `<main class="publish-page composer">
    <input class="d-text" placeholder="填写标题">
    <textarea placeholder="有什么新鲜事？分享动态"></textarea>
    <div class="ql-editor" contenteditable="true" role="textbox"></div>
    <input type="file" accept="image/*" multiple>
    <input id="video-input" type="file" accept="video/mp4,.mov" style="display:none">
    <button type="button">发布</button>
  </main>`
  const root = document.querySelector<HTMLElement>("main")!
  const input = document.querySelector<HTMLInputElement>("#video-input")!
  Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
  input.addEventListener("change", () => onChange(root))
  return { root, input }
}

describe("dynamic video media", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("DataTransfer", TestDataTransfer)
  })
  afterEach(() => {
    xiaohongshuAdapter.dispose()
    weiboPostAdapter.dispose()
    jikePostAdapter.dispose()
    document.body.innerHTML = ""
    document.body.removeAttribute("class")
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test("loads a video Blob directly and retains its file name and MIME type", async () => {
    const input = context()
    const file = await postAssetFile(input, input.task.assets[0]!)
    expect(file.name).toBe("演示.mp4")
    expect(file.type).toBe("video/mp4")
    expect(file.size).toBe(3)
    expect(input.getAssetData).not.toHaveBeenCalled()
  })

  test("rejects video metadata mistakes before reaching any image uploader", () => {
    const task = videoTask()
    task.media = undefined
    expect(() => postVideoAsset(task)).toThrow("视频附件无效")
    task.media = { videoAssetId: "video-1" }
    task.assets.push({ ...task.assets[0]!, id: "image-1", mimeType: "image/png" })
    expect(() => postVideoAsset(task)).toThrow("请先移除图片")
  })

  test.each([
    ["xiaohongshu", xiaohongshuAdapter],
    ["weibo-post", weiboPostAdapter],
    ["jike-post", jikePostAdapter]
  ] as const)("%s selects only the video input and waits for platform processing without publishing", async (platform, adapter) => {
    const { input, root } = fixture(container => {
      const status = document.createElement("div")
      status.setAttribute("role", "status")
      status.textContent = "正在上传视频"
      const video = document.createElement("video")
      video.src = "blob:https://platform.test/local-preview"
      container.append(status, video)
      window.setTimeout(() => { status.textContent = "视频上传完成，正在转码" }, 1_500)
      window.setTimeout(() => { status.textContent = "视频处理完成" }, 2_500)
    })
    const publish = vi.fn()
    root.querySelector("button")!.addEventListener("click", publish)
    const imageChange = vi.fn()
    root.querySelector("input[accept='image/*']")!.addEventListener("change", imageChange)
    const uploadContext = context(videoTask(platform))
    let settled = false
    const resultPromise = adapter.prepareDraft(uploadContext).finally(() => { settled = true })
    await vi.advanceTimersByTimeAsync(2_400)
    expect(settled).toBe(false)
    expect(uploadContext.uploadProgress!.complete).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(resultPromise).resolves.toMatchObject({ warnings: [] })
    expect(Array.from(input.files ?? []).map(file => file.name)).toEqual(["演示.mp4"])
    expect(uploadContext.uploadProgress!.complete).toHaveBeenCalledWith(uploadContext.task.assets[0])
    expect(uploadContext.getAssetData).not.toHaveBeenCalled()
    expect(imageChange).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(platform === "xiaohongshu"
      ? root.querySelector(".ql-editor")!.textContent
      : root.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain("视频正文第一段")
  })

  test("opens the explicit video entry when the platform initially exposes only images", async () => {
    const { root, input } = fixture(container => { container.append("视频上传完成") })
    input.remove()
    const button = document.createElement("button")
    button.textContent = "添加视频"
    button.addEventListener("click", () => root.appendChild(input))
    root.appendChild(button)
    const uploadContext = context()
    const promise = uploadPostVideo({ context: uploadContext, asset: uploadContext.task.assets[0]!, platform: "微博", root, cancelled: () => false })
    await vi.advanceTimersByTimeAsync(2_000)
    await promise
    expect(input.files).toHaveLength(1)
  })

  test.each([
    ["weibo-post", weiboPostAdapter],
    ["jike-post", jikePostAdapter]
  ] as const)("%s finds a delayed sibling upload toolbar while ignoring feed upload messages", async (platform, adapter) => {
    document.body.innerHTML = `<section id="post-composer">
      <div class="text-wrapper"><textarea placeholder="有什么新鲜事？分享动态"></textarea></div>
      <button type="button">发布</button>
    </section>
    <main role="feed"><div role="alert">其他用户的视频上传失败</div><video src="https://feed.test/existing.mp4"></video></main>`
    const composer = document.querySelector<HTMLElement>("#post-composer")!
    const editor = composer.querySelector<HTMLTextAreaElement>("textarea")!
    const publish = vi.fn()
    composer.querySelector("button")!.addEventListener("click", publish)
    let input: HTMLInputElement | null = null
    window.setTimeout(() => {
      const toolbar = document.createElement("aside")
      toolbar.innerHTML = '<input type="file" accept="video/*" hidden>'
      input = toolbar.querySelector<HTMLInputElement>("input")!
      Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
      input.addEventListener("change", () => { toolbar.append("视频上传完成") })
      composer.appendChild(toolbar)
    }, 800)
    const uploadContext = context(videoTask(platform))
    const promise = adapter.prepareDraft(uploadContext)
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(promise).resolves.toMatchObject({ warnings: [] })
    expect(findPostVideoRoot(editor)).toBe(composer)
    expect((input as HTMLInputElement | null)?.files).toHaveLength(1)
    expect(uploadContext.uploadProgress!.complete).toHaveBeenCalledTimes(1)
    expect(uploadContext.uploadProgress!.fail).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  test("does not expand a bare editor to the entire document feed", () => {
    document.body.className = "composer-page"
    document.body.innerHTML = `<textarea placeholder="分享动态"></textarea>
      <main role="feed"><button title="视频">视频</button><video src="https://feed.test/video.mp4"></video></main>`
    const editor = document.querySelector("textarea")!
    expect(findPostVideoRoot(editor)).toBe(editor)
  })

  test("never treats a local preview or stale completed message as a successful upload", async () => {
    const { root } = fixture(container => {
      const video = document.createElement("video")
      video.src = "blob:https://platform.test/selected-file"
      container.appendChild(video)
      container.append("演示.mp4")
    })
    root.append("上一个视频上传完成")
    const uploadContext = context()
    const promise = uploadPostVideo({ context: uploadContext, asset: uploadContext.task.assets[0]!, platform: "即刻", root, cancelled: () => false, timeoutMs: 2_000 })
    const rejection = expect(promise).rejects.toThrow("视频上传或处理超时")
    await vi.advanceTimersByTimeAsync(3_000)
    await rejection
    expect(uploadContext.uploadProgress!.complete).not.toHaveBeenCalled()
    expect(uploadContext.uploadProgress!.fail).toHaveBeenCalledTimes(1)
  })

  test("ignores upload phrases inside the user's rich-text content", async () => {
    const { root } = fixture(container => {
      container.insertAdjacentHTML("beforeend", '<div role="status">视频上传完成</div>')
    })
    root.querySelector("[contenteditable='true']")!.textContent = "教程：视频正在上传，等待处理中"
    const uploadContext = context()
    const promise = uploadPostVideo({ context: uploadContext, asset: uploadContext.task.assets[0]!, platform: "即刻", root, cancelled: () => false, timeoutMs: 3_000 })
    await vi.advanceTimersByTimeAsync(2_000)
    await promise
    expect(uploadContext.uploadProgress!.complete).toHaveBeenCalledTimes(1)
  })

  test("reports a platform video failure and does not claim a ready result", async () => {
    const { root } = fixture(container => { container.append("视频转码失败，请重新上传") })
    const uploadContext = context()
    const promise = uploadPostVideo({ context: uploadContext, asset: uploadContext.task.assets[0]!, platform: "微博", root, cancelled: () => false })
    const rejection = expect(promise).rejects.toThrow("视频上传失败")
    await vi.advanceTimersByTimeAsync(1_000)
    await rejection
    expect(uploadContext.uploadProgress!.complete).not.toHaveBeenCalled()
    expect(uploadContext.uploadProgress!.fail).toHaveBeenCalledTimes(1)
  })

  test("protects the serialized image-only runner from video tasks", async () => {
    await expect(runXiaohongshuPageTask(videoTask("xiaohongshu"))).rejects.toThrow("视频发布入口")
  })
})
