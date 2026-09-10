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
  }
}

export function platformFromUrl(url: string): PlatformId | null {
  const host = new URL(url).hostname
  if (host === "www.zhihu.com" || host === "zhuanlan.zhihu.com") return "zhihu"
  if (host === "www.csdn.net" || host === "editor.csdn.net" || host === "mp.csdn.net" || host === "passport.csdn.net") return "csdn"
  if (host === "juejin.cn" || host === "passport.juejin.cn") return "juejin"
  if (host === "member.bilibili.com" || host === "passport.bilibili.com") return "bilibili-article"
  if (host === "mp.toutiao.com" || host === "sso.toutiao.com") return "toutiao"
  if (host === "card.weibo.com") return "weibo-article"
  if (host === "weibo.com" || host === "www.weibo.com") return "weibo-post"
  if (host === "passport.weibo.com" || host === "login.sina.com.cn") return "weibo-post"
  if (host === "creator.xiaohongshu.com") return "xiaohongshu"
  if (host === "web.okjike.com") return "jike-post"
  return null
}
