import { ARTICLE_MEDIA_ADAPTERS } from "~platforms/adapters/article-media"
import { ARTICLE_TECH_ADAPTERS } from "~platforms/adapters/article-tech"
import { OVERSEAS_ADAPTERS } from "~platforms/adapters/overseas"
import { PODCAST_ADAPTERS } from "~platforms/adapters/podcast"
import { POST_CN_ADAPTERS } from "~platforms/adapters/post-cn"
import { VIDEO_ADAPTERS } from "~platforms/adapters/video"
import { bilibiliAdapter } from "~platforms/bilibili"
import { csdnAdapter } from "~platforms/csdn"
import { jikePostAdapter } from "~platforms/jike-post"
import { juejinAdapter } from "~platforms/juejin"
import { toutiaoAdapter } from "~platforms/toutiao"
import type { PlatformAdapter } from "~platforms/types"
import { weiboAdapter } from "~platforms/weibo"
import { weiboPostAdapter } from "~platforms/weibo-post"
import { xArticleAdapter } from "~platforms/x-article"
import { xPostAdapter } from "~platforms/x-post"
import { xiaohongshuAdapter } from "~platforms/xiaohongshu"
import { zhihuAdapter } from "~platforms/zhihu"
import type { CORE_PLATFORMS } from "~platforms/catalog/core"
import type { PlatformId } from "~types/protocol"

const CORE_ADAPTERS: Record<(typeof CORE_PLATFORMS)[number]["id"], PlatformAdapter> = {
  zhihu: zhihuAdapter,
  csdn: csdnAdapter,
  juejin: juejinAdapter,
  "bilibili-article": bilibiliAdapter,
  toutiao: toutiaoAdapter,
  "weibo-article": weiboAdapter,
  "x-article": xArticleAdapter,
  xiaohongshu: xiaohongshuAdapter,
  "weibo-post": weiboPostAdapter,
  "jike-post": jikePostAdapter,
  "x-post": xPostAdapter
}

// Each batch owns its adapter file, so parallel work never edits this map.
export const PLATFORM_ADAPTERS: Record<PlatformId, PlatformAdapter> = {
  ...CORE_ADAPTERS,
  ...ARTICLE_TECH_ADAPTERS,
  ...ARTICLE_MEDIA_ADAPTERS,
  ...POST_CN_ADAPTERS,
  ...OVERSEAS_ADAPTERS,
  ...VIDEO_ADAPTERS,
  ...PODCAST_ADAPTERS
}
