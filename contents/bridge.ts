import type { PlasmoCSConfig } from "plasmo"

import type { ExtensionRequest, ExtensionResponse } from "~types/messages"
import type { BridgeHandoff } from "~types/protocol"

export const config: PlasmoCSConfig = {
  matches: ["http://127.0.0.1/*"],
  run_at: "document_idle"
}

function render(message: string, error = false): void {
  const root = document.querySelector<HTMLElement>("#wesight-bridge-status") ?? document.body
  root.textContent = message
  root.style.color = error ? "#b42318" : "#475467"
}

async function handoff(): Promise<void> {
  if (location.pathname !== "/wesight-bridge") return
  const query = new URLSearchParams(location.search)
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""))
  const taskId = query.get("taskId") ?? ""
  const taskToken = fragment.get("taskToken") ?? ""
  if (!taskId || !taskToken) {
    render("任务链接不完整，请返回 Obsidian 重试。", true)
    return
  }
  const payload: BridgeHandoff = {
    baseUrl: location.origin,
    taskId,
    taskToken,
    pairToken: fragment.get("pairToken") ?? undefined,
    retryPlatform: query.get("retryPlatform") as BridgeHandoff["retryPlatform"] ?? undefined,
    openPlatform: query.get("openPlatform") as BridgeHandoff["openPlatform"] ?? undefined,
    openTask: query.get("openTask") === "1"
  }
  render(payload.openTask
    ? "正在打开本次任务的平台标签组…"
    : payload.openPlatform ? "正在打开已准备的平台草稿…" : "正在连接 WeSight 并打开平台编辑页…")
  const request: ExtensionRequest = { type: "BRIDGE_HANDOFF", handoff: payload }
  const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse>(request)
  if (!response?.ok) {
    render(response?.error ?? "扩展连接失败，请确认已安装并启用 WeSight 发布助手。", true)
    return
  }
  history.replaceState(null, "", `${location.pathname}${location.search}`)
  render(payload.openTask
    ? "已切换到本次任务的平台标签组。可以关闭此页面。"
    : payload.openPlatform
      ? "已切换到对应平台草稿。可以关闭此页面。"
      : "平台编辑页已打开。可以关闭此页面，并回到 Obsidian 查看进度。")
}

void handoff().catch(error => render(error instanceof Error ? error.message : String(error), true))
