import { createTechArticleAdapter } from "~platforms/article-tech/site"

/** 人人都是产品经理: logged-out visitors to /writing are redirected to the home page. */
export const woshipmArticleAdapter = createTechArticleAdapter({
  id: "woshipm-article",
  siteName: "人人都是产品经理",
  titleSelectors: ["input[placeholder*='标题']", "textarea[placeholder*='标题']", "input[name='title']", "input#title"],
  editors: [
    { selector: "iframe[id^='ueditor_'], .edui-editor iframe, iframe[id$='_ifr'], iframe.cke_wysiwyg_frame", mode: "rich", frame: true },
    { selector: ".w-e-text[contenteditable='true'], .ProseMirror[contenteditable='true'], .ql-editor[contenteditable='true'], [contenteditable='true'][role='textbox']", mode: "rich" }
  ],
  editorPathPattern: /^\/writing(?:\/|$)/,
  settingsHint: "分类、标签、封面与摘要请在人人都是产品经理投稿设置中确认"
})
