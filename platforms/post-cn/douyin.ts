import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** douyin-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const douyinPostAdapter = createPostCnAdapter({
  id: "douyin-post",
  name: "抖音图文",
  site: "抖音创作者中心",
  modeLabels: ["发布图文"],
  imagesFirst: true,
  requiresImages: true,
  imageInput: IMAGE_INPUTS,
  editor: [
    "[contenteditable='true'][data-placeholder*='作品描述']",
    "[contenteditable='true'][data-placeholder*='简介']",
    "[contenteditable='true'][data-placeholder*='描述']",
    "textarea[placeholder*='描述']"
  ],
  title: ["input[placeholder*='作品标题']", "input[placeholder*='标题']"],
  titleLimit: 20,
  topics: "hash",
  loginText: /(?:扫码登录|验证码登录|密码登录)/,
  textLimit: 1000
})
