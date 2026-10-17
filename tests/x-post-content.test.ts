import { buildXPostText, supportedXPostImages, xPostTextError, xPostWeightedLength } from "~lib/x-post-content"

describe("X dynamic text and images", () => {
  test("counts CJK, emoji sequences and URLs with the official X weights", () => {
    expect(xPostWeightedLength("中".repeat(140))).toBe(280)
    expect(xPostTextError("中".repeat(140))).toBeNull()
    expect(xPostTextError("中".repeat(141))).toContain("当前 282")
    expect(xPostWeightedLength("👨‍👩‍👧‍👦")).toBe(2)
    expect(xPostWeightedLength(`https://example.com/${"a".repeat(500)}`)).toBe(23)
  })
  test("budgets the full post with its optional title and leaves topics out by default", () => {
    const copy = { title: "My title", body: "Body #inline", tags: ["#AI#", "  work  ", ""] }
    expect(buildXPostText(copy)).toBe("My title\n\nBody #inline")
    expect(buildXPostText({ title: "", body: "hello" })).toBe("hello")
    expect(xPostTextError(buildXPostText({ title: "Title", body: "a".repeat(275) }))).toContain("最多 280")
    expect(xPostTextError("")).toBeNull()
    expect(xPostTextError("bad\ufffecharacter")).toContain("无效字符")
  })
  test("filters unsupported formats without changing the source attachment list", () => {
    const assets = [
      { id: "png", fileName: "one.png", mimeType: "image/png", sha256: "a".repeat(64), size: 8 },
      { id: "gif", fileName: "two.gif", mimeType: "image/gif", sha256: "b".repeat(64), size: 8 }
    ]
    const plan = supportedXPostImages(assets)
    expect(plan.images.map(asset => asset.id)).toEqual(["png"])
    expect(plan.skipped.map(asset => asset.id)).toEqual(["gif"])
    expect(assets).toHaveLength(2)
  })
})
