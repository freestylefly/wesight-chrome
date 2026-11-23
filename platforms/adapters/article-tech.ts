import { cto51ArticleAdapter } from "~platforms/article-tech/51cto"
import { aliyunArticleAdapter } from "~platforms/article-tech/aliyun"
import { cnblogsArticleAdapter } from "~platforms/article-tech/cnblogs"
import { infoqArticleAdapter } from "~platforms/article-tech/infoq"
import { jianshuArticleAdapter } from "~platforms/article-tech/jianshu"
import { oschinaArticleAdapter } from "~platforms/article-tech/oschina"
import { segmentfaultArticleAdapter } from "~platforms/article-tech/segmentfault"
import { sspaiArticleAdapter } from "~platforms/article-tech/sspai"
import { tencentcloudArticleAdapter } from "~platforms/article-tech/tencentcloud"
import { volcengineArticleAdapter } from "~platforms/article-tech/volcengine"
import { woshipmArticleAdapter } from "~platforms/article-tech/woshipm"
import type { ARTICLE_TECH_PLATFORMS } from "~platforms/catalog/article-tech"
import type { PlatformAdapter } from "~platforms/types"

/** 国内技术社区文章（批 1a）: one adapter per catalog entry in platforms/catalog/article-tech.ts. */
export const ARTICLE_TECH_ADAPTERS: Record<(typeof ARTICLE_TECH_PLATFORMS)[number]["id"], PlatformAdapter> = {
  "cnblogs-article": cnblogsArticleAdapter,
  "51cto-article": cto51ArticleAdapter,
  "infoq-article": infoqArticleAdapter,
  "segmentfault-article": segmentfaultArticleAdapter,
  "aliyun-article": aliyunArticleAdapter,
  "tencentcloud-article": tencentcloudArticleAdapter,
  "volcengine-article": volcengineArticleAdapter,
  "oschina-article": oschinaArticleAdapter,
  "jianshu-article": jianshuArticleAdapter,
  "sspai-article": sspaiArticleAdapter,
  "woshipm-article": woshipmArticleAdapter
}
