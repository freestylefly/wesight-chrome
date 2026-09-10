import { PLATFORM_CONFIG, platformFromUrl } from "~platforms/config"

describe("platform configuration", () => {
  test.each([
    ["https://mp.toutiao.com/profile_v4/graphic/publish", "toutiao"],
    ["https://sso.toutiao.com/login", "toutiao"],
    ["https://card.weibo.com/article/v5/editor", "weibo-article"],
    ["https://creator.xiaohongshu.com/publish/publish?target=image", "xiaohongshu"],
    ["https://weibo.com/", "weibo-post"],
    ["https://web.okjike.com/", "jike-post"],
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
  })
})
