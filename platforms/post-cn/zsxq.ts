import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** zsxq-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const zsxqPostAdapter = createPostCnAdapter({
  id: "zsxq-post",
  name: "知识星球",
  site: "知识星球",
  composerLabels: ["点击发表主题", "发表主题"],
  editor: [
    "[contenteditable='true'][data-placeholder*='主题']",
    "textarea[placeholder*='主题']",
    "[role='dialog'] [contenteditable='true']",
    ".ql-editor[contenteditable='true']"
  ],
  imageInput: IMAGE_INPUTS,
  topics: "none",
  loginText: /(?:微信扫码登录|扫码登录|手机号登录)/
})
