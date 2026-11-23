import { Download, LoaderCircle, ShieldCheck, Stethoscope, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import "./diagnostics.css"

import {
  PROBE_METHOD_LABEL,
  SELF_CHECK_RESULT_LABEL,
  type DiagnosticEvent,
  type SelfCheckReport
} from "~lib/diagnostics"
import type { DiagnosticEnvironment } from "~lib/diagnostics-env"
import { installErrorCapture } from "~lib/page-trace"
import type { ExtensionRequest, ExtensionResponse } from "~types/messages"

interface DiagnosticsState {
  environment: DiagnosticEnvironment
  selfCheck: SelfCheckReport | null
  events: DiagnosticEvent[]
}

installErrorCapture("diagnostics-page")

async function request<T>(message: ExtensionRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse<T>>(message)
  if (!response?.ok) throw new Error(response?.error ?? "扩展后台响应失败")
  return response.value as T
}

function stamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

function time(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}

const ENV_ROWS: [keyof DiagnosticEnvironment, string][] = [
  ["extensionVersion", "插件版本"],
  ["buildCommit", "构建号"],
  ["buildTime", "构建时间"],
  ["installType", "安装方式"],
  ["browser", "浏览器"],
  ["os", "操作系统"],
  ["obsidianPaired", "已和 Obsidian 配对"],
  ["obsidianConnected", "Obsidian 当前在线"],
  ["wesightSignedIn", "WeSight 已登录"],
  ["wesightAccountSource", "WeSight 登录来源"],
  ["membership", "发布权限"]
]

function envValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否"
  if (Array.isArray(value)) return value.length ? value.join("、") : "无"
  if (value === "development") return "开发版（未打包加载）"
  if (value === "normal") return "商店版"
  return String(value ?? "")
}

