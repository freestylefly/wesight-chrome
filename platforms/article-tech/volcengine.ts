import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** 火山引擎开发者社区: Markdown editor on /articles/draft. */
export const volcengineArticleAdapter = createTechArticleAdapter({
  id: "volcengine-article",
  siteName: "火山引擎开发者社区",
  titleSelectors: ["input[placeholder*='标题']", "textarea[placeholder*='标题']", "input[name='title']"],
  editors: [
    { selector: ".bytemd-editor .CodeMirror", mode: "markdown" },
    { selector: ".CodeMirror", mode: "markdown" },
    { selector: ".cm-content", mode: "markdown" },
    { selector: "textarea[placeholder*='Markdown' i], textarea[placeholder*='正文']", mode: "markdown" },
    { selector: ".ProseMirror[contenteditable='true'], [contenteditable='true'][role='textbox']", mode: "rich" }
  ],
  loginHosts: ["console.volcengine.com"],
  settingsHint: "标签、分类与封面请在火山引擎开发者社区发布设置中确认"
})
