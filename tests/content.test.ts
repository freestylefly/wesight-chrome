import { platformPlainText, replaceAssetTokens, sanitizePlatformHtml, truncateTitle } from "~lib/content"

describe("platform content preparation", () => {
  test("removes executable and form content", () => {
    const html = sanitizePlatformHtml('<p onclick="steal()" style="color:red;position:fixed">正文</p><script>alert(1)</script><iframe src="https://bad.test"></iframe>')
    expect(html).toContain("正文")
    expect(html).toContain("color: red")
    expect(html).not.toContain("onclick")
    expect(html).not.toContain("position")
    expect(html).not.toContain("script")
    expect(html).not.toContain("iframe")
  })
  test("replaces only declared asset tokens", () => {
    expect(replaceAssetTokens("![图](wesight-asset://abc)", new Map([["abc", "https://img.test/a.png"]])))
      .toBe("![图](https://img.test/a.png)")
  })
  test("truncates by unicode characters", () => {
    expect(truncateTitle("你好世界", 3)).toEqual({ title: "你好世", truncated: true })
  })
  test("provides rich editors with plain text that cannot be mistaken for Markdown", () => {
    const text = platformPlainText("<h2>验收目标</h2><ul><li>检查图片</li></ul><pre><code>const ready = true</code></pre>")

    expect(text).toContain("验收目标")
    expect(text).toContain("检查图片")
    expect(text).toContain("const ready = true")
    expect(text).not.toContain("##")
    expect(text).not.toContain("- 检查图片")
  })
})
