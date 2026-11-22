import { loginPageDetected } from "~platforms/dom"
import { findAction, queryVisible } from "~platforms/overseas/common"
import { createComposerPostAdapter } from "~platforms/overseas/post-adapter"

/*
 * Bluesky web (bsky.app, React Native Web + TipTap). UNVERIFIED selectors are
 * listed in the batch hand-over note.
 */
const OPEN_LABELS = [/^new post$/i, /^compose new post$/i, /^compose post$/i]
const EDITOR_SELECTORS = [
  "[role='dialog'] [data-testid='composerTextInput'] [contenteditable='true']",
  "[role='dialog'] .ProseMirror[contenteditable='true']",
  "[role='dialog'] [contenteditable='true'][role='textbox']",
  "[data-testid='composerTextInput'] [contenteditable='true']"
]

function loginRequired(): boolean {
  if (loginPageDetected()) return true
  if (queryVisible(EDITOR_SELECTORS) || findAction(OPEN_LABELS)) return false
  return !!findAction([/^sign in$/i, /^create account$/i])
}

export const bskyPostAdapter = createComposerPostAdapter({
  id: "bsky-post",
  platform: "Bluesky",
  loginRequired,
  openLabels: OPEN_LABELS,
  editorSelectors: EDITOR_SELECTORS,
  imageInputSelectors: [
    "[role='dialog'] input[type='file'][accept*='image']",
    "input[type='file'][accept*='image']"
  ],
  // Bluesky creates its file input only while the native picker is open; its
  // editor accepts pasted images instead.
  pasteImages: true,
  imageLimit: 4,
  textLimit: 300,
  countGraphemes: true,
  hashtags: true
})
