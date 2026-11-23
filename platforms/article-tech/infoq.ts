import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** InfoQ 写作: drafts are created from the draft box, then edited in a rich-text editor. */
export const infoqArticleAdapter = createTechArticleAdapter({
  id: "infoq-article",
  siteName: "InfoQ 写作",
  titleSelectors: ["textarea[placeholder*='标题']", "input[placeholder*='标题']", "[contenteditable='true'][data-placeholder*='标题']"],
  editors: [
    { selector: ".ProseMirror[contenteditable='true']", mode: "rich" },
    { selector: ".CodeMirror", mode: "markdown" },
    { selector: ".cm-content", mode: "markdown" },
    { selector: "[contenteditable='true'][role='textbox'], [contenteditable='true'][data-placeholder*='正文']", mode: "rich" }
  ],
  // The header entry reads "写点什么"; accounts without writing rights land on /application.
  newDraftTexts: ["写点什么", "写文章", "新建草稿", "新建文章", "开始写作"],
  newDraftSelectors: [".write-btn"],
  blockedPages: [{ pattern: /^\/application(?:\/|$)/, message: "这个账号还不是 InfoQ 写作社区创作者，请先在 InfoQ 页面提交“成为创作者”申请，通过后再点重试" }],
  loginHosts: ["account.infoq.cn", "account.geekbang.org"],
  settingsHint: "标签、封面与摘要请在 InfoQ 写作发布设置中确认"
})
