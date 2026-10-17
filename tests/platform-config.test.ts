import { accountPlatformIds, PLATFORM_CONFIG, platformForOwnedPage, platformFromUrl } from "~platforms/config"

describe("platform configuration", () => {
  test.each([
    ["https://mp.toutiao.com/profile_v4/graphic/publish", "toutiao"],
    ["https://sso.toutiao.com/login", "toutiao"],
    ["https://card.weibo.com/article/v5/editor", "weibo-article"],
    ["https://creator.xiaohongshu.com/publish/publish?target=image", "xiaohongshu"],
    ["https://weibo.com/", "weibo-post"],
    ["https://web.okjike.com/", "jike-post"],
    ["https://x.com/compose/articles", "x-article"],
    ["https://x.com/compose/articles/edit/123", "x-article"],
    ["https://twitter.com/compose/articles", "x-article"],
    ["https://x.com/compose/post", "x-post"],
    ["https://x.com/compose/tweet", "x-post"],
    ["https://x.com/home", "x-post"],
    ["https://x.com/i/flow/login", "x-post"],
    ["https://twitter.com/compose/post", "x-post"],
    ["https://x.com/compose/articles-fake", "x-post"],
    ["https://picupload.weibo.com/interface/pic_upload.php", null]
  ] as const)("maps %s to %s", (url, platformId) => {
    expect(platformFromUrl(url)).toBe(platformId)
  })

  test("uses the requested editor URLs and static title limits", () => {
    expect(PLATFORM_CONFIG.toutiao).toMatchObject({ titleLimit: 30, editorUrl: "https://mp.toutiao.com/profile_v4/graphic/publish" })
    expect(PLATFORM_CONFIG["weibo-article"]).toMatchObject({ titleLimit: 32, editorUrl: "https://card.weibo.com/article/v5/editor" })
    expect(PLATFORM_CONFIG.xiaohongshu).toMatchObject({ titleLimit: 20, editorUrl: "https://creator.xiaohongshu.com/publish/publish?target=image" })
    expect(PLATFORM_CONFIG["weibo-post"]).toMatchObject({ titleLimit: 2000, editorUrl: "https://weibo.com/" })
    expect(PLATFORM_CONFIG["jike-post"]).toMatchObject({ titleLimit: 2000, editorUrl: "https://web.okjike.com/" })
    expect(PLATFORM_CONFIG["x-post"]).toMatchObject({ editorUrl: "https://x.com/compose/post" })
  })

  test("shares account identities without merging different platforms", () => {
    expect(accountPlatformIds("x-post")).toEqual(["x-article", "x-post"])
    expect(accountPlatformIds("x-article")).toEqual(["x-article", "x-post"])
    expect(accountPlatformIds("weibo-post")).toEqual(["weibo-article", "weibo-post"])
    expect(accountPlatformIds("jike-post")).toEqual(["jike-post"])
  })

  test("routes the X SPA readiness notification to the task's tab owner", () => {
    expect(platformForOwnedPage("x-post", "x-article", "https://x.com/home")).toBe("x-article")
    expect(platformForOwnedPage("x-article", "x-post", "https://x.com/compose/articles")).toBe("x-post")
    expect(platformForOwnedPage("x-post", "x-article", "https://example.com/")).toBe("x-post")
    expect(platformForOwnedPage("x-post", undefined, "https://x.com/home")).toBe("x-post")
    expect(platformForOwnedPage("xiaohongshu", "x-post", "https://creator.xiaohongshu.com/")).toBe("xiaohongshu")
  })
})
