import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** 腾讯云开发者社区: Markdown or rich-text editor on /developer/article/write-new. */
export const tencentcloudArticleAdapter = createTechArticleAdapter({
  id: "tencentcloud-article",
  siteName: "腾讯云开发者社区",
  titleSelectors: ["textarea[placeholder*='标题']", "input[placeholder*='标题']", "input[name='title']"],
  editors: [
    { selector: ".CodeMirror", mode: "markdown" },
    { selector: ".cm-content", mode: "markdown" },
    { selector: "textarea[placeholder*='Markdown' i], textarea[placeholder*='正文']", mode: "markdown" },
    { selector: ".ProseMirror[contenteditable='true'], .public-DraftEditor-content[contenteditable='true'], [contenteditable='true'][role='textbox']", mode: "rich" }
  ],
  loginUrlPattern: /^https:\/\/[^/]+\/login(?:[/?#]|$)/,
  settingsHint: "标签、来源声明与封面请在腾讯云开发者社区发布设置中确认"
})
