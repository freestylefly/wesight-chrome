import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** 博客园: the editor follows the user's default editor setting (Markdown textarea or TinyMCE). */
export const cnblogsArticleAdapter = createTechArticleAdapter({
  id: "cnblogs-article",
  siteName: "博客园",
  titleSelectors: ["#post-title", "input[placeholder*='标题']", "input[name='title']", "input[formcontrolname='title']"],
  editors: [
    { selector: "#md-editor", mode: "markdown" },
    { selector: "textarea[placeholder*='Markdown' i]", mode: "markdown" },
    { selector: ".CodeMirror", mode: "markdown" },
    { selector: ".cm-content", mode: "markdown" },
    { selector: "iframe#postBodyEditor_ifr, iframe[id$='_ifr'], iframe.tox-edit-area__iframe", mode: "rich", frame: true },
    { selector: "[contenteditable='true'][role='textbox']", mode: "rich" }
  ],
  tagInputSelectors: ["input[placeholder*='标签']", "input[formcontrolname='tags']"],
  loginHosts: ["account.cnblogs.com", "passport.cnblogs.com"],
  settingsHint: "分类、摘要与发布选项请在博客园编辑页下方确认"
})
