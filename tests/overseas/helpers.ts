import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { vi } from "vitest"

import type { PublishTaskV1 } from "~types/protocol"

export class TestDataTransfer {
  files: File[] = []
  private data = new Map<string, string>()
  items = { add: (file: File) => { this.files.push(file) } }
  setData(type: string, value: string) { this.data.set(type, value) }
  getData(type: string) { return this.data.get(type) ?? "" }
}

export class TestClipboardEvent extends Event {
  clipboardData: TestDataTransfer | null
  constructor(type: string, init: EventInit & { clipboardData?: TestDataTransfer } = {}) {
    super(type, init)
    this.clipboardData = init.clipboardData ?? null
  }
}

export function stubBrowserApis(): void {
  vi.stubGlobal("DataTransfer", TestDataTransfer)
  vi.stubGlobal("ClipboardEvent", TestClipboardEvent)
}

export function loadFixture(name: string, path = "/"): void {
  document.documentElement.innerHTML = readFileSync(resolve(process.cwd(), "tests", "fixtures", "overseas", `${name}.html`), "utf8")
  history.replaceState({}, "", path)
}

export const DATA_URL = "data:image/png;base64,AQID"

export function overseasTask(input: {
  id: string
  title?: string
  body?: string
  tags?: string[]
  images?: number
  html?: string
  digest?: string
}): PublishTaskV1 {
  const count = input.images ?? 0
  const body = input.body ?? "First paragraph\n\nSecond paragraph"
  return {
    protocolVersion: 1,
    taskId: `${input.id}-task`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    source: { vaultPath: "post.md", contentHash: "a".repeat(64) },
    article: {
      title: input.title ?? "动态",
      digest: input.digest ?? "",
      markdown: body,
      html: input.html ?? `<p>${body.replace(/\n\n/g, "</p><p>")}</p>`,
      coverAssetId: count ? "asset-1" : null,
      tags: input.tags ?? []
    },
    assets: Array.from({ length: count }, (_, index) => ({
      id: `asset-${index + 1}`,
      fileName: `image-${index + 1}.png`,
      mimeType: "image/png",
      size: 3,
      sha256: String(index + 1).repeat(64).slice(0, 64)
    })),
    targets: [input.id as PublishTaskV1["targets"][number]],
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

/** Makes a jsdom file input accept assigned files and render previews into `previews`. */
export function wireFileInput(input: HTMLInputElement, previews: Element = input.parentElement!): File[][] {
  const batches: File[][] = []
  Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []) as File[]
    batches.push(files)
    for (const file of files) {
      const image = document.createElement("img")
      image.src = `https://cdn.example.test/${file.name}`
      previews.appendChild(image)
    }
  })
  return batches
}

/**
 * Emulates a framework editor: it takes pasted text/plain (replacing the
 * selection, here the whole editor) and pasted files.
 */
export function wireRichEditor(editor: HTMLElement, previews?: Element): File[] {
  const pastedFiles: File[] = []
  editor.addEventListener("paste", event => {
    const data = (event as TestClipboardEvent).clipboardData
    if (!data) return
    event.preventDefault()
    if (data.files.length) {
      for (const file of data.files) {
        pastedFiles.push(file)
        const image = document.createElement("img")
        image.src = `blob:https://example.test/${file.name}`
        ;(previews ?? editor.parentElement!).appendChild(image)
      }
      return
    }
    const target = event.target as HTMLElement
    target.textContent = data.getData("text/plain")
  })
  return pastedFiles
}

/** Spies on every button whose label is a publish action. */
export function publishSpy(labels = /^(?:post|publish|share|submit|next|save)$/i): ReturnType<typeof vi.fn> {
  const spy = vi.fn()
  document.addEventListener("click", event => {
    const target = (event.target as Element).closest("button, [role='button']")
    const label = target?.getAttribute("aria-label") ?? target?.textContent?.trim() ?? ""
    if (target && labels.test(label)) spy(label)
  }, true)
  return spy
}

export function fileNames(files: readonly File[] | undefined): string[] {
  return Array.from(files ?? []).map(file => file.name)
}
