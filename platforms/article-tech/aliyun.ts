import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** 阿里云开发者社区: Markdown editor on /article/new. */
export const aliyunArticleAdapter = createTechArticleAdapter({
  id: "aliyun-article",
  siteName: "阿里云开发者社区",
  titleSelectors: ["input[placeholder*='标题']", "textarea[placeholder*='标题']", "input[name='title']"],
  editors: [
    { selector: ".bytemd-editor .CodeMirror", mode: "markdown" },
    { selector: ".CodeMirror", mode: "markdown" },
    { selector: ".cm-content", mode: "markdown" },
    { selector: "textarea[placeholder*='Markdown' i], textarea[placeholder*='正文'], textarea[placeholder*='内容']", mode: "markdown" },
    { selector: ".ProseMirror[contenteditable='true'], [contenteditable='true'][role='textbox']", mode: "rich" }
  ],
  loginHosts: ["account.aliyun.com", "signin.aliyun.com", "passport.aliyun.com"],
  settingsHint: "分类、标签、摘要与封面请在阿里云开发者社区发布设置中确认"
})
