/**
 * Declarative specs for the 自媒体号 article editors that need no custom flow.
 * Selectors are semantic (placeholder / aria-label / role / text) and have NOT
 * been checked against the live pages yet; see the batch hand-over notes.
 */
import {
  BODY_FALLBACKS,
  COVER_FALLBACKS,
  DIGEST_FALLBACKS,
  QR_LOGIN_TEXTS,
  TAG_FALLBACKS,
  TITLE_FALLBACKS,
  TOOLBAR_IMAGE_INPUTS,
  TOOLBAR_IMAGE_TRIGGERS
} from "~platforms/article-media/common"
import { createArticleAdapter } from "~platforms/article-media/kit"

export const qqArticleAdapter = createArticleAdapter({
  id: "qq-article",
  loginMessage: "请先登录企鹅号（腾讯内容开放平台）",
  loginSelectors: ["iframe[src*='ptlogin2.qq.com']", "iframe[src*='xui.ptlogin2']"],
  loginTexts: QR_LOGIN_TEXTS,
  isLoggedOut: () => /^\/userAuth/i.test(location.pathname),
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='请输入标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["分类、封面样式和发布设置请在企鹅号编辑页确认"]
})

export const baijiahaoArticleAdapter = createArticleAdapter({
  id: "baijiahao-article",
  loginMessage: "请先登录百家号",
  loginHosts: ["passport.baidu.com"],
  loginTexts: ["登录百家号", ...QR_LOGIN_TEXTS],
  isLoggedOut: () => /\/builder\/theme\/bjh\/login/i.test(location.pathname),
  title: ["textarea[placeholder*='请输入标题']", "input[placeholder*='请输入标题']", ...TITLE_FALLBACKS],
  // The news editor is a UEditor instance rendered into a same-origin iframe.
  body: ["iframe#ueditor_0", "iframe[id^='ueditor_']", ...BODY_FALLBACKS],
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["封面（单图/三图）、分类和作者声明请在百家号编辑页确认"]
})

export const neteaseArticleAdapter = createArticleAdapter({
  id: "netease-article",
  loginMessage: "请先登录网易号",
  loginSelectors: ["iframe[src*='dl.reg.163.com']", "iframe[id*='x-URS-iframe']"],
  loginTexts: QR_LOGIN_TEXTS,
  isLoggedOut: () => /^#\/(?:login|register)/i.test(location.hash),
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='请输入标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["封面、分类和原创/转载声明请在网易号编辑页确认"]
})

export const sohuArticleAdapter = createArticleAdapter({
  id: "sohu-article",
  loginMessage: "请先登录搜狐号",
  loginTexts: QR_LOGIN_TEXTS,
  isLoggedOut: () => /\/login/i.test(location.pathname) || /login/i.test(location.hash),
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='请输入标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["封面、栏目和信息来源声明请在搜狐号编辑页确认"]
})

