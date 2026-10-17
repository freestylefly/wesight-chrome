import { attachXPostNativeImages } from "~lib/x-post-native-media"

class FakeDataTransfer {
  readonly list: File[] = []
  readonly items = { add: (file: File) => { this.list.push(file) } }
  get files() { return this.list as unknown as FileList }
}
const png = (name: string) => new File([new Uint8Array([1])], name, { type: "image/png" })

function setup(options: { text?: string; attached?: number; uploadDelay?: number } = {}) {
  document.body.innerHTML = `
    <div data-testid="primaryColumn"><input type="file" data-testid="fileInput" class="background"></div>
    <div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true">${options.text ?? ""}</div>
      <div data-testid="attachments">${'<div data-testid="tweetPhoto"></div>'.repeat(options.attached ?? 0)}</div>
      <input type="file" data-testid="fileInput" class="dialog"><button data-testid="tweetButton" aria-disabled="true">Post</button></div>`
  const dialogInput = document.querySelector<HTMLInputElement>("input.dialog")!
  const backgroundInput = document.querySelector<HTMLInputElement>("input.background")!
  const received: File[][] = []
  for (const element of [dialogInput, backgroundInput]) {
    let files: FileList | null = null
    Object.defineProperty(element, "files", { get: () => files, set: value => { files = value } })
  }
  // Mimics X: previews appear on change and Post enables when upload ends.
  dialogInput.addEventListener("change", () => {
    const files = Array.from(dialogInput.files ?? [])
    received.push(files)
    const attachments = document.querySelector('[data-testid="attachments"]')!
    for (const _ of files) attachments.insertAdjacentHTML("beforeend", '<div data-testid="tweetPhoto"></div>')
    setTimeout(() => document.querySelector('[data-testid="tweetButton"]')!.setAttribute("aria-disabled", "false"), options.uploadDelay ?? 0)
  })
  return { dialogInput, backgroundInput, received }
}

beforeEach(() => {
  vi.stubGlobal("DataTransfer", FakeDataTransfer)
  vi.stubGlobal("location", new URL("https://x.com/compose/post?wesight_x_post_task=task-1"))
  vi.spyOn(history, "replaceState").mockImplementation((_state, _unused, url) => {
    if (url) vi.stubGlobal("location", new URL(String(url), "https://x.com"))
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

test("assigns files to the Post dialog's own uploader and waits for X to finish", async () => {
  const { received, backgroundInput } = setup({ text: "已预填" })
  const click = vi.spyOn(HTMLElement.prototype, "click")
  const result = await attachXPostNativeImages({ taskId: "task-1", files: [png("1.png"), png("2.png")], requireEmptyText: false })
  expect(received).toHaveLength(1)
  expect(received[0]!.map(file => file.name)).toEqual(["1.png", "2.png"])
  expect(backgroundInput.files).toBeNull()
  expect(result).toEqual({ draftUrl: "https://x.com/compose/post?wesight_x_post_task=task-1", uploading: false, reused: false })
  expect(click).not.toHaveBeenCalled()
  expect(document.querySelector('[data-testid="tweetButton"]')!.getAttribute("aria-disabled")).toBe("false")
})

test("a retry on the same page keeps the existing images and user edits", async () => {
  const { received } = setup()
  await attachXPostNativeImages({ taskId: "task-1", files: [png("1.png")], requireEmptyText: true })
  document.querySelector('[data-testid="tweetTextarea_0"]')!.textContent = "用户补充"
  const again = await attachXPostNativeImages({ taskId: "task-1", files: [png("1.png")], requireEmptyText: true })
  expect(again.reused).toBe(true)
  expect(received).toHaveLength(1)
})

test("refuses to overwrite someone else's composition", async () => {
  setup({ attached: 1 })
  await expect(attachXPostNativeImages({ taskId: "task-1", files: [png("1.png")], requireEmptyText: false })).rejects.toThrow("未发布内容")
  setup({ text: "别的内容" })
  await expect(attachXPostNativeImages({ taskId: "task-1", files: [png("1.png")], requireEmptyText: true })).rejects.toThrow("未发布内容")
  vi.stubGlobal("location", new URL("https://x.com/compose/post?wesight_x_post_task=other"))
  setup()
  await expect(attachXPostNativeImages({ taskId: "task-1", files: [png("1.png")], requireEmptyText: true })).rejects.toThrow("未发布内容")
})

test("reports a slow X upload instead of failing", async () => {
  vi.useFakeTimers()
  setup({ uploadDelay: 120_000 })
  const pending = attachXPostNativeImages({ taskId: "task-1", files: [png("1.png")], requireEmptyText: true })
  await vi.advanceTimersByTimeAsync(61_000)
  expect((await pending).uploading).toBe(true)
  vi.useRealTimers()
})
