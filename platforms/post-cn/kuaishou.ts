import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** kuaishou-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const kuaishouPostAdapter = createPostCnAdapter({
  id: "kuaishou-post",
  name: "快手图文",
  site: "快手创作者服务平台",
  modeLabels: ["上传图文", "发布图文"],
  imagesFirst: true,
  requiresImages: true,
  imageInput: IMAGE_INPUTS,
  editor: [
    "#work-description-edit",
    "[contenteditable='true'][placeholder*='描述']",
    "[contenteditable='true'][data-placeholder*='描述']",
    "textarea[placeholder*='描述']"
  ],
  topics: "hash",
  loginText: /(?:扫码登录|验证码登录|密码登录)/,
  textLimit: 500
})
