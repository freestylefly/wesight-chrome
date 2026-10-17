import { spaceWeiboParagraphs } from "~lib/weibo-content"

describe("Weibo paragraph spacing", () => {
  test("adds one empty line between body paragraphs while preserving text and inline formatting", () => {
    const source = '<p>第一段，<strong>重点</strong>。</p>\n<p>第二段，<a href="https://example.com">链接</a>。</p><p>第三段<br>段内换行。</p>'
    const result = spaceWeiboParagraphs(source)
    const body = new DOMParser().parseFromString(result, "text/html").body
    expect(Array.from(body.children, element => element.innerHTML)).toEqual([
      '第一段，<strong>重点</strong>。', '<br>', '第二段，<a href="https://example.com">链接</a>。', '<br>', '第三段<br>段内换行。'
    ])
    expect(body.textContent).toBe(new DOMParser().parseFromString(source, "text/html").body.textContent)
    expect(spaceWeiboParagraphs(result)).toBe(result)
  })

  test("preserves existing empty lines and never adds one before the first or after the last paragraph", () => {
    for (const gap of ['<p><br></p>', '<p></p>', '<p>&nbsp;</p>', '<p>\u200b</p>', '<p><br></p><p><br></p>']) {
      const source = `<p>第一段</p>${gap}<p>第二段</p>`
      expect(spaceWeiboParagraphs(source)).toBe(new DOMParser().parseFromString(source, "text/html").body.innerHTML)
    }
    expect(spaceWeiboParagraphs('<p>只有一段</p>')).toBe('<p>只有一段</p>')
  })

  test("handles article wrappers while preserving lists, quotes, tables, images and code", () => {
    const structures = '<h2>标题</h2><ul><li><p>列表一</p><p>列表二</p></li></ul><blockquote><p>引文一</p><p>引文二</p></blockquote><table><tbody><tr><td><p>单元格一</p><p>单元格二</p></td></tr></tbody></table><pre><code>第一行\n\n第三行</code></pre><figure><img src="https://example.com/image.png"><figcaption><p>图注一</p><p>图注二</p></figcaption></figure>'
    const source = `<article><section><p>第一段</p><p>第二段</p></section>${structures}<p><img src="https://example.com/image-2.png"></p><p>结尾</p></article>`
    const result = spaceWeiboParagraphs(source)
    expect(result).toContain('<section><p>第一段</p><p><br></p><p>第二段</p></section>')
    expect(result).toContain(structures)
    expect(result).toContain('<p><img src="https://example.com/image-2.png"></p><p>结尾</p>')
  })
})
