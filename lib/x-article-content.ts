import { sanitizePlatformHtml } from "~lib/content"

export interface XContentState {
  blocks: Array<{
    key: string
    text: string
    type: string
    data: Record<string, unknown>
    entity_ranges: Array<{ key: number; offset: number; length: number }>
    inline_style_ranges: Array<{ style: string; offset: number; length: number }>
  }>
  entity_map: Array<{ key: number; value: { type: string; mutability: string; data: Record<string, unknown> } }>
}

/** Convert sanitized article HTML without touching X's live editor or React state. */
export function xArticleContent(html: string, media: ReadonlyMap<string, string>): XContentState {
  const root = new DOMParser().parseFromString(sanitizePlatformHtml(html), "text/html").body
  const result: XContentState = { blocks: [], entity_map: [] }
  let block: XContentState["blocks"][number] | null = null
  const fresh = (type: string) => ({ key: `ws${result.blocks.length.toString(36)}`, text: "", type, data: {}, entity_ranges: [], inline_style_ranges: [] })
  const flush = () => {
    if (block?.text.trim()) result.blocks.push(block)
    block = null
  }
  const entity = (type: string, data: Record<string, unknown>, mutability = "Immutable") => {
    const key = result.entity_map.length
    result.entity_map.push({ key, value: { type, mutability, data } })
    return key
  }
  const atomic = (type: string, data: Record<string, unknown>, mutability = "Immutable") => {
    flush()
    result.blocks.push({ ...fresh("atomic"), text: " ", entity_ranges: [{ key: entity(type, data, mutability), offset: 0, length: 1 }] })
  }
  const append = (text: string, type: string, styles: string[], link?: number) => {
    if (!text) return
    block ??= fresh(type)
    const offset = block.text.length
    block.text += text
    for (const style of new Set(styles)) block.inline_style_ranges.push({ style, offset, length: text.length })
    if (link !== undefined) block.entity_ranges.push({ key: link, offset, length: text.length })
  }
  const walk = (node: Node, type = "unstyled", styles: string[] = [], link?: number): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ")
      if (text.trim() || block) append(text, type, styles, link)
      return
    }
    if (!(node instanceof Element)) return
    const tag = node.tagName
    if (tag === "IMG") {
      const source = node.getAttribute("src") ?? ""
      const id = media.get(source)
      if (!id) throw new Error("X 正文图片尚未完成上传，已停止创建草稿")
      atomic("MEDIA", { media_items: [{ local_media_id: result.entity_map.length, media_id: id, media_category: "DraftTweetImage" }] })
      return
    }
    if (tag === "HR") { atomic("DIVIDER", {}); return }
    if (tag === "BR") { append("\n", type, styles, link); return }
    if (tag === "PRE") {
      const text = node.textContent ?? ""
      const language = /(?:^|\s)language-([\w+-]+)/.exec(node.querySelector("code")?.className ?? "")?.[1] ?? ""
      const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)))
      atomic("MARKDOWN", { markdown: `\n${fence}${language}\n${text.replace(/\n$/, "")}\n${fence}\n` }, "Mutable")
      return
    }
    if (tag === "TABLE") {
      const rows = Array.from(node.querySelectorAll("tr"), row => Array.from(row.querySelectorAll("th,td"), cell => (cell.textContent ?? "").trim().replace(/\|/g, "\\|").replace(/\n/g, "<br>")))
      if (rows.length) {
        const width = Math.max(...rows.map(row => row.length))
        const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`
        atomic("MARKDOWN", { markdown: `\n${[line(rows[0]!), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n")}\n` }, "Mutable")
      }
      return
    }
    const isBlock = /^(P|DIV|SECTION|ARTICLE|FIGURE|FIGCAPTION|H[1-6]|BLOCKQUOTE|LI|UL|OL)$/.test(tag)
    const nextType = /^H[12]$/.test(tag) ? "header-one" : /^H[3-6]$/.test(tag) ? "header-two"
      : tag === "BLOCKQUOTE" ? "blockquote"
        : tag === "LI" ? node.parentElement?.tagName === "OL" ? "ordered-list-item" : "unordered-list-item" : type
    if (isBlock) flush()
    const nextStyles = [...styles]
    if (/^(STRONG|B)$/.test(tag)) nextStyles.push("Bold")
    if (/^(EM|I)$/.test(tag)) nextStyles.push("Italic")
    if (/^(DEL|S|STRIKE)$/.test(tag)) nextStyles.push("Strikethrough")
    const href = tag === "A" ? node.getAttribute("href") : null
    const nextLink = href && /^https?:\/\//i.test(href) ? entity("LINK", { url: href }, "Mutable") : link
    for (const child of Array.from(node.childNodes)) walk(child, nextType, nextStyles, nextLink)
    if (isBlock) flush()
  }
  for (const node of Array.from(root.childNodes)) walk(node)
  flush()
  return result
}
