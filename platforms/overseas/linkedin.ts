import { loginPageDetected } from "~platforms/dom"
import { findAction, queryVisible } from "~platforms/overseas/common"
import { createComposerPostAdapter } from "~platforms/overseas/post-adapter"

/* LinkedIn share box (Quill editor in a dialog). UNVERIFIED selectors: see hand-over note. */
const OPEN_LABELS = [/^start a post/i, /^create a post$/i]
const EDITOR_SELECTORS = [
  "[role='dialog'] .ql-editor[contenteditable='true']",
  "[role='dialog'] [contenteditable='true'][role='textbox']",
  "[aria-label*='Text editor for creating content'][contenteditable='true']"
]

function loginRequired(): boolean {
  if (loginPageDetected() || /^\/(?:authwall|checkpoint|uas\/login|signup)/.test(location.pathname)) return true
  if (queryVisible(EDITOR_SELECTORS) || findAction(OPEN_LABELS)) return false
  return !!findAction([/^sign in$/i, /^join now$/i])
}

function accountName(): string | undefined {
  const photo = document.querySelector<HTMLImageElement>("img.global-nav__me-photo[alt]")
  return photo?.alt.trim() || undefined
}

export const linkedinPostAdapter = createComposerPostAdapter({
  id: "linkedin-post",
  platform: "LinkedIn",
  loginRequired,
  accountName,
  openLabels: OPEN_LABELS,
  editorSelectors: EDITOR_SELECTORS,
  imageInputSelectors: [
    "[role='dialog'] input[type='file'][accept*='image']",
    "input#media-editor-file-selector__file-input",
    "input[type='file'][accept*='image']"
  ],
  imageRevealLabels: [/^add (?:a )?media$/i, /^add (?:a )?photo$/i],
  imageLimit: 9,
  textLimit: 3000,
  hashtags: true,
  imageNote: "LinkedIn 可能先显示图片编辑窗口，请在其中确认图片后返回发帖框，再手动发布"
})
