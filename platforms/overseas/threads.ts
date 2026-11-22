import { loginPageDetected } from "~platforms/dom"
import { findAction, queryVisible } from "~platforms/overseas/common"
import { createComposerPostAdapter } from "~platforms/overseas/post-adapter"

/* Threads web composer (Lexical in a dialog). Meta markup changes often; UNVERIFIED. */
const OPEN_LABELS = [/^what'?s new\??$/i, /^create$/i, /^new thread$/i]
const EDITOR_SELECTORS = [
  "[role='dialog'] [contenteditable='true'][role='textbox']",
  "[role='dialog'] [contenteditable='true']"
]

function loginRequired(): boolean {
  if (loginPageDetected()) return true
  if (queryVisible(EDITOR_SELECTORS) || findAction(OPEN_LABELS)) return false
  return !!findAction([/^log in$/i, /^continue with instagram$/i])
}

export const threadsPostAdapter = createComposerPostAdapter({
  id: "threads-post",
  platform: "Threads",
  loginRequired,
  openLabels: OPEN_LABELS,
  editorSelectors: EDITOR_SELECTORS,
  imageInputSelectors: [
    "[role='dialog'] input[type='file'][accept*='image']",
    "input[type='file'][accept*='image']"
  ],
  imageRevealLabels: [/^attach media$/i, /^add media$/i],
  imageLimit: 10,
  textLimit: 500,
  hashtags: false,
  tagsSkippedWarning: "Threads 每条只能添加一个话题，已跳过标签，请在编辑页手动选择话题"
})
