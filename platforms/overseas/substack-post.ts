import { findAction, queryVisible } from "~platforms/overseas/common"
import { createComposerPostAdapter } from "~platforms/overseas/post-adapter"

/* Substack Notes composer on substack.com (ProseMirror in a dialog). UNVERIFIED. */
const OPEN_LABELS = [/^what'?s on your mind\??$/i, /^new note$/i, /^write a note$/i]
const EDITOR_SELECTORS = [
  "[role='dialog'] .ProseMirror[contenteditable='true']",
  "[role='dialog'] [contenteditable='true']"
]

export function substackLoginRequired(): boolean {
  if (/^\/(?:sign-in|account\/login)/.test(location.pathname)) return true
  return !!findAction([/^sign in$/i]) && !findAction([/^create$/i, /^dashboard$/i, ...OPEN_LABELS])
}

function loginRequired(): boolean {
  if (queryVisible(EDITOR_SELECTORS)) return false
  return substackLoginRequired()
}

export const substackPostAdapter = createComposerPostAdapter({
  id: "substack-post",
  platform: "Substack",
  loginRequired,
  openLabels: OPEN_LABELS,
  editorSelectors: EDITOR_SELECTORS,
  imageInputSelectors: ["[role='dialog'] input[type='file'][accept*='image']"],
  imageRevealLabels: [/^add image$/i, /^image$/i],
  pasteImages: true,
  imageLimit: 4,
  hashtags: false,
  tagsSkippedWarning: "Substack Notes 不使用话题标签，已跳过标签"
})
