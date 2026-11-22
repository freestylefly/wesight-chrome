import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** dedao-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const dedaoPostAdapter = createPostCnAdapter({
  id: "dedao-post",
  name: "得到知识城邦",
  site: "得到",
  composerLabels: ["发笔记", "写笔记"],
  editor: [
    "textarea[placeholder*='分享']",
    "textarea[placeholder*='想法']",
    "[contenteditable='true'][data-placeholder*='想法']",
    "[role='dialog'] [contenteditable='true']"
  ],
  imageInput: IMAGE_INPUTS,
  topics: "none",
  loginText: /(?:扫码登录|验证码登录|登录得到)/
})
