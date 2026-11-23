import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** zhihu-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const zhihuPostAdapter = createPostCnAdapter({
  id: "zhihu-post",
  name: "知乎想法",
  site: "知乎",
  composerLabels: ["写想法", "发想法", "想法"],
  editor: [
    "[role='dialog'] [contenteditable='true'][role='textbox']",
    "[role='dialog'] [contenteditable='true']",
    "[contenteditable='true'][aria-label*='想法']",
    "[contenteditable='true'][data-placeholder*='想法']",
    "textarea[placeholder*='想法']"
  ],
  title: ["[role='dialog'] input[placeholder*='标题']", "input[placeholder*='添加标题']"],
  titleLimit: 50,
  imageInput: ["[role='dialog'] input[type='file'][accept*='image']", ...IMAGE_INPUTS],
  topics: "none",
  loginText: /(?:验证码登录|密码登录|扫码登录|登录知乎)/,
  textLimit: 1000
})
