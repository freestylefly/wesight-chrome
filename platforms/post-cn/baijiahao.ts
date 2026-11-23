import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** baijiahao-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const baijiahaoPostAdapter = createPostCnAdapter({
  id: "baijiahao-post",
  name: "百家号动态",
  site: "百家号",
  editor: [
    "textarea[placeholder*='分享']",
    "textarea[placeholder*='动态']",
    "[contenteditable='true'][data-placeholder*='分享']",
    "[contenteditable='true'][placeholder*='分享']"
  ],
  imageInput: IMAGE_INPUTS,
  topics: "none",
  loginText: /(?:登录百家号|扫码登录|短信登录)/,
  textLimit: 1000
})
