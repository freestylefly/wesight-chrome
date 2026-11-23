import {
  autohomeArticleAdapter,
  baijiahaoArticleAdapter,
  dayuArticleAdapter,
  dongchediArticleAdapter,
  douyinArticleAdapter,
  eastmoneyArticleAdapter,
  kuaichuanArticleAdapter,
  neteaseArticleAdapter,
  qqArticleAdapter,
  smzdmArticleAdapter,
  sohuArticleAdapter,
  tonghuashunArticleAdapter,
  topnewsArticleAdapter,
  xueqiuArticleAdapter,
  yidianArticleAdapter,
  zsxqArticleAdapter
} from "~platforms/article-media/sites"
import { weixinArticleAdapter } from "~platforms/article-media/weixin"
import type { ARTICLE_MEDIA_PLATFORMS } from "~platforms/catalog/article-media"
import type { PlatformAdapter } from "~platforms/types"

/** 国内自媒体号文章（批 1b）: one adapter per catalog entry in platforms/catalog/article-media.ts. */
export const ARTICLE_MEDIA_ADAPTERS: Record<(typeof ARTICLE_MEDIA_PLATFORMS)[number]["id"], PlatformAdapter> = {
  "weixin-article": weixinArticleAdapter,
  "qq-article": qqArticleAdapter,
  "baijiahao-article": baijiahaoArticleAdapter,
  "netease-article": neteaseArticleAdapter,
  "sohu-article": sohuArticleAdapter,
  "douyin-article": douyinArticleAdapter,
  "zsxq-article": zsxqArticleAdapter,
  "smzdm-article": smzdmArticleAdapter,
  "xueqiu-article": xueqiuArticleAdapter,
  "eastmoney-article": eastmoneyArticleAdapter,
  "tonghuashun-article": tonghuashunArticleAdapter,
  "yidian-article": yidianArticleAdapter,
  "dayu-article": dayuArticleAdapter,
  "topnews-article": topnewsArticleAdapter,
  "kuaichuan-article": kuaichuanArticleAdapter,
  "autohome-article": autohomeArticleAdapter,
  "dongchedi-article": dongchediArticleAdapter
}
