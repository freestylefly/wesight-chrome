import { visibleWaitBudget } from "~lib/x-page-wait"

const OCCUPIED = "X 编辑器已有未发布内容，请先保存或关闭当前内容，再重新同步"
const MARKER = "wesight_x_post_task"

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function composerDialog(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
    .find(dialog => dialog.querySelector('[data-testid="tweetTextarea_0"]')) ?? null
}

function attachedCount(dialog: HTMLElement): number {
  const attachments = dialog.querySelector('[data-testid="attachments"]')
  if (!attachments) return 0
  const previews = attachments.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="mediaPreview"]')
  return previews.length || attachments.querySelectorAll("img").length
}

function editorText(dialog: HTMLElement): string {
  const editor = dialog.querySelector<HTMLElement>('[data-testid="tweetTextarea_0"]')
  return (editor?.innerText ?? editor?.textContent ?? "").replace(/[\u200b\ufeff\s]/g, "")
}

/**
 * Hands images to X's own Post uploader, the same way a user picks files:
 * assign the dialog's native file input and dispatch change. X uploads the
 * files itself. Nothing is clicked and the post is never published.
 */
export async function attachXPostNativeImages(input: {
  taskId: string; files: File[]; requireEmptyText: boolean; onHidden?: () => void
}): Promise<{ draftUrl: string; uploading: boolean; reused: boolean }> {
  const url = new URL(location.href)
  if (url.origin !== "https://x.com" || url.pathname !== "/compose/post") throw new Error("请在 X Post 编辑页重新同步")
  if (url.searchParams.has(MARKER) && url.searchParams.get(MARKER) !== input.taskId) throw new Error(OCCUPIED)
  let dialog: HTMLElement | null = null
  const loading = visibleWaitBudget(20_000, input.onHidden)
  while (loading() && !(dialog = composerDialog())) await pause(100)
  if (!dialog) throw new Error("X Post 编辑窗口尚未加载，请等待页面加载后重试")
  const readyUrl = new URL("https://x.com/compose/post")
  readyUrl.searchParams.set(MARKER, input.taskId)
  // A retry on the same page keeps the images and any edits the user made in X.
  if (dialog.dataset.wesightXPostImages === input.taskId) return { draftUrl: readyUrl.href, uploading: false, reused: true }
  if (attachedCount(dialog) || (input.requireEmptyText && editorText(dialog))) throw new Error(OCCUPIED)
  const fileInput = dialog.querySelector<HTMLInputElement>('input[data-testid="fileInput"]')
    ?? dialog.querySelector<HTMLInputElement>('input[type="file"]')
  if (!fileInput) throw new Error("未找到 X Post 窗口的图片上传入口，请刷新 X 页面后重试")
  const transfer = new DataTransfer()
  for (const file of input.files) transfer.items.add(file)
  fileInput.files = transfer.files
  fileInput.dispatchEvent(new Event("change", { bubbles: true }))
  fileInput.dispatchEvent(new Event("input", { bubbles: true }))
  dialog.dataset.wesightXPostImages = input.taskId
  history.replaceState(history.state, "", readyUrl.href)

  const previewing = visibleWaitBudget(30_000, input.onHidden)
  while (previewing() && attachedCount(dialog) < input.files.length) {
    await pause(200)
    dialog = composerDialog() ?? dialog
  }
  if (attachedCount(dialog) < input.files.length) {
    delete dialog.dataset.wesightXPostImages
    throw new Error("X 没有接收全部图片，请检查 X 编辑窗口后重试")
  }
  // X enables Post only after its own media upload finishes.
  const uploading = visibleWaitBudget(60_000, input.onHidden)
  const posting = () => composerDialog()?.querySelector('[data-testid="tweetButton"]')
  while (uploading() && posting()?.getAttribute("aria-disabled") === "true") await pause(300)
  return { draftUrl: readyUrl.href, uploading: posting()?.getAttribute("aria-disabled") === "true", reused: false }
}
