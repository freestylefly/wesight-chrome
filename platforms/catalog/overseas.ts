import type { PlatformDefinition } from "~platforms/catalog/types"

/** 海外动态与文章（批 3）. Owned by one batch; add entries only together with their adapters. */
export const OVERSEAS_PLATFORMS = [
  {
    id: "bsky-post", group: "post", label: "Bluesky 动态", shortLabel: "Bluesky", editorUrl: "https://bsky.app/",
    titleLimit: 300, accountKey: "bsky", hosts: ["bsky.app"], permission: "optional", stage: "beta",
    media: { images: 4 }, textLimit: 300, brand: { glyph: "B", color: "#1185fe", caption: "按 300 字素计数，话题追加在正文末尾" }
  },
  {
    id: "linkedin-post", group: "post", label: "LinkedIn 动态", shortLabel: "LinkedIn", editorUrl: "https://www.linkedin.com/feed/",
    loginCheckUrl: "https://www.linkedin.com/feed/",
    titleLimit: 3000, accountKey: "linkedin", hosts: ["www.linkedin.com"], permission: "optional", stage: "beta",
    media: { images: 9 }, textLimit: 3000, brand: { glyph: "in", color: "#0a66c2", caption: "在职业社交网络分享观点" }
  },
  {
    id: "threads-post", group: "post", label: "Threads 动态", shortLabel: "Threads", editorUrl: "https://www.threads.com/",
    titleLimit: 500, accountKey: "threads", hosts: ["www.threads.com", "www.threads.net"], permission: "optional", stage: "beta",
    media: { images: 10 }, textLimit: 500, brand: { glyph: "@", color: "#101010", caption: "话题需在 Threads 中手动选择" }
  },
  {
    id: "reddit-post", group: "post", label: "Reddit 帖子", shortLabel: "Reddit", editorUrl: "https://www.reddit.com/submit",
    titleLimit: 300, accountKey: "reddit", hosts: ["www.reddit.com"], permission: "optional", stage: "beta",
    media: { images: 20 }, textLimit: 40000, brand: { glyph: "R", color: "#ff4500", caption: "需在 Reddit 中手动选择社区" }
  },
  {
    id: "facebook-post", group: "post", label: "Facebook 动态", shortLabel: "Facebook", editorUrl: "https://www.facebook.com/",
    titleLimit: 63206, accountKey: "facebook", hosts: ["www.facebook.com"], permission: "optional", stage: "beta",
    media: { images: 10 }, textLimit: 63206, brand: { glyph: "f", color: "#1877f2", caption: "和朋友分享近况" }
  },
  {
    id: "substack-post", group: "post", label: "Substack Notes", shortLabel: "Substack", editorUrl: "https://substack.com/home",
    titleLimit: 2000, accountKey: "substack", hosts: ["substack.com"], permission: "optional", stage: "beta",
    media: { images: 4 }, brand: { glyph: "S", color: "#ff6719", caption: "发一条 Substack 短笔记" }
  },
  {
    id: "pinterest-post", group: "post", label: "Pinterest Pin", shortLabel: "Pinterest", editorUrl: "https://www.pinterest.com/pin-creation-tool/",
    titleLimit: 100, accountKey: "pinterest", hosts: ["www.pinterest.com"], permission: "optional", stage: "beta",
    media: { images: 1, requiresMedia: true }, textLimit: 500, brand: { glyph: "P", color: "#e60023", caption: "需要一张图片，画板需手动选择" }
  },
  {
    id: "instagram-post", group: "post", label: "Instagram 图文", shortLabel: "Instagram", editorUrl: "https://www.instagram.com/",
    titleLimit: 2200, accountKey: "instagram", hosts: ["www.instagram.com"], permission: "optional", stage: "beta",
    media: { images: 10, requiresMedia: true }, textLimit: 2200, brand: { glyph: "IG", color: "#e1306c", caption: "网页版至少需要一张图片" }
  },
  {
    id: "medium-article", group: "article", label: "Medium 文章", shortLabel: "Medium", editorUrl: "https://medium.com/new-story",
    loginCheckUrl: "https://medium.com/new-story",
    titleLimit: 100, accountKey: "medium", hosts: ["medium.com"], permission: "optional", stage: "beta"
  },
  {
    // Substack posts are edited on <name>.substack.com; substack.com/settings lists
    // the user's publications. See platforms/overseas/substack-article.ts.
    id: "substack-article", group: "article", label: "Substack 文章", shortLabel: "Substack", editorUrl: "https://substack.com/settings",
    loginCheckUrl: "https://substack.com/settings",
    titleLimit: 200, accountKey: "substack", hosts: ["substack.com"], paths: ["^/settings(?:/|$)", "^/publish/post(?:/|$)"],
    permission: "optional", stage: "beta"
  }
] as const satisfies readonly PlatformDefinition[]
