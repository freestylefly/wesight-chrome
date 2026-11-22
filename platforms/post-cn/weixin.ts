import { createPostCnAdapter, delay, IMAGE_INPUTS } from "~platforms/post-cn/common"

/** 贴图 editor route without the session token; the catalog editorUrl is this route. */
export const WEIXIN_POST_ROUTE = "/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN"

const EDITOR = [
  "[contenteditable='true'][data-placeholder*='描述']",
  "[contenteditable='true'][placeholder*='描述']",
  "textarea[placeholder*='描述']",
  ".ProseMirror[contenteditable='true']"
]

/** The mp.weixin.qq.com session token, from this URL or from links the console renders. */
export function weixinSessionToken(): string | null {
  const own = new URL(location.href).searchParams.get("token")
  if (own) return own
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href*='token=']")) {
    const match = /[?&]token=(\d+)/.exec(link.getAttribute("href") ?? "")
    if (match) return match[1]!
  }
  return null
}

/** weixin-post. Selectors are unverified until checked on the live page; see the batch hand-over note. */
export const weixinPostAdapter = createPostCnAdapter({
  id: "weixin-post",
  name: "公众号贴图",
  site: "微信公众平台",
  requiresImages: true,
  editor: EDITOR,
  title: ["textarea[placeholder*='标题']", "input[placeholder*='标题']"],
  titleLimit: 20,
  imageInput: IMAGE_INPUTS,
  topics: "none",
  loginText: /(?:使用账号登录|微信扫一扫|扫码登录|登录超时)/,
  textLimit: 1000,
  async beforeFill() {
    const url = new URL(location.href)
    const onEditor = url.pathname === "/cgi-bin/appmsg" && url.searchParams.get("type") === "77"
    if (onEditor && url.searchParams.get("token")) return null
    // Without a token the console redirects to its home page; read the token there and reopen the 贴图 route.
    const deadline = Date.now() + 8_000
    let token = weixinSessionToken()
    while (!token && Date.now() < deadline) {
      await delay(250)
      token = weixinSessionToken()
    }
    if (!token) throw new Error("未获取到公众号后台登录会话，请先登录微信公众平台，登录完成后从发布助手重试")
    const target = new URL(WEIXIN_POST_ROUTE, location.origin)
    target.searchParams.set("token", token)
    return { draftUrl: target.href, warnings: [], editorPending: true }
  }
})
