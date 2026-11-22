import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** 少数派: rich-text editor on /write. */
export const sspaiArticleAdapter = createTechArticleAdapter({
  id: "sspai-article",
  siteName: "少数派",
  titleSelectors: ["textarea[placeholder*='标题']", "input[placeholder*='标题']", "[contenteditable='true'][data-placeholder*='标题']"],
  editors: [
    { selector: ".ck-editor__editable[contenteditable='true']", mode: "rich" },
    { selector: ".ProseMirror[contenteditable='true']", mode: "rich" },
    { selector: "[contenteditable='true'][role='textbox'], [contenteditable='true'][data-placeholder*='正文']", mode: "rich" }
  ],
  loginUrlPattern: /\/(?:login|signin|signup)(?:[/?#]|$)/,
  settingsHint: "题图、摘要与投稿设置请在少数派编辑页确认"
})
