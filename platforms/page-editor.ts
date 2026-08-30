import type { PlatformId } from "~types/protocol"

export interface PageEditorFillResult {
  editor: "ckeditor" | "ckeditor-frame" | "codemirror"
}

export type CsdnImageUploadResult =
  | { ok: true; url: string }
  | {
      ok: false
      message: string
      diagnostic: {
        rootType: string
        rootKeys: string[]
        firstType?: string
        firstKeys?: string[]
        dataType?: string
        dataKeys?: string[]
      }
    }

export async function fillPlatformEditorInPage(
  platformId: PlatformId,
  title: string,
  html: string,
  markdown: string
): Promise<PageEditorFillResult | null> {
  function fillTitle(selectors: string[]): void {
    for (const selector of selectors) {
      const control = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
      if (!control) continue
      const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
      if (setter) setter.call(control, title)
      else control.value = title
      control.dispatchEvent(new Event("input", { bubbles: true }))
      control.dispatchEvent(new Event("change", { bubbles: true }))
      control.dispatchEvent(new Event("blur", { bubbles: true }))
      return
    }
  }

  if (platformId === "csdn") {
    if (window === window.top) {
      fillTitle(["#txtTitle", "textarea[placeholder*='文章标题']", "input[placeholder*='文章标题']", "input.article-bar__title"])
    }
    type CkEditorInstance = {
      setData: (value: string, options?: { callback?: () => void }) => void
      fire?: (eventName: string) => void
      updateElement?: () => void
    }
    const pageWindow = window as typeof window & {
      CKEDITOR?: { instances?: Record<string, CkEditorInstance> }
    }
    const instance = Object.values(pageWindow.CKEDITOR?.instances ?? {})
      .find(candidate => typeof candidate?.setData === "function")
    if (instance) {
      await new Promise<void>((resolve, reject) => {
        let finished = false
        const finish = () => {
          if (finished) return
          finished = true
          window.clearTimeout(timeout)
          resolve()
        }
        const timeout = window.setTimeout(finish, 1_500)
        try {
          instance.setData(html, { callback: finish })
        } catch (error) {
          window.clearTimeout(timeout)
          reject(error)
        }
      })
      instance.fire?.("change")
      instance.updateElement?.()
      return { editor: "ckeditor" }
    }

    const currentBody = document.body
    if (currentBody?.matches(".cke_editable[contenteditable='true'], body[contenteditable='true'].htmledit_views")) {
      currentBody.focus()
      currentBody.innerHTML = html
      currentBody.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
      currentBody.dispatchEvent(new Event("change", { bubbles: true }))
      currentBody.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }))
      currentBody.dispatchEvent(new Event("blur", { bubbles: true }))
      return { editor: "ckeditor-frame" }
    }

    const frames = document.querySelectorAll<HTMLIFrameElement>("iframe.cke_wysiwyg_frame, iframe[class*='wysiwyg']")
    for (const frame of frames) {
      const body = frame.contentDocument?.body
      if (!body) continue
      body.innerHTML = html
      body.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
      body.dispatchEvent(new Event("change", { bubbles: true }))
      body.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }))
      return { editor: "ckeditor-frame" }
    }
    if (!frames.length) return null

    const requestId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const frameWindows = new Set(Array.from(frames, frame => frame.contentWindow).filter(Boolean))
    const bridged = await new Promise<boolean>(resolve => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        window.removeEventListener("message", onMessage)
        resolve(value)
      }
      const onMessage = (event: MessageEvent) => {
        if (!frameWindows.has(event.source as Window)) return
        const data = event.data as { source?: string; type?: string; requestId?: string } | null
        if (data?.source !== "wesight-csdn-editor-frame" || data.type !== "FILLED" || data.requestId !== requestId) return
        finish(true)
      }
      window.addEventListener("message", onMessage)
      const timeout = window.setTimeout(() => finish(false), 2_000)
      for (const frame of frames) {
        frame.contentWindow?.postMessage({
          source: "wesight-csdn-editor-parent",
          type: "FILL",
          requestId,
          html
        }, "*")
      }
    })
    return bridged ? { editor: "ckeditor-frame" } : null
  }

  if (platformId === "juejin") {
    fillTitle(["input.title-input", "input[placeholder='输入文章标题...']", "textarea.title-input"])
    type CodeMirrorEditor = {
      focus: () => void
      setValue: (value: string) => void
    }
    const wrapper = document.querySelector<HTMLElement>(".CodeMirror") as (HTMLElement & { CodeMirror?: CodeMirrorEditor }) | null
    if (!wrapper?.CodeMirror || typeof wrapper.CodeMirror.setValue !== "function") {
      throw new Error("掘金页面结构可能已更新，无法连接 CodeMirror 正文编辑器")
    }
    wrapper.CodeMirror.setValue(markdown)
    wrapper.CodeMirror.focus()
    return { editor: "codemirror" }
  }

  throw new Error(`平台 ${platformId} 不支持页面编辑桥`)
}

