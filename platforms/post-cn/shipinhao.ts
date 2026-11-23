import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** shipinhao-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const shipinhaoPostAdapter = createPostCnAdapter({
  id: "shipinhao-post",
  name: "视频号图文",
  site: "视频号助手",
  requiresImages: true,
  imagesFirst: true,
  imageInput: IMAGE_INPUTS,
  editor: [
    "[contenteditable][data-placeholder*='描述']",
    "textarea[placeholder*='描述']",
    ".input-editor[contenteditable]"
  ],
  title: ["input[placeholder*='标题']"],
  titleLimit: 20,
  topics: "hash",
  loginText: /(?:微信扫码登录|扫码登录)/,
  textLimit: 1000
})
