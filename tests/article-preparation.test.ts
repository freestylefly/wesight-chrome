import { normalizeDraft, stripLeadingDecoration, stripLeadingHtmlDecoration, xImageWarning, xUnsupportedImageWarning } from "~lib/article-preparation"
import { buildComposeTask } from "~lib/compose-task"
import type { ComposeDraft } from "~lib/draft-store"
import { cangheGreenPreview } from "~lib/preview-theme"
import { isPublishTaskV1 } from "~types/protocol"

const badge = '<center><span style="background:#d3f8b6">这是苍何的第 609 篇原创！</span></center>'

function draft(count = 2): ComposeDraft {
  const ids = Array.from({ length: count }, (_, index) => String(index + 1).padStart(64, "a"))
  return {
    id: "draft", source: { kind: "file", fileName: "article.md" }, title: "文章", digest: "",
    markdown: ids.map(id => `![图片](wesight-asset://${id})`).join("\n\n"),
    html: ids.map(id => `<p><img src="wesight-asset://${id}"></p>`).join(""), coverAssetId: null,
    assets: ids.map(id => ({ id, fileName: `${id}.png`, mimeType: "image/png", size: 1, sha256: id })),
    tags: [], warnings: [], importedAt: "2026-10-15", updatedAt: "2026-10-15"
  }
}

describe("publishing article preparation", () => {
  test("warns about GIF without blocking sync or using up supported image slots", () => {
    const article = normalizeDraft(draft(16))
    article.assets[0]!.mimeType = "image/gif"
    expect(xImageWarning(article, ["x-article"], true)).toBeNull()
    expect(xUnsupportedImageWarning(article, ["x-article"], true)).toContain("自动跳过 1 张")
    expect(xUnsupportedImageWarning(article, ["x-article"], true)).toContain("封面也将跳过")
    expect(xUnsupportedImageWarning(article, ["csdn"], true)).toBeNull()
    const task = buildComposeTask(article, ["x-article", "csdn"], { taskId: "gif", keepImages: true, maxTargets: null })
    expect(task.assets).toHaveLength(16)
    expect(task.article.html).toBe(article.html)
    expect(xUnsupportedImageWarning({ ...article, coverAssetId: null }, ["x-article"], false)).toBeNull()
  })
  test("detects unsupported remote image extensions including query strings", () => {
    const article = { ...draft(0), html: '<p>文字<img src="https://cdn.example.com/animation.GIF?version=2"></p>' }
    expect(xUnsupportedImageWarning(article, ["x-article"], true)).toContain("自动跳过 1 张")
  })
  test("removes leading badges while preserving centered content and code examples", () => {
    expect(stripLeadingDecoration(`\n${badge}\n\n# 标题\n\n正文`)).toBe("# 标题\n\n正文")
    const example = `正文\n\n\`\`\`html\n${badge}\n\`\`\``
    expect(stripLeadingDecoration(example)).toBe(example)
    expect(stripLeadingDecoration("<center>真正的文章标题</center>\n正文")).toContain("真正的文章标题")
    expect(stripLeadingHtmlDecoration(`${badge}<h2>正文</h2>`)).toBe("<h2>正文</h2>")
    const escaped = `<p>${badge.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p><p>正文</p>`
    expect(stripLeadingHtmlDecoration(escaped)).toBe("<p>正文</p>")
    expect(stripLeadingHtmlDecoration(`<section><div><p>${badge}</p><p>正文</p></div></section>`))
      .toBe("<section><div><p>正文</p></div></section>")
  })

  test("defaults to the first body image in document order, ignoring asset order", () => {
    const article = draft()
    article.assets.reverse()
    expect(normalizeDraft(article).coverAssetId).toBe(article.assets[1]!.id)
    expect(normalizeDraft(article).coverSelection).toBe("auto")
    const reordered = { ...normalizeDraft(article), html: `<img src="wesight-asset://${article.assets[0]!.id}">` }
    expect(normalizeDraft(reordered).coverAssetId).toBe(article.assets[0]!.id)
  })

  test("preserves a chosen cover or an explicit removal", () => {
    const article = draft()
    const custom = { ...article, coverAssetId: article.assets[1]!.id, coverSelection: "custom" as const }
    expect(normalizeDraft(custom).coverAssetId).toBe(custom.coverAssetId)
    expect(normalizeDraft({ ...custom, coverSelection: "none" }).coverAssetId).toBeNull()
  })

  test("checks 15/16 images only when X is selected, including a separate cover", () => {
    expect(xImageWarning(normalizeDraft(draft(15)), ["x-article"], true)).toBeNull()
    const article = normalizeDraft(draft(16))
    expect(xImageWarning(article, ["x-article"], true)).toContain("当前有 16 张")
    expect(xImageWarning(article, ["zhihu", "juejin"], true)).toBeNull()
    expect(xImageWarning(article, ["x-article"], false)).toBeNull()
    const withExtraCover = { ...draft(16), html: draft(15).html, coverAssetId: draft(16).assets[15]!.id, coverSelection: "custom" as const }
    expect(xImageWarning(withExtraCover, ["x-article"], true)).toContain("16 张")
    expect(() => buildComposeTask(article, ["x-article"], { taskId: "t", keepImages: true, maxTargets: null })).toThrow("15 张")
    expect(() => buildComposeTask(article, ["zhihu"], { taskId: "t", keepImages: true, maxTargets: null })).not.toThrow()
  })

  test("cleans decorations on sync as well as on import", () => {
    const article = draft()
    article.markdown = `${badge}\n${article.markdown}`
    article.html = `${badge}${article.html}`
    const task = buildComposeTask(article, ["x-article"], { taskId: "t", keepImages: true, maxTargets: null })
    expect(task.article.markdown).not.toContain("609")
    expect(task.article.html).not.toContain("609")
  })

  test("passes explicit X image trimming without removing images from the shared article", () => {
    const article = normalizeDraft(draft(23))
    const task = buildComposeTask(article, ["x-article", "zhihu"], { taskId: "t", keepImages: true, xSkipExcessImages: true, maxTargets: null })
    expect(isPublishTaskV1(task)).toBe(true)
    expect(task.targetOptions?.xArticle?.skipExcessImages).toBe(true)
    expect(task.article.html).toBe(article.html)
    expect(task.article.markdown).toBe(article.markdown)
    expect(task.assets).toHaveLength(23)
    expect(xImageWarning(article, ["x-article"], true, true)).toContain("前 15 张正文图片")
    expect(xImageWarning(article, ["x-article"], true, true)).toContain("其余 8 张")
    expect(xImageWarning({ ...article, coverAssetId: article.assets[22]!.id }, ["x-article"], true, true)).toContain("前 14 张正文图片和封面")
    expect(xImageWarning(article, ["x-article"], false, true)).toBeNull()
    expect(isPublishTaskV1({ ...task, targetOptions: { xArticle: { skipExcessImages: "true" } } })).toBe(false)
  })

  test("applies the same Canghe green preview decorators without changing the source HTML", () => {
    const source = '<h2>标题</h2><table><tr><td>内容</td></tr></table><pre><code>const a = 1;\nconst b = 2;</code></pre>'
    const html = cangheGreenPreview(source)
    expect(html).toContain('class="wesight-wechat-template-canghe-style-tes"')
    expect(html).toContain("wesight-wechat-h2-tail")
    expect(html).toContain("wesight-wechat-table-wrap")
    expect(html).toContain("wesight-wechat-code-header")
    expect(html).toContain("const b = 2;")
    expect(source).not.toContain("wesight-wechat")
  })
})