export async function uploadJuejinImageInPage(
  dataUrl: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  type CodeMirrorEditor = {
    focus: () => void
    getValue: () => string
    lineCount?: () => number
    setCursor?: (line: number, column?: number) => void
  }
  const wrapper = document.querySelector<HTMLElement>(".CodeMirror") as (HTMLElement & { CodeMirror?: CodeMirrorEditor }) | null
  const editor = wrapper?.CodeMirror
  const input = wrapper?.querySelector<HTMLTextAreaElement>("textarea")
  if (!editor || typeof editor.getValue !== "function" || !input) {
    throw new Error("掘金页面结构可能已更新，无法连接图片上传控件")
  }

  const urls = (value: string): string[] => value.match(/https?:\/\/[^\s)>"']+/g) ?? []
  const beforeCounts = new Map<string, number>()
  for (const url of urls(editor.getValue())) beforeCounts.set(url, (beforeCounts.get(url) ?? 0) + 1)

  const [header, payload = ""] = dataUrl.split(",", 2)
  const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const transfer = new DataTransfer()
  transfer.items.add(new File([bytes], fileName, { type: mimeType }))

  editor.focus()
  const lineCount = editor.lineCount?.()
  if (lineCount !== undefined) editor.setCursor?.(lineCount, 0)
  input.dispatchEvent(new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: transfer
  }))

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const currentCounts = new Map<string, number>()
    for (const url of urls(editor.getValue())) {
      const count = (currentCounts.get(url) ?? 0) + 1
      currentCounts.set(url, count)
      if (count > (beforeCounts.get(url) ?? 0)) return url
    }
    await new Promise(resolve => window.setTimeout(resolve, 250))
  }
  throw new Error(`掘金图片“${fileName}”上传超时，请确认登录状态后重试`)
}

