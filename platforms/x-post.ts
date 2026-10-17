import { sha256 } from "~lib/crypto"
import { getLocal, setLocal } from "~lib/storage"
import { buildXPostText, supportedXPostImages, X_POST_IMAGE_BYTES, X_POST_IMAGE_LIMIT, xPostTextError } from "~lib/x-post-content"
import { attachXPostNativeImages } from "~lib/x-post-native-media"
import { prepareXPostNativeText } from "~lib/x-post-native-text"
import { PLATFORM_CONFIG } from "~platforms/config"
import { loginPageDetected } from "~platforms/dom"
import type { PlatformAdapter, PrepareDraftContext, PrepareDraftResult } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

const config = PLATFORM_CONFIG["x-post"]
const CHECKPOINT_KEY = "wesight_x_post_checkpoints_v1"
// Older checkpoints may also carry fields from the retired upload/draft flow; they are ignored.
interface Checkpoint {
  account: string
  contentKey: string
  updatedAt: number
  nativeUrlRequested?: boolean
}
const runs = new Map<string, Promise<PrepareDraftResult>>()

function accountName(): string | undefined {
  const account = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')
  return Array.from(account?.querySelectorAll("span") ?? [])
    .map(span => span.textContent?.trim()).find(text => /^@[\w]+$/.test(text ?? ""))?.slice(1)
}

async function detectAccount() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (loginPageDetected() || document.querySelector('[data-testid="loginButton"]')) return { loggedIn: false, message: "请先登录 X" }
    const name = accountName()
    if (name) return { loggedIn: true, name }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return { loggedIn: false, message: "未能确认 X 当前账号，请登录并刷新 X 后重试" }
}

async function imageFile(context: PrepareDraftContext, asset: PublishAssetV1): Promise<File> {
  if (context.getAssetBlob) return new File([await context.getAssetBlob(asset)], asset.fileName, { type: asset.mimeType })
  const dataUrl = await context.getAssetData(asset)
  if (!/^data:image\/[\w.+-]+;base64,/i.test(dataUrl)) throw new Error(`图片“${asset.fileName}”数据无效`)
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1))
  return new File([Uint8Array.from(binary, character => character.charCodeAt(0))], asset.fileName, { type: asset.mimeType })
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  if (context.task.media || context.task.assets.some(asset => asset.mimeType.startsWith("video/"))) {
    throw new Error("X 动态暂不支持同步视频，请取消选择 X 或改用图片")
  }
  const text = buildXPostText({ title: context.task.targetOptions?.xPost?.includeTitle ? context.task.article.title : "", body: context.task.article.markdown })
  const textError = xPostTextError(text)
  if (textError) throw new Error(textError)
  const plan = supportedXPostImages(context.task.assets)
  if (plan.images.length > X_POST_IMAGE_LIMIT) throw new Error(`X 动态最多上传 ${X_POST_IMAGE_LIMIT} 张图片，当前 ${plan.images.length} 张；请单独调整 X 的图片`)
  if (plan.images.some(asset => asset.size > X_POST_IMAGE_BYTES)) throw new Error("X 动态单张图片不能超过 5 MB，请压缩图片后重试")
  if (!text && !plan.images.length) throw new Error("X 动态内容为空，请填写文案或添加支持的图片")
  const account = await detectAccount()
  if (!account.loggedIn || !account.name) throw new Error(account.message ?? "请先登录 X")
  const contentKey = await sha256(JSON.stringify({ text, assets: context.task.assets.map(asset => [asset.id, asset.sha256]) }))
  const checkpoints = await getLocal<Record<string, Checkpoint>>(CHECKPOINT_KEY) ?? {}
  const state = checkpoints[context.task.taskId] ?? { account: account.name.toLowerCase(), contentKey, updatedAt: Date.now() }
  if (state.account !== account.name.toLowerCase()) throw new Error("X 当前账号与此同步任务的账号不同，请切回原账号或重新发起同步")
  if (state.contentKey !== contentKey) throw new Error("此 X 同步任务的内容已改变，请重新发起同步，避免复用旧草稿")
  const stage = (message: string) => context.reportProgress?.(message)
  const onHidden = () => stage("X 标签页在后台，切换到 X 标签页后自动继续")
  const save = async () => {
    state.updatedAt = Date.now()
    const latest = await getLocal<Record<string, Checkpoint>>(CHECKPOINT_KEY) ?? {}
    latest[context.task.taskId] = state
    await setLocal(CHECKPOINT_KEY, Object.fromEntries(Object.entries(latest).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 20)))
  }
  const skippedWarning = plan.skipped.length ? [`X 已跳过 ${plan.skipped.length} 张不支持格式的图片（如 GIF），全部文字已保留`] : []
  for (const asset of plan.skipped) context.uploadProgress?.skip?.(asset)
  if (text) {
    // X fills its own Post editor from the native text URL; images follow once it is ready.
    stage("正在通过 X 原生链接打开 Post 并预填文案")
    const result = await prepareXPostNativeText({ taskId: context.task.taskId, account: state.account, text, requested: state.nativeUrlRequested === true, onHidden })
    state.nativeUrlRequested = true
    await save()
    if (result.editorPending || !plan.images.length) {
      if (!result.editorPending) result.warnings.unshift(...skippedWarning)
      return result
    }
  }
  stage(`正在把 ${plan.images.length} 张图片交给 X 上传`)
  const files: File[] = []
  for (const asset of plan.images) files.push(await imageFile(context, asset))
  if (accountName()?.toLowerCase() !== state.account) throw new Error("X 当前账号已改变，请切回原账号后重试")
  const attached = await attachXPostNativeImages({ taskId: context.task.taskId, files, requireEmptyText: !text, onHidden })
  for (const asset of plan.images) context.uploadProgress?.complete(asset)
  return {
    draftUrl: attached.draftUrl,
    warnings: [
      ...skippedWarning,
      attached.reused ? "已保留你在 X 编辑器中的内容，请手动确认发布"
        : attached.uploading ? "图片仍在 X 中上传，请等待上传完成后手动发布"
        : "文案和图片已载入 X Post 编辑窗口，请确认后手动发布"
    ]
  }
}

function prepareOnce(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const key = context.task.taskId
  const active = runs.get(key)
  if (active) return active
  const run = prepare(context).finally(() => runs.delete(key))
  runs.set(key, run)
  return run
}

export const xPostAdapter: PlatformAdapter = {
  id: "x-post", title: config.label, editorUrl: config.editorUrl, titleLimit: config.titleLimit,
  detectAccount, prepareDraft: prepareOnce, retry: prepareOnce, dispose() {}
}
