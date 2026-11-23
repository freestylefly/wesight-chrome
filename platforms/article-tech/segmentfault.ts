import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** 思否: Markdown editor (CodeMirror) with a title input above it. */
export const segmentfaultArticleAdapter = createTechArticleAdapter({
  id: "segmentfault-article",
  siteName: "思否",
  titleSelectors: ["input[placeholder*='标题']", "textarea[placeholder*='标题']", "input#title", "input[name='title']"],
  editors: [
    { selector: ".CodeMirror", mode: "markdown" },
    { selector: ".cm-content", mode: "markdown" },
    { selector: "textarea[placeholder*='Markdown' i], textarea[placeholder*='正文'], textarea[placeholder*='内容']", mode: "markdown" }
  ],
  loginUrlPattern: /\/user\/(?:login|register)(?:[/?#]|$)/,
  settingsHint: "标签、封面与文章类型请在思否发布设置中确认"
})
