import { normalizeDraft, xImageWarning } from "~lib/article-preparation"
import type { ComposeDraft } from "~lib/draft-store"
import { referencedAssetIds, stripHtmlImages, stripMarkdownImages } from "~lib/markdown"
import {
  ARTICLE_PLATFORM_IDS,
  PROTOCOL_VERSION,
  TASK_TTL_MS,
  type ArticlePlatformId,
  type PublishTaskV1
} from "~types/protocol"

export interface ComposeTaskOptions {
  taskId: string
  keepImages: boolean
  xSkipExcessImages?: boolean
  maxTargets: number | null
  now?: number
}

export function validateComposeTargets(targets: string[], maxTargets: number | null): ArticlePlatformId[] {
  const unique = Array.from(new Set(targets))
  if (!unique.length) throw new Error("请至少选择一个发布平台")
  if (!unique.every(target => ARTICLE_PLATFORM_IDS.includes(target as ArticlePlatformId))) {
    throw new Error("包含不支持的发布平台")
  }
  if (maxTargets === 0) throw new Error("请先登录 WeSight 后再同步平台")
  if (maxTargets !== null && unique.length > maxTargets) throw new Error("非会员仅支持一个平台")
  return unique as ArticlePlatformId[]
}

function sourcePath(draft: ComposeDraft): string {
  if (draft.source.kind === "obsidian") return draft.source.vaultPath
  if (draft.source.kind === "file") return draft.source.fileName
  return draft.source.url
}

/** Turns the publish-center draft into the task shape the platform adapters already consume. */
export function buildComposeTask(
  draft: ComposeDraft,
  targets: string[],
  options: ComposeTaskOptions
): PublishTaskV1 {
  const selected = validateComposeTargets(targets, options.maxTargets)
  draft = normalizeDraft(draft)
  const imageWarning = xImageWarning(draft, selected, options.keepImages)
  if (imageWarning && !options.xSkipExcessImages) throw new Error(imageWarning)
  const title = draft.title.trim()
  if (!title) throw new Error("请填写文章标题")
  const markdown = options.keepImages ? draft.markdown : stripMarkdownImages(draft.markdown)
  const html = options.keepImages ? draft.html : stripHtmlImages(draft.html)
  if (!markdown.trim() && !html.trim()) throw new Error("正文为空，无法同步")

  const used = referencedAssetIds(markdown, html)
  if (draft.coverAssetId) used.add(draft.coverAssetId)
  const assets = draft.assets.filter(asset => used.has(asset.id))
  const coverAssetId = draft.coverAssetId && assets.some(asset => asset.id === draft.coverAssetId)
    ? draft.coverAssetId
    : null
  const now = options.now ?? Date.now()

  return {
    protocolVersion: PROTOCOL_VERSION,
    taskId: options.taskId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TASK_TTL_MS).toISOString(),
    source: { vaultPath: sourcePath(draft), contentHash: draft.id },
    article: {
      title,
      digest: draft.digest.trim(),
      markdown,
      html,
      coverAssetId,
      tags: draft.tags,
      ...(draft.original === undefined ? {} : { original: draft.original })
    },
    assets,
    ...(selected.includes("x-article") && options.xSkipExcessImages
      ? { targetOptions: { xArticle: { skipExcessImages: true } } } : {}),
    targets: selected,
    behavior: { finalAction: "manual", groupTabs: true }
  }
}
