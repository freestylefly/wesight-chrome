import type { OVERSEAS_PLATFORMS } from "~platforms/catalog/overseas"
import { bskyPostAdapter } from "~platforms/overseas/bsky"
import { facebookPostAdapter } from "~platforms/overseas/facebook"
import { instagramPostAdapter } from "~platforms/overseas/instagram"
import { linkedinPostAdapter } from "~platforms/overseas/linkedin"
import { mediumArticleAdapter } from "~platforms/overseas/medium"
import { pinterestPostAdapter } from "~platforms/overseas/pinterest"
import { redditPostAdapter } from "~platforms/overseas/reddit"
import { substackArticleAdapter } from "~platforms/overseas/substack-article"
import { substackPostAdapter } from "~platforms/overseas/substack-post"
import { threadsPostAdapter } from "~platforms/overseas/threads"
import type { PlatformAdapter } from "~platforms/types"

/** 海外动态与文章（批 3）: one adapter per catalog entry in platforms/catalog/overseas.ts. */
export const OVERSEAS_ADAPTERS: Record<(typeof OVERSEAS_PLATFORMS)[number]["id"], PlatformAdapter> = {
  "bsky-post": bskyPostAdapter,
  "linkedin-post": linkedinPostAdapter,
  "threads-post": threadsPostAdapter,
  "reddit-post": redditPostAdapter,
  "facebook-post": facebookPostAdapter,
  "substack-post": substackPostAdapter,
  "pinterest-post": pinterestPostAdapter,
  "instagram-post": instagramPostAdapter,
  "medium-article": mediumArticleAdapter,
  "substack-article": substackArticleAdapter
}
