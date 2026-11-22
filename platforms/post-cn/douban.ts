import { createPostCnAdapter, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** douban-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const doubanPostAdapter = createPostCnAdapter({
  id: "douban-post",
  name: "豆瓣广播",
  site: "豆瓣",
  editor: [
    "textarea#isay-cont",
    "textarea[name='comment']",
    "textarea[placeholder*='分享']",
    "[contenteditable='true'][data-placeholder*='分享']"
  ],
  imageInput: ["input[type='file'][name='image']", ...IMAGE_INPUTS],
  topics: "none",
  loginText: /(?:短信登录\/注册|密码登录|登录豆瓣)/
})
