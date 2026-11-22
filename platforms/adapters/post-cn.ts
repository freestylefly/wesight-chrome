import type { POST_CN_PLATFORMS } from "~platforms/catalog/post-cn"
import { baijiahaoPostAdapter } from "~platforms/post-cn/baijiahao"
import { bilibiliPostAdapter } from "~platforms/post-cn/bilibili"
import { dedaoPostAdapter } from "~platforms/post-cn/dedao"
import { doubanPostAdapter } from "~platforms/post-cn/douban"
import { douyinPostAdapter } from "~platforms/post-cn/douyin"
import { juejinPostAdapter } from "~platforms/post-cn/juejin"
import { kuaishouPostAdapter } from "~platforms/post-cn/kuaishou"
import { maimaiPostAdapter } from "~platforms/post-cn/maimai"
import { shipinhaoPostAdapter } from "~platforms/post-cn/shipinhao"
import { toutiaoPostAdapter } from "~platforms/post-cn/toutiao"
import { weixinPostAdapter } from "~platforms/post-cn/weixin"
import { xiaoheihePostAdapter } from "~platforms/post-cn/xiaoheihe"
import { xueqiuPostAdapter } from "~platforms/post-cn/xueqiu"
import { zhihuPostAdapter } from "~platforms/post-cn/zhihu"
import { zsxqPostAdapter } from "~platforms/post-cn/zsxq"
import type { PlatformAdapter } from "~platforms/types"

/** 国内动态（批 2）: one adapter per catalog entry in platforms/catalog/post-cn.ts. */
export const POST_CN_ADAPTERS: Record<(typeof POST_CN_PLATFORMS)[number]["id"], PlatformAdapter> = {
  "toutiao-post": toutiaoPostAdapter,
  "zhihu-post": zhihuPostAdapter,
  "bilibili-post": bilibiliPostAdapter,
  "juejin-post": juejinPostAdapter,
  "douyin-post": douyinPostAdapter,
  "kuaishou-post": kuaishouPostAdapter,
  "xueqiu-post": xueqiuPostAdapter,
  "douban-post": doubanPostAdapter,
  "zsxq-post": zsxqPostAdapter,
  "shipinhao-post": shipinhaoPostAdapter,
  "xiaoheihe-post": xiaoheihePostAdapter,
  "maimai-post": maimaiPostAdapter,
  "dedao-post": dedaoPostAdapter,
  "weixin-post": weixinPostAdapter,
  "baijiahao-post": baijiahaoPostAdapter
}
