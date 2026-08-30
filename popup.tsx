import { AlertCircle, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, Unplug } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import logo from "data-base64:~assets/icon.png"

import "./popup.css"

import type { ExtensionRequest, ExtensionResponse, PopupState } from "~types/messages"
import { PLATFORM_CONFIG } from "~platforms/config"
import { PLATFORM_IDS, type PlatformId, type PlatformTaskState } from "~types/protocol"

const STATUS_LABEL: Record<PlatformTaskState["status"], string> = {
  queued: "等待中",
  opening: "打开中",
  login_required: "需要登录",
  filling: "填充中",
  ready: "等待发布",
  failed: "失败",
  cancelled: "已取消"
}

async function request<T>(message: ExtensionRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse<T>>(message)
  if (!response?.ok) throw new Error(response?.error ?? "扩展后台响应失败")
  return response.value as T
}

function StatusIcon({ status }: { status: PlatformTaskState["status"] }) {
  if (status === "ready") return <CheckCircle2 className="status-icon ready" />
  if (status === "failed" || status === "login_required") return <AlertCircle className="status-icon warning" />
  return <LoaderCircle className={`status-icon ${["opening", "filling"].includes(status) ? "spinning" : ""}`} />
}

function App() {
  const [state, setState] = useState<PopupState | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")

  const refresh = useCallback(async () => {
    try {
      setState(await request<PopupState>({ type: "GET_POPUP_STATE" }))
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const progress = useMemo(() => {
    const task = state?.currentTask
    if (!task) return null
    const selected = Object.values(task.platforms).filter(item => item.status !== "cancelled")
    return { ready: selected.filter(item => item.status === "ready").length, total: selected.length }
  }, [state])

  const retry = async (platformId: PlatformId) => {
    const task = state?.currentTask
    if (!task) return
    setBusy(platformId)
    try {
      await request({ type: "RETRY_PLATFORM", taskId: task.taskId, platformId })
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy("")
    }
  }

  const openTabs = async () => {
    const task = state?.currentTask
    if (!task) return
    try {
      await request({ type: "OPEN_TASK_TABS", taskId: task.taskId })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return <main className="popup-shell">
    <header className="brand-row">
      <img src={logo} alt="" />
      <div><h1>WeSight 发布助手</h1><p>多平台草稿准备</p></div>
      <span className={`connection ${state?.connected ? "online" : ""}`}>
        {state?.connected ? "已连接" : "未连接"}
      </span>
    </header>

    {!state?.pairing ? <section className="empty-state">
      <Unplug />
      <h2>等待与 Obsidian 配对</h2>
      <p>在 WeSight 的「多平台」页签选择平台并启动任务，浏览器会完成一次配对。</p>
    </section> : <>
      <section className="account-card">
        <div className="section-title"><h2>平台登录状态</h2><button onClick={() => void refresh()} aria-label="刷新"><RefreshCw /></button></div>
        <div className="account-grid">
          {PLATFORM_IDS.map(id => <div className="account-item" key={id}>
            <span>{PLATFORM_CONFIG[id].shortLabel}</span>
            <small className={state.accounts[id].state}>{state.accounts[id].state === "logged_in" ? "已登录" : state.accounts[id].state === "login_required" ? "需登录" : "未检测"}</small>
          </div>)}
        </div>
      </section>

      {state.currentTask ? <section className="task-card">
        <div className="task-heading"><div><small>当前任务</small><h2>{state.currentTask.title}</h2></div><strong>{progress?.ready ?? 0}/{progress?.total ?? 0}</strong></div>
        <div className="progress-track"><span style={{ width: `${progress?.total ? (progress.ready / progress.total) * 100 : 0}%` }} /></div>
        <div className="platform-list">
          {PLATFORM_IDS.filter(id => state.currentTask!.platforms[id].status !== "cancelled").map(id => {
            const item = state.currentTask!.platforms[id]
            const retryable = item.status === "failed" || item.status === "login_required"
            return <div className="platform-row" key={id}>
              <StatusIcon status={item.status} />
              <div><strong>{PLATFORM_CONFIG[id].label}</strong><span>{item.message || STATUS_LABEL[item.status]}</span></div>
              {retryable && <button disabled={busy === id} onClick={() => void retry(id)}>{busy === id ? "重试中" : "重试"}</button>}
            </div>
          })}
        </div>
        <button className="primary-action" onClick={() => void openTabs()}><ExternalLink />打开标签组</button>
      </section> : <section className="empty-state compact"><h2>已完成配对</h2><p>从 Obsidian 发起任务后，进度会显示在这里。</p></section>}
    </>}
    {error && <div className="error-note">{error}</div>}
    <footer>正文与图片仅通过本机临时通道传输</footer>
  </main>
}

export default App
