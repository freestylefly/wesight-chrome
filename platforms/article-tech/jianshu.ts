import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** 简书: the writer opens on a notebook; a new note is created with "新建文章". */
export const jianshuArticleAdapter = createTechArticleAdapter({
  id: "jianshu-article",
  siteName: "简书",
  titleSelectors: ["input[placeholder*='标题']", "input[name='title']", "#root input[type='text']:not([placeholder*='搜索'])"],
  editors: [
    { selector: "#arthur-editor", mode: "markdown" },
    { selector: ".CodeMirror", mode: "markdown" },
    { selector: "textarea[placeholder*='Markdown' i], textarea[placeholder*='正文']", mode: "markdown" },
    { selector: ".kalamu-area[contenteditable='true'], [contenteditable='true'][role='textbox']", mode: "rich" }
  ],
  newDraftTexts: ["新建文章"],
  loginUrlPattern: /\/sign_(?:in|up)(?:[/?#]|$)/,
  settingsHint: "简书没有标签与封面设置，文集与发布选项请在简书编辑页确认"
})
