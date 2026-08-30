import type { PlasmoCSConfig } from "plasmo"

type CsdnFrameConfig = PlasmoCSConfig & {
  match_about_blank: boolean
}

export const config: CsdnFrameConfig = {
  matches: ["https://mp.csdn.net/*"],
  all_frames: true,
  match_about_blank: true,
  run_at: "document_start"
}

interface CsdnFrameFillMessage {
  source: "wesight-csdn-editor-parent"
  type: "FILL"
  requestId: string
  html: string
}

export function fillCsdnEditorFrameBody(html: string): boolean {
  const body = document.body
  if (!body?.matches(".cke_editable[contenteditable='true'], body[contenteditable='true'].htmledit_views")) return false
  body.focus()
  body.innerHTML = html
  body.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
  body.dispatchEvent(new Event("change", { bubbles: true }))
  body.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }))
  body.dispatchEvent(new Event("blur", { bubbles: true }))
  return true
}

function isFillMessage(value: unknown): value is CsdnFrameFillMessage {
  if (!value || typeof value !== "object") return false
  const message = value as Partial<CsdnFrameFillMessage>
  return message.source === "wesight-csdn-editor-parent"
    && message.type === "FILL"
    && typeof message.requestId === "string"
    && typeof message.html === "string"
}

window.addEventListener("message", event => {
  if (window === window.top || event.source !== window.parent || !isFillMessage(event.data)) return
  if (!fillCsdnEditorFrameBody(event.data.html)) return
  window.parent.postMessage({
    source: "wesight-csdn-editor-frame",
    type: "FILLED",
    requestId: event.data.requestId
  }, "*")
})
