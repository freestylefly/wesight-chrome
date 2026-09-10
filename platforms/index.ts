import { bilibiliAdapter } from "~platforms/bilibili"
import { csdnAdapter } from "~platforms/csdn"
import { juejinAdapter } from "~platforms/juejin"
import { toutiaoAdapter } from "~platforms/toutiao"
import type { PlatformAdapter } from "~platforms/types"
import { weiboAdapter } from "~platforms/weibo"
import { weiboPostAdapter } from "~platforms/weibo-post"
import { xiaohongshuAdapter } from "~platforms/xiaohongshu"
import { jikePostAdapter } from "~platforms/jike-post"
import { zhihuAdapter } from "~platforms/zhihu"
import type { PlatformId } from "~types/protocol"

export const PLATFORM_ADAPTERS: Record<PlatformId, PlatformAdapter> = {
  zhihu: zhihuAdapter,
  csdn: csdnAdapter,
  juejin: juejinAdapter,
  "bilibili-article": bilibiliAdapter,
  toutiao: toutiaoAdapter,
  "weibo-article": weiboAdapter,
  xiaohongshu: xiaohongshuAdapter,
  "weibo-post": weiboPostAdapter,
  "jike-post": jikePostAdapter
}
