/**
 * Selector fallbacks shared by the 自媒体号 editors. Site files list their
 * specific selectors first; every entry here is a semantic guess (placeholder,
 * role, contenteditable) and is listed as unverified in the hand-over notes.
 */
export const TITLE_FALLBACKS = [
  "textarea[placeholder*='标题']",
  "input[placeholder*='标题']",
  "[contenteditable='true'][data-placeholder*='标题']",
  "[contenteditable='true'][placeholder*='标题']"
]

export const BODY_FALLBACKS = [
  ".ProseMirror[contenteditable='true']",
  "iframe[id^='ueditor_']",
  ".edui-editor-iframeholder iframe",
  ".ql-editor[contenteditable='true']",
  ".w-e-text[contenteditable='true']",
  "[contenteditable='true'][data-placeholder*='正文']",
  "[contenteditable='true'][role='textbox']",
  "div[contenteditable='true']"
]

export const DIGEST_FALLBACKS = [
  "textarea[placeholder*='摘要']",
  "input[placeholder*='摘要']",
  "textarea[placeholder*='导语']",
  "textarea[placeholder*='简介']"
]

export const TAG_FALLBACKS = [
  "input[placeholder*='标签']",
  "input[placeholder*='话题']"
]

/** Cover inputs are only matched inside a container that names the cover. */
export const COVER_FALLBACKS = [
  "[class*='cover' i] input[type='file']",
  "[aria-label*='封面'] input[type='file']",
  "[data-testid*='cover' i] input[type='file']"
]

/** Image inputs are only matched inside the editor toolbar so a cover input never matches. */
export const TOOLBAR_IMAGE_INPUTS = [
  "[role='toolbar'] input[type='file'][accept*='image']",
  "[class*='toolbar' i] input[type='file'][accept*='image']",
  ".edui-toolbar input[type='file']"
]

export const TOOLBAR_IMAGE_TRIGGERS = [
  "[role='toolbar'] [aria-label='图片']",
  "[role='toolbar'] [title='图片']",
  "[class*='toolbar' i] [aria-label='图片']",
  "[class*='toolbar' i] [title='图片']",
  "[class*='toolbar' i] [title='插入图片']",
  "[class*='toolbar' i] [aria-label='插入图片']"
]

export const QR_LOGIN_TEXTS = ["扫码登录", "密码登录", "账号登录", "立即登录", "登录/注册", "去登录"]
