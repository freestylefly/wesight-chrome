import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** The OSChina blog editor lives under the user's id: /u/<uid>/blog/ai-write. */
export function oschinaEditorRoute(): string | null {
  if (/^\/u\/\d+\/blog\/ai-write(?:\/|$)/.test(location.pathname)) return location.href
  const own = location.pathname.match(/^\/u\/(\d+)(?:\/|$)/)?.[1]
  const linked = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/u/']"))
    .map(link => link.getAttribute("href")?.match(/(?:^|my\.oschina\.net)\/u\/(\d+)(?:\/|$)/)?.[1])
    .find(Boolean)
  const uid = own ?? linked
  return uid ? `https://my.oschina.net/u/${uid}/blog/ai-write` : null
}

/** OSChina 博客: Markdown or rich-text editor, reached through the user's space. */
export const oschinaArticleAdapter = createTechArticleAdapter({
  id: "oschina-article",
  siteName: "OSChina",
  titleSelectors: ["input[placeholder*='标题']", "textarea[placeholder*='标题']", "input[name='title']"],
  editors: [
    { selector: ".CodeMirror", mode: "markdown" },
    { selector: ".cm-content", mode: "markdown" },
    { selector: "textarea[placeholder*='Markdown' i], textarea[placeholder*='正文'], textarea[placeholder*='内容']", mode: "markdown" },
    { selector: "iframe.cke_wysiwyg_frame, iframe[id$='_ifr']", mode: "rich", frame: true },
    { selector: ".ProseMirror[contenteditable='true'], .ck-editor__editable[contenteditable='true'], [contenteditable='true'][role='textbox']", mode: "rich" }
  ],
  loginUrlPattern: /\/home\/login(?:[/?#]|$)/,
  editorRoute: oschinaEditorRoute,
  settingsHint: "分类、标签与原创声明请在 OSChina 发布设置中确认"
})
