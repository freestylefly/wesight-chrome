import { loginPageDetected } from "~platforms/dom"
import { createComposerPostAdapter } from "~platforms/overseas/post-adapter"

/* Facebook "Create post" dialog (Lexical). Meta markup changes often; UNVERIFIED. */
function loginRequired(): boolean {
  return loginPageDetected() || /^\/(?:login|checkpoint)/.test(location.pathname)
}

export const facebookPostAdapter = createComposerPostAdapter({
  id: "facebook-post",
  platform: "Facebook",
  loginRequired,
  openLabels: [/^what'?s on your mind/i, /^create (?:a )?post$/i],
  editorSelectors: [
    "[role='dialog'] [contenteditable='true'][role='textbox']",
    "[role='dialog'] [contenteditable='true']"
  ],
  imageInputSelectors: ["[role='dialog'] input[type='file'][accept*='image']"],
  imageRevealLabels: [/^photo\/video$/i, /^add photos\/videos$/i],
  imageLimit: 10,
  textLimit: 63206,
  hashtags: true
})
