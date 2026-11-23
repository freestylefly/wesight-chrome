/**
 * Local diagnostics for test builds. Everything stays in chrome.storage.local
 * on the tester's machine until they export a file themselves; nothing is
 * uploaded. Privacy rules (enforced here, not by callers):
 * - no article body, title, tags, image content or file names
 * - no cookies, tokens or URL query/hash; URLs keep host + path only
 * - account names are reduced to "read or not" (or first character + *)
 */

export type DiagnosticLevel = "info" | "warn" | "error"
export type DiagnosticCategory = "env" | "login" | "draft" | "upload" | "error" | "event" | "log"
export type DiagnosticValue = string | number | boolean | null | string[]

export interface DiagnosticEvent {
  at: string
  level: DiagnosticLevel
  category: DiagnosticCategory
  scope: string
  message: string
  data?: Record<string, DiagnosticValue>
}

export const DIAGNOSTICS_KEY = "wesight_diagnostic_events_v1"
export const SELF_CHECK_KEY = "wesight_platform_self_check_v1"
const MAX_EVENTS = 600
const MAX_TEXT = 500

const SECRET_KEY_PATTERN = /cookie|token|secret|password|passwd|authorization|session|ticket|csrf|xsrf|signature|credential/i
const SECRET_PARAM = /([?&#;])((?:access_?|refresh_?|id_?)?token|secret|pair|ticket|code|session(?:id)?|sid|auth|key|sign(?:ature)?|cookie|csrf|xsrf|passport|uid)=[^&#\s;,"']+/gi
const SECRET_ASSIGNMENT = /(^|[\s,;{(])((?:access_?|refresh_?|id_?)?token|secret|password|cookie|ticket|session_?id|csrf_?token)\s*[=:]\s*[^\s,;"'}]+/gi
const URL_IN_TEXT = /\b(?:https?|wss?|chrome-extension):\/\/[^\s"'<>，。；、）)]+/gi
const FILE_NAME = /[^\s/\\"'“”‘’()（）:：,，]{1,120}\.(?:png|jpe?g|gif|webp|bmp|svg|heic|avif|mp4|mov|m4v|webm|mp3|m4a|wav|md|pdf|docx?)\b/gi

let sensitiveTerms: string[] = []

/**
 * Article titles, tags and file names of the running task. Any occurrence in a
 * diagnostic message is replaced before it is stored, so adapter error texts
 * that quote the title or an image name never leave the tester's draft.
 */
export function setSensitiveTerms(terms: readonly (string | undefined | null)[]): void {
  sensitiveTerms = [...new Set(terms.map(term => term?.trim() ?? "").filter(term => term.length >= 2))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 200)
}

/** Keeps the origin's host and the path; long ids in the path become ":id". */
export function sanitizeUrl(value: string | undefined | null): string {
  if (!value) return ""
  try {
    const url = new URL(value)
    if (url.protocol === "data:" || url.protocol === "blob:") return `${url.protocol}[omitted]`
    const path = url.pathname.split("/").map(segment => {
      if (/^\d{5,}$/.test(segment)) return ":id"
      if (/^[A-Za-z0-9_-]{20,}$/.test(segment) && /\d/.test(segment)) return ":id"
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id"
      return segment.length > 60 ? `${segment.slice(0, 20)}…` : segment
    }).join("/")
    return `${url.host}${path}`
  } catch {
    return "[invalid-url]"
  }
}

/** "张三" → "张*"; empty → "". Only used when a name must be shown at all. */
export function maskName(name: string | undefined | null): string {
  const trimmed = name?.trim()
  if (!trimmed) return ""
  return `${Array.from(trimmed)[0]}*`
}

export function redactText(input: unknown): string {
  let text = typeof input === "string" ? input : input instanceof Error ? input.message : String(input ?? "")
  for (const term of sensitiveTerms) if (text.includes(term)) text = text.split(term).join("[内容]")
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]")
    .replace(URL_IN_TEXT, match => sanitizeUrl(match))
    .replace(SECRET_PARAM, (_match, prefix: string, key: string) => `${prefix}${key}=[redacted]`)
    .replace(SECRET_ASSIGNMENT, (_match, prefix: string, key: string) => `${prefix}${key}=[redacted]`)
    .replace(FILE_NAME, match => `[文件]${match.slice(match.lastIndexOf("."))}`)
    .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, "[redacted]")
    .slice(0, MAX_TEXT)
}

export function sanitizeData(data: Record<string, unknown> | undefined): Record<string, DiagnosticValue> | undefined {
  if (!data) return undefined
  const result: Record<string, DiagnosticValue> = {}
  for (const [key, value] of Object.entries(data).slice(0, 40)) {
    if (SECRET_KEY_PATTERN.test(key)) continue
    if (value === undefined) continue
    if (value === null || typeof value === "boolean") result[key] = value
    else if (typeof value === "number") result[key] = Number.isFinite(value) ? value : null
    else if (Array.isArray(value)) result[key] = value.slice(0, 30).map(item => redactText(item).slice(0, 160))
    else if (/url$/i.test(key) && typeof value === "string") result[key] = sanitizeUrl(value)
    else result[key] = redactText(typeof value === "object" ? JSON.stringify(value) : value)
  }
  return result
}

export function buildEvent(
  level: DiagnosticLevel,
  category: DiagnosticCategory,
  scope: string,
  message: string,
  data?: Record<string, unknown>
): DiagnosticEvent {
  const clean = sanitizeData(data)
  return {
    at: new Date().toISOString(),
    level,
    category,
    scope: redactText(scope).slice(0, 60),
    message: redactText(message),
    ...(clean && Object.keys(clean).length ? { data: clean } : {})
  }
}

/** Re-validate events that arrive from another context (a content script or page). */
export function normalizeIncomingEvent(value: unknown): DiagnosticEvent | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const level = ["info", "warn", "error"].includes(String(raw.level)) ? raw.level as DiagnosticLevel : "info"
  const category = ["login", "draft", "upload", "error", "event", "log"].includes(String(raw.category))
    ? raw.category as DiagnosticCategory : "event"
  const data = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data as Record<string, unknown> : undefined
  return buildEvent(level, category, String(raw.scope ?? "page"), String(raw.message ?? ""), data)
}

// Writes are serialized inside one context (the background) so concurrent
// events never drop each other through read-modify-write races.
let writing: Promise<void> = Promise.resolve()

export function appendEvents(events: readonly DiagnosticEvent[]): Promise<void> {
  if (!events.length) return writing
  const next = writing.catch(() => undefined).then(async () => {
    const stored = (await chrome.storage.local.get(DIAGNOSTICS_KEY))[DIAGNOSTICS_KEY]
    const list = Array.isArray(stored) ? stored as DiagnosticEvent[] : []
    list.push(...events)
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: list.slice(-MAX_EVENTS) })
  })
  writing = next.catch(() => undefined)
  return next
}

/** Background-only writer. Never throws: diagnostics must not break publishing. */
export function recordDiagnostic(
  level: DiagnosticLevel,
  category: DiagnosticCategory,
  scope: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    return appendEvents([buildEvent(level, category, scope, message, data)]).catch(() => undefined)
  } catch {
    return Promise.resolve()
  }
}

export async function readEvents(): Promise<DiagnosticEvent[]> {
  const stored = (await chrome.storage.local.get(DIAGNOSTICS_KEY))[DIAGNOSTICS_KEY]
  return Array.isArray(stored) ? stored as DiagnosticEvent[] : []
}

export async function clearEvents(): Promise<void> {
  await writing.catch(() => undefined)
  await chrome.storage.local.remove([DIAGNOSTICS_KEY, SELF_CHECK_KEY, "wesight_diagnostic_logs_v1"])
}

export function errorData(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: redactText(error) }
  // Only the extension's own frames: file names and line numbers, no page code.
  const stack = (error.stack ?? "").split("\n").slice(1, 8)
    .map(line => line.trim().replace(/chrome-extension:\/\/[a-p]{32}\//g, ""))
    .filter(line => !/https?:\/\//.test(line))
  return { name: error.name, stack }
}

// ——— Platform self-check ———

export type ProbeMethod =
  | "open-tab"
  | "session-tab"
  | "api"
  | "homepage-html"
  | "login-redirect"
  | "shared-account"
  | "permission"
  | "none"

export const PROBE_METHOD_LABEL: Record<ProbeMethod, string> = {
  "open-tab": "已打开的平台页",
  "session-tab": "平台页会话",
  api: "接口",
  "homepage-html": "首页 HTML",
  "login-redirect": "跳登录页判断",
  "shared-account": "沿用同账号平台",
  permission: "未授权，未检测",
  none: "没有检测器"
}

export interface ProbeStep {
  url: string
  status: number
  finalUrl: string
  kind: "json" | "html" | "error"
  code?: string
  ms: number
}

export interface ProbeTrace {
  method: ProbeMethod
  source?: string
  steps: ProbeStep[]
  note?: string
}

export type SelfCheckResult = "logged_in" | "login_required" | "permission_missing" | "unknown"

export const SELF_CHECK_RESULT_LABEL: Record<SelfCheckResult, string> = {
  logged_in: "已登录",
  login_required: "未登录",
  permission_missing: "未授权",
  unknown: "无法确认"
}

export interface SelfCheckRow {
  platformId: string
  label: string
  result: SelfCheckResult
  method: ProbeMethod
  source?: string
  httpStatus: string
  finalUrl: string
  code: string
  nameRead: boolean
  maskedName: string
  note: string
  durationMs: number
}

export interface SelfCheckReport {
  at: string
  durationMs: number
  rows: SelfCheckRow[]
}

/** Short API result code from a probe body, e.g. `code=-101`, `err_no=0`. */
export function probeCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const root = body as Record<string, unknown>
  for (const key of ["code", "err_no", "errno", "error_code", "ret", "status", "success", "isLogin"]) {
    const value = root[key]
    if (["string", "number", "boolean"].includes(typeof value)) return `${key}=${String(value).slice(0, 20)}`
  }
  const data = root.data
  if (data && typeof data === "object" && "isLogin" in data) return `data.isLogin=${String((data as Record<string, unknown>).isLogin)}`
  return undefined
}

export function selfCheckRow(
  platformId: string,
  label: string,
  account: { state: string; name?: string },
  trace: ProbeTrace,
  durationMs: number
): SelfCheckRow {
  const steps = trace.steps
  const result = (["logged_in", "login_required", "permission_missing"].includes(account.state) ? account.state : "unknown") as SelfCheckResult
  return {
    platformId,
    label,
    result,
    method: trace.method,
    ...(trace.source ? { source: trace.source } : {}),
    httpStatus: steps.map(step => step.status || step.kind).join(" → "),
    finalUrl: steps.map(step => step.finalUrl).filter(Boolean).at(-1) ?? "",
    code: steps.map(step => step.code).filter(Boolean).join(" / "),
    nameRead: Boolean(account.name),
    maskedName: maskName(account.name),
    note: redactText(trace.note ?? "").slice(0, 160),
    durationMs
  }
}