export async function uploadCsdnImageInPage(
  dataUrl: string,
  fileName: string,
  mimeType: string
): Promise<CsdnImageUploadResult> {
  type CsdnPageWindow = typeof window & {
    csdn?: {
      upload?: {
        uploadImg?: (input: {
          appName: string
          type: string
          imageTemplate: string
          file: File
        }) => Promise<unknown>
      }
    }
  }

  function valueType(value: unknown): string {
    if (value === null) return "null"
    if (Array.isArray(value)) return "array"
    return typeof value
  }

  function safeKeys(value: unknown): string[] {
    if (!value || typeof value !== "object") return []
    return Object.keys(value).slice(0, 20)
  }

  function toHttpUrl(value: unknown): string | null {
    if (typeof value !== "string") return null
    if (/^https?:\/\//i.test(value)) return value
    if (/^\/\/[^/]/.test(value)) return `https:${value}`
    return null
  }

  function findImageUrl(value: unknown, depth = 0): string | null {
    if (depth > 5) return null
    const direct = toHttpUrl(value)
    if (direct) return direct
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = findImageUrl(item, depth + 1)
        if (nested) return nested
      }
      return null
    }
    if (!value || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    for (const key of ["imageUrl", "imageURL", "image_url", "fileUrl", "file_url", "url", "src", "location"] as const) {
      const candidate = toHttpUrl(record[key])
      if (candidate) return candidate
    }
    for (const key of ["data", "result", "response", "body"] as const) {
      if (!(key in record)) continue
      const nested = findImageUrl(record[key], depth + 1)
      if (nested) return nested
    }
    return null
  }

  function responseMessage(value: unknown): string | null {
    const queue: unknown[] = [value]
    for (let depth = 0; depth < 4 && queue.length; depth += 1) {
      const current = queue.shift()
      if (Array.isArray(current)) {
        queue.push(...current.slice(0, 3))
        continue
      }
      if (!current || typeof current !== "object") continue
      const record = current as Record<string, unknown>
      for (const key of ["msg", "message", "errorMessage", "error"] as const) {
        const candidate = record[key]
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim().replace(/https?:\/\/\S+/gi, "[URL]").slice(0, 160)
        }
      }
      for (const key of ["data", "result", "response", "body"] as const) {
        if (record[key] !== undefined) queue.push(record[key])
      }
    }
    return null
  }

  const pageWindow = window as CsdnPageWindow
  const deadline = Date.now() + 10_000
  while (typeof pageWindow.csdn?.upload?.uploadImg !== "function" && Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 200))
  }
  const uploader = pageWindow.csdn?.upload
  if (typeof uploader?.uploadImg !== "function") {
    throw new Error(`CSDN 图片“${fileName}”上传失败：页面原生上传器未加载`)
  }

  const [header, payload = ""] = dataUrl.split(",", 2)
  const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const file = new File([bytes], fileName, { type: mimeType })
  let response: unknown
  try {
    response = await uploader.uploadImg.call(uploader, {
      appName: "direct_blog",
      type: "blog",
      imageTemplate: "",
      file
    })
  } catch (error) {
    const detail = error && typeof error === "object"
      ? String((error as { msg?: unknown; message?: unknown }).msg ?? (error as { message?: unknown }).message ?? "平台上传请求失败")
      : String(error)
    throw new Error(`CSDN 图片“${fileName}”上传失败：${detail}`)
  }

  const url = findImageUrl(response)
  if (url) return { ok: true, url }

  const rootRecord = response && typeof response === "object"
    ? response as Record<string, unknown>
    : null
  const first = Array.isArray(response) ? response[0] : undefined
  const data = rootRecord?.data ?? (
    first && typeof first === "object"
      ? (first as Record<string, unknown>).data
      : undefined
  )
  return {
    ok: false,
    message: responseMessage(response) ?? "平台未返回图片地址",
    diagnostic: {
      rootType: valueType(response),
      rootKeys: safeKeys(response),
      firstType: Array.isArray(response) ? valueType(first) : undefined,
      firstKeys: Array.isArray(response) ? safeKeys(first) : undefined,
      dataType: data === undefined ? undefined : valueType(data),
      dataKeys: data === undefined ? undefined : safeKeys(data)
    }
  }
}

export async function uploadZhihuImageInPage(
  dataUrl: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const [header, payload = ""] = dataUrl.split(",", 2)
  const binary = (header ?? "").includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const body = new FormData()
  body.append("picture", new File([bytes], fileName, { type: mimeType }))

  const xsrfMatch = /(?:^|;\s*)_xsrf=([^;]+)/.exec(document.cookie)
  const xsrfToken = xsrfMatch?.[1] ? decodeURIComponent(xsrfMatch[1]) : ""
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-requested-with": "fetch"
  }
  if (xsrfToken) headers["x-xsrftoken"] = xsrfToken
  const response = await fetch("https://zhuanlan.zhihu.com/api/uploaded_images", {
    method: "POST",
    body,
    credentials: "include",
    headers
  })
  if (!response.ok) {
    throw new Error(`知乎图片“${fileName}”上传失败（HTTP ${response.status}），请重新登录后重试`)
  }
  const result = await response.json() as Record<string, unknown>
  for (const field of ["src", "original_src", "url"] as const) {
    const candidate = result[field]
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate
  }
  throw new Error(`知乎图片“${fileName}”上传失败，平台未返回图片地址`)
}