export const douyinArticleAdapter = createArticleAdapter({
  id: "douyin-article",
  loginMessage: "请先登录抖音创作者中心",
  loginTexts: ["扫码登录", "验证码登录", "密码登录"],
  title: ["input[placeholder*='请输入文章标题']", "textarea[placeholder*='请输入文章标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["封面、话题和可见范围请在抖音文章编辑页确认"]
})

export const zsxqArticleAdapter = createArticleAdapter({
  id: "zsxq-article",
  loginMessage: "请先扫码登录知识星球",
  loginSelectors: [".login-container", "[class*='qrcode' i] img[src*='qrcode' i]"],
  loginTexts: ["微信扫码登录", "手机号登录", ...QR_LOGIN_TEXTS],
  isLoggedOut: () => /^\/login/i.test(location.pathname),
  // The article editor is opened from a chosen 星球 (发表 → 写文章); give the user time.
  editorTimeoutMs: 60_000,
  missingEditorMessage: "知识星球需要先进入目标星球并打开“写文章”编辑器，打开后请重试",
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  notes: ["目标星球、标签和是否同步为主题请在知识星球编辑页确认"]
})

export const smzdmArticleAdapter = createArticleAdapter({
  id: "smzdm-article",
  loginMessage: "请先登录什么值得买",
  loginHosts: ["zhiyou.smzdm.com"],
  loginTexts: QR_LOGIN_TEXTS,
  title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["投稿类型、关联商品、封面和频道请在什么值得买投稿页确认"]
})

export const xueqiuArticleAdapter = createArticleAdapter({
  id: "xueqiu-article",
  loginMessage: "请先登录雪球",
  loginTexts: QR_LOGIN_TEXTS,
  title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["股票标签、封面和专栏设置请在雪球编辑页确认"]
})

export const eastmoneyArticleAdapter = createArticleAdapter({
  id: "eastmoney-article",
  loginMessage: "请先登录东方财富财富号",
  loginHosts: ["passport2.eastmoney.com"],
  loginTexts: QR_LOGIN_TEXTS,
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["关联股票、封面和风险提示请在财富号编辑页确认"]
})

export const tonghuashunArticleAdapter = createArticleAdapter({
  id: "tonghuashun-article",
  loginMessage: "请先登录同花顺号",
  loginHosts: ["upass.10jqka.com.cn"],
  loginTexts: QR_LOGIN_TEXTS,
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["关联股票、封面和栏目请在同花顺号编辑页确认"]
})

export const yidianArticleAdapter = createArticleAdapter({
  id: "yidian-article",
  loginMessage: "请先登录一点资讯一点号",
  loginTexts: QR_LOGIN_TEXTS,
  isLoggedOut: () => /^#\/(?:login|Login)/.test(location.hash),
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["封面、分类和定时设置请在一点号编辑页确认"]
})

export const dayuArticleAdapter = createArticleAdapter({
  id: "dayu-article",
  loginMessage: "请先登录大鱼号",
  loginTexts: QR_LOGIN_TEXTS,
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["封面、分类和原创声明请在大鱼号编辑页确认"]
})

export const topnewsArticleAdapter = createArticleAdapter({
  id: "topnews-article",
  loginMessage: "请先登录顶端号",
  loginTexts: QR_LOGIN_TEXTS,
  isLoggedOut: () => /^#\/login/i.test(location.hash),
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["封面、栏目和发布设置请在顶端号编辑页确认"]
})

export const kuaichuanArticleAdapter = createArticleAdapter({
  id: "kuaichuan-article",
  loginMessage: "请先登录 360 快传号",
  loginTexts: QR_LOGIN_TEXTS,
  isLoggedOut: () => /^#\/login/i.test(location.hash),
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["封面、分类和原创声明请在快传号编辑页确认"]
})

export const autohomeArticleAdapter = createArticleAdapter({
  id: "autohome-article",
  loginMessage: "请先登录汽车之家车家号",
  loginHosts: ["account.autohome.com.cn"],
  loginTexts: QR_LOGIN_TEXTS,
  title: ["input[placeholder*='请输入标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["关联车系、封面和分类请在车家号编辑页确认"]
})

export const dongchediArticleAdapter = createArticleAdapter({
  id: "dongchedi-article",
  loginMessage: "请先登录懂车帝懂车号",
  loginTexts: ["扫码登录", "验证码登录", "密码登录"],
  title: ["input[placeholder*='请输入文章标题']", "textarea[placeholder*='标题']", ...TITLE_FALLBACKS],
  body: BODY_FALLBACKS,
  digest: DIGEST_FALLBACKS,
  tags: TAG_FALLBACKS,
  imageInputs: TOOLBAR_IMAGE_INPUTS,
  imageTriggers: TOOLBAR_IMAGE_TRIGGERS,
  coverInputs: COVER_FALLBACKS,
  notes: ["关联车系、封面和声明请在懂车号编辑页确认"]
})
