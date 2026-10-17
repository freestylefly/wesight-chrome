import { File as NodeFile } from "node:buffer"

import { sha256 } from "~lib/crypto"
import { importArticleUrl, importMarkdownFiles, parseFrontmatter, sniffImageMime } from "~lib/importers"

// jsdom's File has no text()/arrayBuffer(); Chrome's does, as does Node's.
const File = NodeFile as unknown as typeof globalThis.File

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8])

function imageResponse(bytes: Uint8Array, type = "image/png"): Response {
  return new Response(bytes.slice().buffer, { status: 200, headers: { "Content-Type": type } })
}

function htmlResponse(html: string, url: string): Response {
  const response = new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } })
  Object.defineProperty(response, "url", { value: url })
  return response
}

afterEach(() => vi.unstubAllGlobals())

describe("markdown import", () => {
  test("parses frontmatter scalars, inline lists, and block lists", () => {
    const { data, body } = parseFrontmatter("---\ntitle: \"你好\"\ntags: [AI, 写作]\naliases:\n  - a\n  - b\n---\n正文")
    expect(data).toEqual({ title: "你好", tags: ["AI", "写作"], aliases: ["a", "b"] })
    expect(body).toBe("正文")
  })

  test("sniffs image types from bytes", () => {
    expect(sniffImageMime(PNG.buffer)).toBe("image/png")
    expect(sniffImageMime(JPEG.buffer)).toBe("image/jpeg")
    expect(sniffImageMime(new Uint8Array([1, 2, 3]).buffer)).toBe("")
  })

  test("matches local and Obsidian-style images, uses the H1 title, and reports missing files", async () => {
    const markdown = [
      "---",
      "tags: [效率]",
      "cover: cover.jpg",
      "---",
      "# 用 AI 搭建内容工作流",
      "",
      "写完一篇文章后，接下来就是分享。",
      "",
      "![流程](./assets/flow.png)",
      "",
      "![[flow.png|300]]",
      "",
      "![缺失](missing.png)"
    ].join("\n")
    const imported = await importMarkdownFiles([
      new File([markdown], "workflow.md", { type: "text/markdown" }),
      new File([PNG], "flow.png", { type: "image/png" }),
      new File([JPEG], "cover.jpg", { type: "image/jpeg" })
    ])
    const flowId = await sha256(PNG.slice().buffer)
    const coverId = await sha256(JPEG.slice().buffer)

    expect(imported.draft.title).toBe("用 AI 搭建内容工作流")
    expect(imported.draft.markdown.startsWith("# ")).toBe(false)
    expect(imported.draft.digest).toBe("写完一篇文章后，接下来就是分享。")
    expect(imported.draft.tags).toEqual(["效率"])
    expect(imported.draft.markdown).toContain(`![流程](wesight-asset://${flowId})`)
    expect(imported.draft.markdown).toContain(`![](wesight-asset://${flowId})`)
    expect(imported.draft.markdown).toContain("![缺失](missing.png)")
    expect(imported.draft.html).toContain(`src="wesight-asset://${flowId}"`)
    expect(imported.draft.coverAssetId).toBe(coverId)
    expect(imported.draft.assets.map(asset => asset.id).sort()).toEqual([coverId, flowId].sort())
    expect(imported.assets).toHaveLength(2)
    expect(imported.draft.warnings.join()).toContain("missing.png")
    expect(imported.draft.source).toEqual({ kind: "file", fileName: "workflow.md" })
  })

  test("requires a markdown file", async () => {
    await expect(importMarkdownFiles([new File([PNG], "a.png", { type: "image/png" })])).rejects.toThrow(".md")
  })
})

describe("link import", () => {
  test("extracts a WeChat article, downloads lazy images and the cover", async () => {
    const page = `<!doctype html><html><head>
      <meta property="og:title" content="备用标题">
      <meta property="og:description" content="公众号摘要">
      <meta property="og:image" content="https://mmbiz.qpic.cn/cover/0?wx_fmt=jpeg">
      </head><body>
      <h1 id="activity-name"> 公众号标题 </h1>
      <div id="js_content" style="visibility: hidden">
        <p>第一段<strong>重点</strong></p>
        <p><img data-src="https://mmbiz.qpic.cn/body/0?wx_fmt=png" src="data:image/gif;base64,R0lGOD"></p>
        <script>alert(1)</script>
      </div></body></html>`
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith("https://mp.weixin.qq.com/")) return htmlResponse(page, url)
      if (url.includes("/body/")) return imageResponse(PNG, "application/octet-stream")
      if (url.includes("/cover/")) return imageResponse(JPEG, "image/jpeg")
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const imported = await importArticleUrl("https://mp.weixin.qq.com/s/abc")
    const bodyId = await sha256(PNG.slice().buffer)
    expect(imported.draft.title).toBe("公众号标题")
    expect(imported.draft.digest).toBe("公众号摘要")
    expect(imported.draft.html).toContain(`wesight-asset://${bodyId}`)
    expect(imported.draft.html).not.toContain("<script")
    expect(imported.draft.html).not.toContain("visibility")
    expect(imported.draft.markdown).toContain("第一段**重点**")
    expect(imported.draft.markdown).toContain(`![](wesight-asset://${bodyId})`)
    expect(imported.draft.coverAssetId).toBe(await sha256(JPEG.slice().buffer))
    expect(imported.draft.assets.find(asset => asset.id === bodyId)?.fileName).toBe("0.png")
    expect(imported.draft.source).toEqual({ kind: "url", url: "https://mp.weixin.qq.com/s/abc" })
  })

  test("uses Readability for generic pages and keeps undownloadable images as links", async () => {
    const paragraphs = Array.from({ length: 6 }, (_, index) => `<p>这是第 ${index + 1} 段正文，内容足够长以便正文提取算法识别文章主体，并保留段落结构与链接。</p>`).join("")
    const page = `<!doctype html><html><head><title>博客标题 - 站点</title></head><body>
      <nav><a href="/">首页</a><a href="/about">关于</a></nav>
      <article><h1>博客标题</h1>${paragraphs}<p><img src="/img/a.png" alt="示意图"></p><p><a href="/next">下一篇</a></p></article>
      <footer>版权所有</footer></body></html>`
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "https://blog.example.com/post/1") return htmlResponse(page, url)
      return new Response("nope", { status: 403 })
    }))

    const imported = await importArticleUrl("https://blog.example.com/post/1")
    expect(imported.draft.title).toContain("博客标题")
    expect(imported.draft.html).toContain("第 6 段正文")
    expect(imported.draft.html).not.toContain("版权所有")
    expect(imported.draft.html).toContain("https://blog.example.com/img/a.png")
    expect(imported.draft.html).toContain("https://blog.example.com/next")
    expect(imported.draft.assets).toHaveLength(0)
    expect(imported.draft.warnings.join()).toContain("1 张图片未能下载")
  })

  test("rejects invalid links and HTTP failures", async () => {
    await expect(importArticleUrl("not a url")).rejects.toThrow("有效")
    await expect(importArticleUrl("ftp://example.com/a")).rejects.toThrow("http")
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })))
    await expect(importArticleUrl("https://example.com/missing")).rejects.toThrow("HTTP 404")
  })
})
