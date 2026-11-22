import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** toutiao-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const toutiaoPostAdapter = createPostCnAdapter({
  id: "toutiao-post",
  name: "微头条",
  site: "今日头条",
  editor: [
    "[contenteditable='true'][data-placeholder*='有什么新鲜事']",
    "[contenteditable='true'][data-placeholder*='分享']",
    "textarea[placeholder*='有什么新鲜事']",
    ".ProseMirror[contenteditable='true']",
    "[contenteditable='true'][role='textbox']"
  ],
  imageInput: IMAGE_INPUTS,
  topics: "hash-pair",
  loginText: /(?:扫码登录|验证码登录|手机号登录|账密登录)/,
  textLimit: 2000
})