function App() {
  const [state, setState] = useState<DiagnosticsState | null>(null)
  const [busy, setBusy] = useState<"" | "check" | "export" | "clear">("")
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "problems">("problems")

  const load = useCallback(async () => {
    try {
      setState(await request<DiagnosticsState>({ type: "GET_DIAGNOSTICS" }))
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const runCheck = async () => {
    setBusy("check")
    try {
      await request<SelfCheckReport>({ type: "RUN_SELF_CHECK" })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy("")
    }
  }

  const exportBundle = async () => {
    setBusy("export")
    try {
      const fresh = await request<DiagnosticsState>({ type: "GET_DIAGNOSTICS" })
      setState(fresh)
      const bundle = {
        format: "wesight-diagnostics",
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        privacy: "不含文章正文、标题、图片、Cookie、token 和网址参数；账号昵称只记是否读到。",
        environment: fresh.environment,
        selfCheck: fresh.selfCheck,
        events: fresh.events
      }
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `wesight-diagnostics-${fresh.environment.extensionVersion}-${stamp()}.json`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 5_000)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy("")
    }
  }

  const clear = async () => {
    if (!window.confirm("清空本机保存的全部诊断记录和自检结果？")) return
    setBusy("clear")
    try {
      await request({ type: "CLEAR_DIAGNOSTICS" })
      await load()
    } finally {
      setBusy("")
    }
  }

  const events = useMemo(() => {
    const list = [...(state?.events ?? [])].reverse()
    return filter === "all" ? list : list.filter(event => event.level !== "info")
  }, [state, filter])

  const summary = useMemo(() => {
    const rows = state?.selfCheck?.rows ?? []
    const count = (result: string) => rows.filter(row => row.result === result).length
    return { total: rows.length, ok: count("logged_in"), out: count("login_required"), perm: count("permission_missing"), unknown: count("unknown") }
  }, [state])

  return <main className="diag-shell">
    <header className="diag-header">
      <div>
        <h1><Stethoscope />诊断</h1>
        <p>先点“平台自检”并截图，再点“导出诊断包”，把截图和文件一起发给开发者。</p>
      </div>
      <div className="diag-actions">
        <button className="primary" disabled={Boolean(busy)} onClick={() => void runCheck()}>
          {busy === "check" ? <LoaderCircle className="spin" /> : <ShieldCheck />}{busy === "check" ? "检测中…" : "平台自检"}
        </button>
        <button disabled={Boolean(busy) || !state} onClick={() => void exportBundle()}><Download />导出诊断包</button>
        <button className="ghost" disabled={Boolean(busy)} onClick={() => void clear()}><Trash2 />清空记录</button>
      </div>
    </header>

    {error && <div className="diag-error">{error}</div>}

    <section className="diag-card privacy">
      <strong>隐私说明</strong>
      诊断记录只保存在这台电脑上，由你决定是否发出。不记录文章正文、标题、标签、图片和文件名，不记录 Cookie、token 和网址参数（网址只保留域名和路径），平台账号昵称只记“是否读到”。
    </section>

    {state && <section className="diag-card">
      <h2>环境信息</h2>
      <dl className="env-grid">
        {ENV_ROWS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{envValue(state.environment[key])}</dd></div>)}
        <div className="wide"><dt>已授权的可选平台</dt><dd>{envValue(state.environment.grantedOptionalPlatforms)}</dd></div>
      </dl>
    </section>}

    <section className="diag-card">
      <div className="card-title">
        <h2>平台自检</h2>
        {state?.selfCheck && <span className="muted">
          {time(state.selfCheck.at)} · 共 {summary.total} 个 · 已登录 {summary.ok} · 未登录 {summary.out} · 未授权 {summary.perm} · 无法确认 {summary.unknown} · 用时 {(state.selfCheck.durationMs / 1000).toFixed(1)} 秒
        </span>}
      </div>
      {!state?.selfCheck ? <p className="muted">还没有自检结果。请先在浏览器里登录要测试的平台，再点右上角“平台自检”。小红书、即刻和 X 会在后台临时打开一个页面来读取登录状态，读完自动关闭。</p>
        : <div className="table-wrap"><table className="check-table">
          <thead><tr><th>平台</th><th>结果</th><th>检测方式</th><th>HTTP</th><th>最终网址</th><th>接口 code</th><th>昵称</th><th>说明</th><th>耗时</th></tr></thead>
          <tbody>{state.selfCheck.rows.map(row => <tr key={row.platformId} className={row.result}>
            <td><strong>{row.label}</strong><small>{row.platformId}</small></td>
            <td><span className={`pill ${row.result}`}>{SELF_CHECK_RESULT_LABEL[row.result]}</span></td>
            <td>{PROBE_METHOD_LABEL[row.method]}{row.source ? <small>→ {row.source}</small> : null}</td>
            <td className="mono">{row.httpStatus || "—"}</td>
            <td className="mono url">{row.finalUrl || "—"}</td>
            <td className="mono">{row.code || "—"}</td>
            <td>{row.result === "logged_in" ? row.nameRead ? `已读到（${row.maskedName}）` : "未读到" : "—"}</td>
            <td className="note">{row.note || ""}</td>
            <td className="mono">{row.durationMs}ms</td>
          </tr>)}</tbody>
        </table></div>}
    </section>

    <section className="diag-card">
      <div className="card-title">
        <h2>最近记录</h2>
        <div className="seg">
          <button className={filter === "problems" ? "on" : ""} onClick={() => setFilter("problems")}>只看问题</button>
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>全部（{state?.events.length ?? 0}）</button>
        </div>
      </div>
      {!events.length ? <p className="muted">暂无记录。</p> : <ol className="event-list">
        {events.slice(0, 200).map((event, index) => <li key={`${event.at}-${index}`} className={event.level}>
          <div className="event-head">
            <span className={`dot ${event.level}`} />
            <time>{time(event.at)}</time>
            <span className="tag">{event.category}</span>
            <span className="tag">{event.scope}</span>
            <span className="event-message">{event.message}</span>
          </div>
          {event.data && <details><summary>详情</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details>}
        </li>)}
      </ol>}
    </section>
  </main>
}

export default App
