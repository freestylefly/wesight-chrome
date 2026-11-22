import { BODY_FALLBACKS, DIGEST_FALLBACKS, TITLE_FALLBACKS } from "~platforms/article-media/common"
import { createArticleAdapter } from "~platforms/article-media/kit"

const HOST = "https://mp.weixin.qq.com"

/**
 * The 公众号 editor needs the session token that the backend puts into every
 * signed-in URL (`…/cgi-bin/home?t=home/index&token=123`). Read it from the
 * address bar first, then from same-site links on the page.
 */
export function weixinToken(): string | null {
  const fromUrl = new URL(location.href).searchParams.get("token")
  if (fromUrl && /^\d+$/.test(fromUrl)) return fromUrl
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='token=']"))) {
    try {
      const url = new URL(link.getAttribute("href") ?? "", HOST)
      const token = url.searchParams.get("token")
      if (url.hostname === "mp.weixin.qq.com" && token && /^\d+$/.test(token)) return token
    } catch {
      // Ignore malformed links.
    }
  }
  return null
}

export function isWeixinEditorPage(): boolean {
  return location.pathname === "/cgi-bin/appmsg"
    && /^media\/appmsg_edit/.test(new URL(location.href).searchParams.get("t") ?? "")
}

/** New-article editor URL; `type=77` is the current 图文 (article) type. UNVERIFIED: older accounts used `type=10`. */
export function weixinEditorUrl(token: string): string {
  const url = new URL("/cgi-bin/appmsg", HOST)
  url.searchParams.set("t", "media/appmsg_edit_v2")
  url.searchParams.set("action", "edit")
  url.searchParams.set("isNew", "1")
  url.searchParams.set("type", "77")
  url.searchParams.set("createType", "0")
  url.searchParams.set("token", token)
  url.searchParams.set("lang", "zh_CN")
  return url.toString()
}

export const weixinArticleAdapter = createArticleAdapter({
  id: "weixin-article",
  loginMessage: "请先扫码登录微信公众平台",
  loginSelectors: [".login__type__container", ".login_frame", "iframe[src*='loginpage']"],
  loginTexts: ["使用账号登录", "扫码登录"],
  // Every signed-in page carries the token; without it the home page is the QR login page.
  isLoggedOut: () => !weixinToken(),
  async beforeFill() {
    if (isWeixinEditorPage()) return null
    const token = weixinToken()
    if (!token) throw new Error("未读取到公众号登录凭据，请重新扫码登录后重试")
    // The background opens this URL in the same tab and sends the task again
    // when the editor reports ready, so filling happens on the editor page.
    return { draftUrl: weixinEditorUrl(token), warnings: [], editorPending: true }
  },
  title: ["textarea#title", "textarea[placeholder*='请在这里输入标题']", "input#title", ...TITLE_FALLBACKS],
  body: ["iframe#ueditor_0", ".edui-editor-iframeholder iframe", "#js_editor .ProseMirror[contenteditable='true']", ...BODY_FALLBACKS],
  digest: ["textarea#js_description", "textarea[name='digest']", ...DIGEST_FALLBACKS],
  // The 公众号 editor uploads pasted image files to its own CDN (mmbiz.qpic.cn).
  pasteImages: true,
  notes: ["封面、作者、原创与赞赏、合集请在公众号编辑页设置；请点击“保存为草稿”后再手动群发或发表"]
})
