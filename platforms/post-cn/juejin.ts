import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** juejin-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const juejinPostAdapter = createPostCnAdapter({
  id: "juejin-post",
  name: "掘金沸点",
  site: "掘金",
  editor: [
    "[contenteditable='true'][data-placeholder*='分享']",
    "[contenteditable='true'][placeholder*='分享']",
    "textarea[placeholder*='分享']",
    "[contenteditable='true'][role='textbox']",
    ".rich-input[contenteditable='true']"
  ],
  imageInput: IMAGE_INPUTS,
  topics: "none",
  loginText: /(?:登录掘金|手机登录|扫码登录|密码登录)/,
  textLimit: 1000
})
