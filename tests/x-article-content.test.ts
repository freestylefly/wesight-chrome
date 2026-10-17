import { xArticleContent } from "~lib/x-article-content"

describe("X article content state", () => {
  test("preserves styles, links, and UTF-16 offsets around emoji and Chinese text", () => {
    const content = xArticleContent('<p>你好😀<strong>粗体<em>斜体</em></strong> <a href="https://example.com">链接</a></p>', new Map())
    const block = content.blocks[0]!
    expect(block.text).toBe("你好😀粗体斜体 链接")
    expect(block.inline_style_ranges).toContainEqual({ style: "Bold", offset: 4, length: 2 })
    expect(block.inline_style_ranges).toContainEqual({ style: "Italic", offset: 6, length: 2 })
    expect(block.entity_ranges).toEqual([{ key: 0, offset: 9, length: 2 }])
    expect(content.entity_map[0]?.value.data).toEqual({ url: "https://example.com" })
  })
  test("preserves paragraphs around inline images and produces only supported block types", () => {
    const content = xArticleContent('<h3>小节</h3><p>前<img src="wesight-asset://a">后</p><blockquote><p>引用</p></blockquote><ol><li>第一</li><li>第二</li></ol>', new Map([["wesight-asset://a", "123"]]))
    expect(content.blocks.map(block => [block.type, block.text])).toEqual([["header-two", "小节"], ["unstyled", "前"], ["atomic", " "], ["unstyled", "后"], ["blockquote", "引用"], ["ordered-list-item", "第一"], ["ordered-list-item", "第二"]])
    expect(JSON.stringify(content)).not.toContain('"depth"')
  })
  test("encodes code, tables and separators as atomic entities", () => {
    const content = xArticleContent('<pre><code class="language-js">const x = 1;\n```</code></pre><table><tr><th>A</th><th>B</th></tr><tr><td>x|y</td><td>值</td></tr></table><hr>', new Map())
    expect(content.entity_map.map(entity => entity.value.type)).toEqual(["MARKDOWN", "MARKDOWN", "DIVIDER"])
    expect(content.entity_map[0]?.value).toMatchObject({ mutability: "Mutable", data: { markdown: "\n````js\nconst x = 1;\n```\n````\n" } })
    expect(content.entity_map[1]?.value.data.markdown).toContain("x\\|y")
  })
  test("rejects missing image uploads and strips executable HTML", () => {
    expect(() => xArticleContent('<img src="wesight-asset://missing">', new Map())).toThrow("尚未完成上传")
    const content = xArticleContent('<script>bad()</script><p onclick="bad()">保留<a href="javascript:bad()">文字</a></p>', new Map())
    expect(content.blocks[0]?.text).toBe("保留文字")
    expect(content.entity_map).toEqual([])
  })
})
