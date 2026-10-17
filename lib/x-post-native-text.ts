import { visibleWaitBudget } from "~lib/x-page-wait"
import type { PrepareDraftResult } from "~platforms/types"

export function xPostNativeTextUrl(text: string, taskId: string): string {
  const url = new URL("https://x.com/compose/post")
  url.searchParams.set("text", text)
  url.searchParams.set("wesight_x_post_task", taskId)
  return url.href
}

/** X consumes the text query itself. This function only reads the editor. */
export async function prepareXPostNativeText(input: {
  taskId: string; account: string; text: string; requested: boolean; onHidden?: () => void
}): Promise<PrepareDraftResult> {
  const url = new URL(location.href)
  const occupied = "X 编辑器已有未发布内容，请先保存或关闭当前内容，再重新同步"
  const marker = "wesight_x_post_task"
  if (url.origin !== "https://x.com" || url.pathname !== "/compose/post") throw new Error("请在 X Post 编辑页重新同步")
  if (["in_reply_to", "in_reply_to_status_id", "quoted_status_id", "quote_tweet_id", "scheduled_tweet_id", "draft_tweet_id"].some(key => url.searchParams.has(key))
    || (url.searchParams.has(marker) && url.searchParams.get(marker) !== input.taskId)) throw new Error(occupied)
  const normalize = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[\u200b\ufeff]/g, "").replace(/\n+/g, "\n").trim()
  const waiting = visibleWaitBudget(20_000, input.onHidden)
  let emptyEditor = false
  while (waiting()) {
    const account = Array.from(document.querySelectorAll('[data-testid="SideNav_AccountSwitcher_Button"] span'))
      .map(node => node.textContent?.trim()).find(value => /^@[\w]+$/.test(value ?? ""))?.slice(1).toLowerCase()
    if (account !== input.account.toLowerCase()) throw new Error("X 当前账号已改变，请切回原账号后重试")
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const editor = dialog?.querySelector<HTMLElement>('[data-testid="tweetTextarea_0"] [contenteditable="true"], [data-testid="tweetTextarea_0"][contenteditable="true"], [data-testid="tweetTextarea_0"] textarea')
    if (dialog && editor) {
      const current = editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText ?? editor.textContent ?? ""
      if (input.requested && editor.dataset.wesightXPostTask === input.taskId) {
        return { draftUrl: url.href, warnings: ["已保留你在 X 编辑器中的内容，请手动确认发布"] }
      }
      if (dialog.querySelector('[data-testid="attachments"] img, [data-testid="tweetPhoto"], [data-testid="pollOption_0"]')) throw new Error(occupied)
      if (input.requested && normalize(current) === normalize(input.text)) {
        editor.dataset.wesightXPostTask = input.taskId
        const readyUrl = new URL("https://x.com/compose/post")
        readyUrl.searchParams.set(marker, input.taskId)
        history.replaceState(history.state, "", readyUrl.href)
        return { draftUrl: readyUrl.href, warnings: ["文案已载入 X Post 编辑窗口，请确认后手动发布"] }
      }
      if (normalize(current)) throw new Error(occupied)
      emptyEditor = true
      // First handoff and a refresh of our marked Post use the native URL.
      if (!input.requested || url.searchParams.get(marker) === input.taskId && !url.searchParams.has("text")) break
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!emptyEditor) throw new Error("X Post 编辑窗口尚未加载，请等待页面加载后重试")
  if (input.requested && url.searchParams.get(marker) !== input.taskId) throw new Error("X 尚未载入预填文案，请刷新 X 页面后重试")
  return { draftUrl: xPostNativeTextUrl(input.text, input.taskId), editorPending: true, warnings: [] }
}
