import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** maimai-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const maimaiPostAdapter = createPostCnAdapter({
  id: "maimai-post",
  name: "脉脉动态",
  site: "脉脉",
  composerLabels: ["发动态"],
  editor: [
    "textarea[placeholder*='分享']",
    "textarea[placeholder*='说点什么']",
    "[contenteditable='true'][data-placeholder*='分享']",
    "[role='dialog'] [contenteditable='true']"
  ],
  imageInput: IMAGE_INPUTS,
  topics: "none",
  loginText: /(?:登录脉脉|扫码登录|验证码登录)/
})
