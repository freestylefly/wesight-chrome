import type { PlatformId } from "~types/protocol"

export const PLATFORM_CONFIG: Record<PlatformId, {
  label: string
  shortLabel: string
  editorUrl: string
  titleLimit: number
}> = {
  zhihu: {
    label: "知乎专栏",
    shortLabel: "知乎",
    editorUrl: "https://zhuanlan.zhihu.com/write",
    titleLimit: 100
  },
  csdn: {
    label: "CSDN 博客",
    shortLabel: "CSDN",
    editorUrl: "https://mp.csdn.net/mp_blog/creation/editor",
    titleLimit: 100
  },
  juejin: {
    label: "掘金文章",
    shortLabel: "掘金",
    editorUrl: "https://juejin.cn/editor/drafts/new?v=2",
    titleLimit: 80
  },
  "bilibili-article": {
    label: "B站专栏",
    shortLabel: "B站",
    editorUrl: "https://member.bilibili.com/york/read-editor",
    titleLimit: 40
  },
  toutiao: {
    label: "今日头条",
    shortLabel: "头条",
    editorUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
    titleLimit: 30
  },
  "weibo-article": {
    label: "微博头条文章",
    shortLabel: "微博",
    editorUrl: "https://card.weibo.com/article/v5/editor",
    titleLimit: 32
  },
  "x-article": {
    label: "X 文章",
    shortLabel: "X",
    editorUrl: "https://x.com/compose/articles",
    titleLimit: 100
  },
  xiaohongshu: {
    label: "小红书图文",
    shortLabel: "小红书",
    editorUrl: "https://creator.xiaohongshu.com/publish/publish?target=image",
    titleLimit: 20
  },
  "weibo-post": {
    label: "微博图文动态",
    shortLabel: "微博动态",
    editorUrl: "https://weibo.com/",
    titleLimit: 2000
  },
  "jike-post": {
    label: "即刻动态",
    shortLabel: "即刻",
    editorUrl: "https://web.okjike.com/",
    titleLimit: 2000
  },
  "x-post": {
    label: "X 动态",
    shortLabel: "X",
    editorUrl: "https://x.com/compose/post",
    titleLimit: 280
  }
}

export function isXPlatform(platformId: PlatformId | null | undefined): platformId is "x-article" | "x-post" {
  return platformId === "x-article" || platformId === "x-post"
}

/** Article and dynamic publishing use the same signed-in platform account. */
export function accountPlatformIds(platformId: PlatformId): readonly PlatformId[] {
  if (isXPlatform(platformId)) return ["x-article", "x-post"]
  if (platformId === "weibo-article" || platformId === "weibo-post") return ["weibo-article", "weibo-post"]
  return [platformId]
}

/** Keep a task bound to its own X adapter while the single-page app changes routes. */
export function platformForOwnedPage(reported: PlatformId, owner: PlatformId | undefined, url: string): PlatformId {
  if (!isXPlatform(reported) || !isXPlatform(owner)) return reported
  try { return isXPlatform(platformFromUrl(url)) ? owner : reported } catch { return reported }
}

export function platformFromUrl(url: string): PlatformId | null {
  const parsed = new URL(url)
  const host = parsed.hostname
  if (host === "www.zhihu.com" || host === "zhuanlan.zhihu.com") return "zhihu"
  if (host === "www.csdn.net" || host === "editor.csdn.net" || host === "mp.csdn.net" || host === "passport.csdn.net") return "csdn"
  if (host === "juejin.cn" || host === "passport.juejin.cn") return "juejin"
  if (host === "member.bilibili.com" || host === "passport.bilibili.com") return "bilibili-article"
  if (host === "mp.toutiao.com" || host === "sso.toutiao.com") return "toutiao"
  if (host === "card.weibo.com") return "weibo-article"
  if (host === "weibo.com" || host === "www.weibo.com") return "weibo-post"
  if (host === "passport.weibo.com" || host === "login.sina.com.cn") return "weibo-post"
  if (host === "creator.xiaohongshu.com") return "xiaohongshu"
  if (host === "x.com" || host === "twitter.com") return /^\/compose\/articles(?:\/|$)/.test(parsed.pathname) ? "x-article" : "x-post"
  if (host === "web.okjike.com") return "jike-post"
  return null
}
