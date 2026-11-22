import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** 51CTO 博客: Markdown (CodeMirror) or rich-text editor depending on the user's choice. */
export const cto51ArticleAdapter = createTechArticleAdapter({
  id: "51cto-article",
  siteName: "51CTO",
  titleSelectors: ["input[placeholder*='标题']", "textarea[placeholder*='标题']", "input#title", "input[name='title']"],
  editors: [
    { selector: ".CodeMirror", mode: "markdown" },
    { selector: ".cm-content", mode: "markdown" },
    { selector: "textarea[placeholder*='Markdown' i], textarea[placeholder*='正文']", mode: "markdown" },
    { selector: "iframe[id^='ueditor_'], .edui-editor iframe, iframe.cke_wysiwyg_frame, iframe[id$='_ifr']", mode: "rich", frame: true },
    { selector: ".ProseMirror[contenteditable='true'], .w-e-text[contenteditable='true'], [contenteditable='true'][role='textbox']", mode: "rich" }
  ],
  loginHosts: ["home.51cto.com"],
  settingsHint: "分类、标签与原创声明请在 51CTO 发布设置中确认"
})
