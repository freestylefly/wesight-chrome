import { readFileSync } from "fs"
import { resolve } from "path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { weiboPostAdapter, weiboPostFixtureHelpers } from "~platforms/weibo-post"
import type { PublishTaskV1 } from "~types/protocol"

const fixture = readFileSync(resolve(process.cwd(), "tests", "fixtures", "weibo-post.html"), "utf8")

class TestDataTransfer {
  files: File[] = []
  items = { add: (file: File) => this.files.push(file) }
}

function task(count = 3): PublishTaskV1 {
  return {
    protocolVersion: 1,
    taskId: "weibo-post-fixture",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    source: { vaultPath: "文章.md", contentHash: "a".repeat(64) },
    article: {
      title: "微博动态",
      digest: "",
      markdown: "正文第一段\n\n正文第二段",
      html: "<p>正文第一段</p><p>正文第二段</p>",
      coverAssetId: count ? "asset-1" : null,
      tags: ["AI", "世界模型"]
    },
    assets: Array.from({ length: count }, (_, index) => ({
      id: `asset-${index + 1}`,
      fileName: `image-${index + 1}.png`,
      mimeType: "image/png",
      size: 3,
      sha256: String(index + 1).repeat(64).slice(0, 64)
    })),
    targets: ["weibo-post"],
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

describe("weibo post adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("DataTransfer", TestDataTransfer)
    document.documentElement.innerHTML = fixture
    history.replaceState({}, "", "/")
    const input = document.querySelector<HTMLInputElement>("input[type='file']")!
    Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
    input.addEventListener("change", () => {
      const list = document.querySelector<HTMLElement>(".picbed-list")!
      Array.from(input.files ?? []).forEach((file, index) => {
        const image = document.createElement("img")
        image.src = `https://wx.test/${index}-${file.name}`
        list.appendChild(image)
      })
    })
  })

  afterEach(() => {
    weiboPostAdapter.dispose()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test("fills body and topics, uploads ordered images, and leaves final publishing to the user", async () => {
    const complete = vi.fn()
    const feed = document.createElement("section")
    feed.className = "picture-feed"
    for (let index = 0; index < 8; index += 1) {
      const item = document.createElement("div")
      item.className = "item"
      item.appendChild(document.createElement("img"))
      feed.appendChild(item)
    }
    document.body.appendChild(feed)
    expect(weiboPostFixtureHelpers.previewCount()).toBe(0)

    const send = document.createElement("button")
    send.textContent = "发送"
    const sendClick = vi.fn()
    send.addEventListener("click", sendClick)
    document.body.appendChild(send)
    const result = await weiboPostAdapter.prepareDraft({
      task: task(),
      getAssetData: async () => "data:image/png;base64,AQID",
      uploadProgress: { complete, fail: vi.fn() }
    })

    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain("正文第一段")
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain("#AI# #世界模型#")
    expect(Array.from(document.querySelector<HTMLInputElement>("input[type='file']")?.files ?? [])
      .map(file => file.name)).toEqual(["image-1.png", "image-2.png", "image-3.png"])
    expect(document.querySelectorAll(".picbed-list img")).toHaveLength(3)
    expect(weiboPostFixtureHelpers.previewCount()).toBe(3)
    expect(complete).toHaveBeenCalledTimes(3)
    expect(result.warnings).toEqual([])
    expect(sendClick).not.toHaveBeenCalled()
  })

  test("reports a login-required account without touching the publish controls", async () => {
    document.body.innerHTML = '<form action="/login"><input type="password"><button>登录</button></form>'
    await expect(weiboPostAdapter.detectAccount()).resolves.toEqual({
      loggedIn: false,
      message: "请先登录微博，登录完成后重试"
    })
  })

  test("rejects content that exceeds the real composer limit after topics are appended", async () => {
    const oversized = task(1)
    oversized.article.markdown = "正".repeat(1999)
    oversized.article.tags = ["AI"]
    await expect(weiboPostAdapter.prepareDraft({
      task: oversized,
      getAssetData: async () => "data:image/png;base64,AQID"
    })).rejects.toThrow("正文和话题合计超过 2000 个字符")
  })
})
