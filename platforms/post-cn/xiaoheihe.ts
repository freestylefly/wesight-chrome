import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** xiaoheihe-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const xiaoheihePostAdapter = createPostCnAdapter({
  id: "xiaoheihe-post",
  name: "小黑盒图文",
  site: "小黑盒",
  editor: [
    "[contenteditable='true'][data-placeholder*='正文']",
    "[contenteditable='true'][placeholder*='正文']",
    "textarea[placeholder*='正文']",
    ".ProseMirror[contenteditable='true']"
  ],
  title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']"],
  titleLimit: 30,
  imageInput: IMAGE_INPUTS,
  topics: "none",
  loginText: /(?:扫码登录|验证码登录|手机号登录)/
})
