import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** bilibili-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const bilibiliPostAdapter = createPostCnAdapter({
  id: "bilibili-post",
  name: "B站动态",
  site: "哔哩哔哩",
  editor: [
    "[contenteditable='true'][placeholder*='分享']",
    "[contenteditable='true'][data-placeholder*='分享']",
    "textarea[placeholder*='分享']",
    "[contenteditable='true'][role='textbox']",
    ".bili-rich-textarea__inner[contenteditable='true']"
  ],
  title: ["input[placeholder*='标题']"],
  titleLimit: 20,
  imageInput: IMAGE_INPUTS,
  topics: "hash-pair",
  loginText: /(?:扫描二维码登录|密码登录|短信登录|登录后你可以)/,
  textLimit: 1000
})
