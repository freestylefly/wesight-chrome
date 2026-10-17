import { Marked } from "marked"

import { platformPlainText, sanitizePlatformHtml } from "~lib/content"

const marked = new Marked({ gfm: true, breaks: false, async: false })

export const ASSET_TOKEN_PREFIX = "wesight-asset://"

export function assetToken(assetId: string): string {
  return `${ASSET_TOKEN_PREFIX}${assetId}`
}

/** Renders Markdown to the sanitized HTML subset the platform adapters accept. Needs a DOM. */
export function markdownToHtml(markdown: string): string {
  const parsed = new DOMParser().parseFromString(marked.parse(markdown) as string, "text/html")
  for (const input of Array.from(parsed.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    const mark = parsed.createElement("span")
    mark.className = "wesight-wechat-task-checkbox"
    mark.dataset.checked = String(input.checked)
    mark.textContent = input.checked ? "☑" : "☐"
    input.replaceWith(mark)
  }
  return sanitizePlatformHtml(parsed.body.innerHTML)
}

export function referencedAssetIds(...sources: string[]): Set<string> {
  const ids = new Set<string>()
  for (const source of sources) {
    for (const match of source.matchAll(/wesight-asset:\/\/([A-Za-z0-9_-]+)/g)) ids.add(match[1]!)
  }
  return ids
}

export function stripMarkdownImages(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function stripHtmlImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, "")
}

export function articleStats(html: string): { characters: number; images: number } {
  const text = platformPlainText(html).replace(/\s+/g, "")
  return {
    characters: Array.from(text).length,
    images: (html.match(/<img\b/gi) ?? []).length
  }
}
