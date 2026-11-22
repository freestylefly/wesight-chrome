import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** xueqiu-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const xueqiuPostAdapter = createPostCnAdapter({
  id: "xueqiu-post",
  name: "雪球",
  site: "雪球",
  composerLabels: ["发帖", "发讨论"],
  editor: [
    "[role='dialog'] [contenteditable='true']",
    "textarea[placeholder*='分享']",
    "[contenteditable='true'][data-placeholder*='分享']",
    "[contenteditable='true'][placeholder*='分享']"
  ],
  imageInput: IMAGE_INPUTS,
  topics: "hash-pair",
  loginText: /(?:手机号登录|验证码登录|密码登录|扫码登录)/
})
