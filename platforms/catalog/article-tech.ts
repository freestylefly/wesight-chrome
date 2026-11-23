import type { PlatformDefinition } from "~platforms/catalog/types"

/** 国内技术社区文章（批 1a）. Owned by one batch; add entries only together with their adapters. */
export const ARTICLE_TECH_PLATFORMS = [
  {
    id: "cnblogs-article", group: "article", label: "博客园文章", shortLabel: "博客园", editorUrl: "https://i.cnblogs.com/articles/edit",
    titleLimit: 100, accountKey: "cnblogs", hosts: ["i.cnblogs.com", "account.cnblogs.com", "passport.cnblogs.com"], permission: "optional", stage: "beta",
    brand: { glyph: "博", color: "#1e5aa8" }
  },
  {
    id: "51cto-article", group: "article", label: "51CTO 博客", shortLabel: "51CTO", editorUrl: "https://blog.51cto.com/blogger/publish",
    titleLimit: 100, accountKey: "51cto", hosts: ["blog.51cto.com", "home.51cto.com"], permission: "optional", stage: "beta",
    brand: { glyph: "51", color: "#e3292f" }
  },
  {
    id: "infoq-article", group: "article", label: "InfoQ 写作", shortLabel: "InfoQ", editorUrl: "https://xie.infoq.cn/draftbox",
    titleLimit: 60, accountKey: "infoq", hosts: ["xie.infoq.cn", "account.infoq.cn", "account.geekbang.org"], permission: "optional", stage: "beta",
    account: { url: "https://account.infoq.cn/serv/v1/user/auth", name: "data.nick", avatar: "data.avatar" },
    brand: { glyph: "Q", color: "#0a6c38" }
  },
  {
    id: "segmentfault-article", group: "article", label: "思否文章", shortLabel: "思否", editorUrl: "https://segmentfault.com/write",
    titleLimit: 100, accountKey: "segmentfault", hosts: ["segmentfault.com"], permission: "optional", stage: "beta",
    brand: { glyph: "思", color: "#009a61" }
  },
  {
    id: "aliyun-article", group: "article", label: "阿里云开发者社区", shortLabel: "阿里云", editorUrl: "https://developer.aliyun.com/article/new",
    titleLimit: 64, accountKey: "aliyun", hosts: ["developer.aliyun.com", "account.aliyun.com", "signin.aliyun.com", "passport.aliyun.com"], permission: "optional", stage: "beta",
    brand: { glyph: "阿", color: "#ff6a00" }
  },
  {
    id: "tencentcloud-article", group: "article", label: "腾讯云开发者社区", shortLabel: "腾讯云", editorUrl: "https://cloud.tencent.com/developer/article/write-new",
    titleLimit: 80, accountKey: "tencentcloud", hosts: ["cloud.tencent.com"], permission: "optional", stage: "beta",
    brand: { glyph: "腾", color: "#006eff" }
  },
  {
    id: "volcengine-article", group: "article", label: "火山引擎开发者社区", shortLabel: "火山引擎", editorUrl: "https://developer.volcengine.com/articles/draft",
    titleLimit: 64, accountKey: "volcengine", hosts: ["developer.volcengine.com", "console.volcengine.com"], permission: "optional", stage: "beta",
    brand: { glyph: "火", color: "#1664ff" }
  },
  {
    id: "oschina-article", group: "article", label: "OSChina 博客", shortLabel: "OSChina", editorUrl: "https://my.oschina.net/",
    titleLimit: 100, accountKey: "oschina", hosts: ["my.oschina.net", "www.oschina.net"], permission: "optional", stage: "beta",
    brand: { glyph: "OS", color: "#009966" }
  },
  {
    id: "jianshu-article", group: "article", label: "简书", shortLabel: "简书", editorUrl: "https://www.jianshu.com/writer",
    titleLimit: 100, accountKey: "jianshu", hosts: ["www.jianshu.com"], permission: "optional", stage: "beta",
    brand: { glyph: "简", color: "#ea6f5a" }
  },
  {
    id: "sspai-article", group: "article", label: "少数派", shortLabel: "少数派", editorUrl: "https://sspai.com/write",
    titleLimit: 60, accountKey: "sspai", hosts: ["sspai.com"], permission: "optional", stage: "beta",
    brand: { glyph: "派", color: "#d71a1b" }
  },
  {
    id: "woshipm-article", group: "article", label: "人人都是产品经理", shortLabel: "人人都是PM", editorUrl: "https://www.woshipm.com/writing",
    titleLimit: 50, accountKey: "woshipm", hosts: ["www.woshipm.com"], permission: "optional", stage: "beta",
    brand: { glyph: "PM", color: "#0080ff" }
  }
] as const satisfies readonly PlatformDefinition[]
