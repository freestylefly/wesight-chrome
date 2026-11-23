import { buildEvent, errorData, redactText, sanitizeUrl, setSensitiveTerms, type DiagnosticEvent } from "~lib/diagnostics"
import type { ExtensionRequest } from "~types/messages"
import type { PlatformId, PublishTaskV1 } from "~types/protocol"

/**
 * Per-tab trace of one draft fill, kept in the content script and sent to the
 * background in one batch when the fill ends. Shared helpers (waitForAny,
 * findEditor, …) call noteSelector, so adapters need no changes of their own.
 */
interface Trace {
  platformId: PlatformId
  startedAt: number
  steps: string[]
  selectors: string[]
}

let trace: Trace | null = null
const MAX_STEPS = 60

function elapsed(): number {
  return trace ? Date.now() - trace.startedAt : 0
}

export function beginPageTrace(platformId: PlatformId, task: PublishTaskV1): void {
  setSensitiveTerms([
    task.article?.title,
    ...(task.article?.tags ?? []),
    task.source?.vaultPath,
    task.source?.vaultPath?.split("/").pop()?.replace(/\.md$/i, ""),
    ...task.assets.map(asset => asset.fileName),
    ...task.assets.map(asset => asset.fileName.replace(/\.[^.]+$/, ""))
  ])
  trace = { platformId, startedAt: Date.now(), steps: [], selectors: [] }
  traceStep(`页面脚本就绪 ${sanitizeUrl(location.href)}（readyState=${document.readyState}）`)
}

export function traceStep(message: string): void {
  if (!trace || trace.steps.length >= MAX_STEPS) return
  trace.steps.push(`+${elapsed()}ms ${redactText(message).slice(0, 200)}`)
}

/** Called by the shared lookup helpers with the selector that matched first. */
export function noteSelector(selector: string, role = "元素"): void {
  if (!trace) return
  const key = `${role}:${selector}`
  if (trace.selectors.includes(key)) return
  trace.selectors.push(key)
  traceStep(`找到${role}：${selector.slice(0, 160)}`)
}

/** Page structure without any of its text content, for "site changed" failures. */
export function pageStructure(): Record<string, unknown> {
  const visible = (element: Element) => {
    const html = element as HTMLElement
    return !html.hidden && html.getAttribute?.("aria-hidden") !== "true" && (html.offsetParent !== null || html.getClientRects?.().length > 0)
  }
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])"))
  const textareas = Array.from(document.querySelectorAll("textarea"))
  const editables = Array.from(document.querySelectorAll("[contenteditable='true'], [contenteditable=''], .ProseMirror, .ql-editor, .CodeMirror, .cm-editor"))
  const placeholders = [...inputs, ...textareas]
    .filter(visible)
    .map(element => element.getAttribute("placeholder") ?? element.getAttribute("aria-label") ?? "")
    .filter(Boolean)
    .slice(0, 10)
    .map(text => text.slice(0, 40))
  return {
    path: sanitizeUrl(location.href),
    readyState: document.readyState,
    inputs: inputs.filter(visible).length,
    textareas: textareas.filter(visible).length,
    editables: editables.length,
    iframes: document.querySelectorAll("iframe").length,
    fileInputs: document.querySelectorAll("input[type=file]").length,
    passwordInputs: document.querySelectorAll("input[type=password]").length,
    placeholders,
    editorClasses: [...new Set(editables.map(element => String(element.className || element.tagName).split(/\s+/)[0] ?? "").filter(Boolean))].slice(0, 8)
  }
}

export function endPageTrace(
  outcome: "ready" | "editor_pending" | "login_required" | "failed",
  details: { warnings?: readonly string[]; error?: unknown } = {}
): DiagnosticEvent | null {
  if (!trace) return null
  const { platformId } = trace
  const failed = outcome === "failed"
  const data: Record<string, unknown> = {
    outcome,
    durationMs: elapsed(),
    steps: trace.steps,
    matchedSelectors: trace.selectors,
    warnings: details.warnings?.length ? [...details.warnings] : undefined
  }
  if (failed) {
    const error = details.error
    const message = error instanceof Error ? error.message : String(error ?? "")
    data.missing = /未找到(.+)$/.exec(message)?.[1]
    data.errorName = error instanceof Error ? error.name : undefined
    Object.assign(data, { structure: JSON.stringify(pageStructure()) }, errorData(error))
  }
  trace = null
  const message = failed
    ? `填草稿失败：${details.error instanceof Error ? details.error.message : String(details.error ?? "")}`
    : `填草稿结束：${outcome}`
  return buildEvent(failed ? "error" : details.warnings?.length ? "warn" : "info", "draft", platformId, message, data)
}

export function pageEvent(
  level: DiagnosticEvent["level"],
  category: DiagnosticEvent["category"],
  scope: string,
  message: string,
  data?: Record<string, unknown>
): DiagnosticEvent {
  return buildEvent(level, category, scope, message, data)
}

/** Fire-and-forget delivery to the background, which owns the store. */
export function sendDiagnostics(events: readonly (DiagnosticEvent | null)[]): void {
  const list = events.filter((event): event is DiagnosticEvent => Boolean(event))
  if (!list.length) return
  try {
    void chrome.runtime.sendMessage({ type: "DIAGNOSTIC_EVENTS", events: list } satisfies ExtensionRequest).catch(() => undefined)
  } catch { /* Extension reloaded; the page has no background to talk to. */ }
}

/**
 * Report uncaught errors raised by the extension's own code in this page.
 * Page scripts' errors are ignored: they are the site's, not ours.
 */
export function installErrorCapture(scope: string): void {
  const ownFrame = (text: string | undefined) => Boolean(text && typeof chrome !== "undefined" && chrome.runtime?.id && text.includes(chrome.runtime.id))
  window.addEventListener("error", event => {
    if (!ownFrame(event.filename) && !ownFrame(event.error instanceof Error ? event.error.stack : undefined)) return
    sendDiagnostics([pageEvent("error", "error", scope, `未捕获异常：${event.message}`, errorData(event.error))])
  })
  window.addEventListener("unhandledrejection", event => {
    const reason: unknown = event.reason
    if (!(reason instanceof Error) || !ownFrame(reason.stack)) return
    sendDiagnostics([pageEvent("error", "error", scope, `未处理的 Promise 拒绝：${reason.message}`, errorData(reason))])
  })
}
