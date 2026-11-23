import { fillEditable, fillTextControl } from "~platforms/dom"

/**
 * Editor helpers shared by the 批 1a tech-community adapters. These sites use a
 * handful of editor families: plain Markdown textareas, CodeMirror 5/6 (often
 * wrapped by bytemd or editor.md), and rich-text contenteditable areas that may
 * sit inside a same-origin iframe (TinyMCE, UEditor, CKEditor 4). Content
 * scripts run in an isolated world, so editors are driven through DOM events
 * (paste / execCommand) rather than their JavaScript instances.
 */

export type EditorMode = "markdown" | "rich"

export interface EditorCandidate {
  selector: string
  mode: EditorMode
  /** The selector names iframes whose same-origin body is the editable area. */
  frame?: boolean
}

export type EditorKind = "textarea" | "codemirror5" | "codemirror6" | "contenteditable"

export interface FoundEditor {
  element: HTMLElement
  /** Element whose text reflects what the editor shows, for verification. */
  display: HTMLElement
  mode: EditorMode
  kind: EditorKind
}

/** Text of the final action buttons the adapters must never click. */
export const FINAL_ACTION_PATTERN = /发布|发表|提交|publish|submit/i

function editableBody(frame: HTMLIFrameElement): HTMLElement | null {
  try {
    const frameDocument = frame.contentDocument ?? frame.contentWindow?.document
    const body = frameDocument?.body
    if (!body) return null
    if (body.getAttribute("contenteditable") === "true" || frameDocument.designMode === "on") return body
    return body.querySelector<HTMLElement>("[contenteditable='true']")
  } catch {
    return null // Cross-origin frames cannot be filled from the content script.
  }
}

function hiddenByAttribute(element: Element): boolean {
  return Boolean(element.closest("[hidden], [aria-hidden='true']"))
}

function classify(element: HTMLElement, mode: EditorMode): FoundEditor | null {
  const cm5Host = element.closest<HTMLElement>(".CodeMirror")
  if (cm5Host) {
    const textarea = element instanceof HTMLTextAreaElement ? element : cm5Host.querySelector<HTMLTextAreaElement>("textarea")
    if (!textarea) return null
    return { element: textarea, display: cm5Host.querySelector<HTMLElement>(".CodeMirror-code, .CodeMirror-lines") ?? cm5Host, mode, kind: "codemirror5" }
  }
  const cm6Host = element.closest<HTMLElement>(".cm-editor")
  if (cm6Host) {
    const content = element.matches(".cm-content") ? element : cm6Host.querySelector<HTMLElement>(".cm-content")
    if (!content) return null
    return { element: content, display: content, mode, kind: "codemirror6" }
  }
  if (element instanceof HTMLTextAreaElement) return { element, display: element, mode, kind: "textarea" }
  if (element.getAttribute("contenteditable") === "true" || element.isContentEditable || element.ownerDocument.designMode === "on") {
    return { element, display: element, mode, kind: "contenteditable" }
  }
  return null
}

export function findEditor(candidates: readonly EditorCandidate[]): FoundEditor | null {
  for (const candidate of candidates) {
    if (candidate.frame) {
      for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>(candidate.selector))) {
        const body = editableBody(frame)
        if (body) return { element: body, display: body, mode: candidate.mode, kind: "contenteditable" }
      }
      continue
    }
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(candidate.selector))) {
      if (hiddenByAttribute(element) && !element.closest(".CodeMirror")) continue
      const found = classify(element, candidate.mode)
      if (found) return found
    }
  }
  return null
}

export async function waitForEditor(candidates: readonly EditorCandidate[], timeoutMs = 20_000): Promise<FoundEditor | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = findEditor(candidates)
    if (found || Date.now() >= deadline) return found
    await new Promise(resolve => window.setTimeout(resolve, 250))
  }
}

function normalized(text: string): string {
  return text.replace(/\s+/g, "")
}

function shows(display: HTMLElement, expected: string): boolean {
  const target = normalized(expected).slice(0, 16)
  if (!target) return true
  const current = display instanceof HTMLTextAreaElement ? display.value : display.textContent ?? ""
  return normalized(current).includes(target)
}

function execCommand(element: HTMLElement, command: string, value?: string): boolean {
  try {
    const owner = element.ownerDocument
    return typeof owner.execCommand === "function" && owner.execCommand(command, false, value)
  } catch {
    return false
  }
}

function pastePlainText(element: HTMLElement, text: string): void {
  if (typeof ClipboardEvent === "undefined" || typeof DataTransfer === "undefined") return
  const clipboardData = new DataTransfer()
  clipboardData.setData("text/plain", text)
  element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }))
}

/** Fills a Markdown source editor. Returns false when the editor did not take the text. */
export function fillMarkdownEditor(editor: FoundEditor, markdown: string): boolean {
  const { element, display, kind } = editor
  if (kind === "textarea") {
    fillTextControl(element as HTMLTextAreaElement, markdown)
    return (element as HTMLTextAreaElement).value === markdown
  }
  element.focus()
  // CodeMirror 6 and contenteditable editors follow the DOM selection, so a
  // retry replaces the previous attempt instead of appending to it.
  if (kind !== "codemirror5") execCommand(element, "selectAll")
  pastePlainText(element, markdown)
  if (shows(display, markdown)) return true
  execCommand(element, "insertText", markdown)
  return shows(display, markdown)
}

/** Fills a rich-text editor with sanitized HTML, falling back to plain text. */
export function fillRichEditor(editor: FoundEditor, html: string, text: string): boolean {
  const { element, display } = editor
  if (editor.kind === "textarea") {
    fillTextControl(element as HTMLTextAreaElement, html)
    return true
  }
  element.focus()
  execCommand(element, "selectAll")
  fillEditable(element, html, text)
  return Boolean(normalized(display.textContent ?? ""))
}

/** Title fields are inputs, textareas, or (rarely) a contenteditable heading. */
export function fillTitleControl(element: HTMLElement, title: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    fillTextControl(element, title)
    return
  }
  element.focus()
  element.textContent = title
  const EventConstructor = element.ownerDocument.defaultView?.Event ?? Event
  element.dispatchEvent(new EventConstructor("input", { bubbles: true }))
  element.dispatchEvent(new EventConstructor("blur", { bubbles: true }))
}

/** Finds a "new draft" button or link by its text, never a final publish action. */
export function findActionByText(texts: readonly string[], extraSelectors: readonly string[] = []): HTMLElement | null {
  const controls = document.querySelectorAll<HTMLElement>(["button", "a", "[role='button']", ...extraSelectors].join(", "))
  for (const control of Array.from(controls)) {
    const label = (control.textContent ?? "").replace(/\s+/g, "")
    if (!label || FINAL_ACTION_PATTERN.test(label) || hiddenByAttribute(control)) continue
    if (texts.some(text => label === text || (label.length <= text.length + 4 && label.includes(text)))) return control
  }
  return null
}
