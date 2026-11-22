import type { PlatformDefinition } from "~platforms/catalog/types"

/** Platforms shipped before the registry. Their ids and bundled permissions are frozen. */
export const CORE_PLATFORMS = [
  {
    id: "zhihu", group: "article", label: "知乎专栏", shortLabel: "知乎", editorUrl: "https://zhuanlan.zhihu.com/write",
    titleLimit: 100, accountKey: "zhihu", hosts: ["www.zhihu.com", "zhuanlan.zhihu.com"], permission: "bundled", stage: "stable"
  },
  {
    id: "csdn", group: "article", label: "CSDN 博客", shortLabel: "CSDN", editorUrl: "https://mp.csdn.net/mp_blog/creation/editor",
    titleLimit: 100, accountKey: "csdn", hosts: ["www.csdn.net", "editor.csdn.net", "mp.csdn.net", "passport.csdn.net"], permission: "bundled", stage: "stable"
  },
  {
    id: "juejin", group: "article", label: "掘金文章", shortLabel: "掘金", editorUrl: "https://juejin.cn/editor/drafts/new?v=2",
    titleLimit: 80, accountKey: "juejin", hosts: ["juejin.cn", "passport.juejin.cn"], permission: "bundled", stage: "stable"
  },
  {
    id: "bilibili-article", group: "article", label: "B站专栏", shortLabel: "B站", editorUrl: "https://member.bilibili.com/york/read-editor",
    titleLimit: 40, accountKey: "bilibili", hosts: ["member.bilibili.com", "passport.bilibili.com"], permission: "bundled", stage: "stable"
  },
  {
    id: "toutiao", group: "article", label: "今日头条", shortLabel: "头条", editorUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
    titleLimit: 30, accountKey: "toutiao", hosts: ["mp.toutiao.com", "sso.toutiao.com"], permission: "bundled", stage: "stable"
  },
  {
    id: "weibo-article", group: "article", label: "微博头条文章", shortLabel: "微博", editorUrl: "https://card.weibo.com/article/v5/editor",
    titleLimit: 32, accountKey: "weibo", hosts: ["card.weibo.com"], permission: "bundled", stage: "stable"
  },
  {
    id: "x-article", group: "article", label: "X 文章", shortLabel: "X", editorUrl: "https://x.com/compose/articles",
    titleLimit: 100, accountKey: "x", hosts: ["x.com", "twitter.com"], paths: ["^/compose/articles(?:/|$)"], permission: "bundled", stage: "stable"
  },
  {
    id: "xiaohongshu", group: "post", label: "小红书图文", shortLabel: "小红书", editorUrl: "https://creator.xiaohongshu.com/publish/publish?target=image",
    titleLimit: 20, accountKey: "xiaohongshu", hosts: ["creator.xiaohongshu.com"], permission: "bundled", stage: "stable",
    media: { images: 9, video: true }, brand: { glyph: "小红书", color: "#ed3658", caption: "把灵感写成一篇笔记" }
  },
  {
    id: "weibo-post", group: "post", label: "微博图文动态", shortLabel: "微博动态", editorUrl: "https://weibo.com/",
    titleLimit: 2000, accountKey: "weibo", hosts: ["weibo.com", "www.weibo.com", "passport.weibo.com", "login.sina.com.cn"], permission: "bundled", stage: "stable",
    media: { images: 9, video: true }, brand: { glyph: "微", color: "#e94b42", caption: "分享此刻的新鲜事" }
  },
  {
    id: "jike-post", group: "post", label: "即刻动态", shortLabel: "即刻", editorUrl: "https://web.okjike.com/",
    titleLimit: 2000, accountKey: "jike", hosts: ["web.okjike.com"], permission: "bundled", stage: "stable",
    media: { images: 9, video: true }, brand: { glyph: "J", color: "#e6be1f", caption: "和同好聊聊你的发现" }
  },
  {
    id: "x-post", group: "post", label: "X 动态", shortLabel: "X", editorUrl: "https://x.com/compose/post",
    titleLimit: 280, accountKey: "x", hosts: ["x.com", "twitter.com"], permission: "bundled", stage: "stable",
    media: { images: 4 }, textLimit: 280, brand: { glyph: "X", color: "#101419", caption: "标题会合并到正文，话题默认不同步到 X，按 X 规则计数" }
  }
] as const satisfies readonly PlatformDefinition[]
