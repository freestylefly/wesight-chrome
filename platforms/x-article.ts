import { X_IMAGE_LIMIT, xImagePlan } from "~lib/article-preparation"
import { sanitizePlatformHtml, truncateTitle } from "~lib/content"
import { getLocal, setLocal } from "~lib/storage"
import { discoverXApi, XApiError, XArticleApi, type XUploadedMedia } from "~lib/x-article-api"
import { xArticleContent } from "~lib/x-article-content"
import { supportedXImages, XUnsupportedImageError } from "~lib/x-image-policy"
import { PLATFORM_CONFIG } from "~platforms/config"
import { loginPageDetected } from "~platforms/dom"
import type { PlatformAdapter, PrepareDraftContext, PrepareDraftResult } from "~platforms/types"
import type { PublishAssetV1 } from "~types/protocol"

const config = PLATFORM_CONFIG["x-article"]
const CHECKPOINT_KEY = "wesight_x_article_checkpoints_v1"
interface Checkpoint {
  account: string
  updatedAt: number
  images: Record<string, XUploadedMedia>
  unsupportedImages?: string[]
  creationPending?: boolean
  draftId?: string
  coverSaved?: boolean
  complete?: boolean
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
  return { loggedIn: false, message: "未能确认 X 当前账号，请登录并刷新 X 文章页后重试" }
}

function fromDataUrl(dataUrl: string, asset: PublishAssetV1): File {
  if (!/^data:image\/[\w.+-]+;base64,/i.test(dataUrl)) throw new Error(`图片“${asset.fileName}”数据无效`)
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1))
  return new File([Uint8Array.from(binary, character => character.charCodeAt(0))], asset.fileName, { type: asset.mimeType })
}

async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const document = new DOMParser().parseFromString(sanitizePlatformHtml(context.task.article.html), "text/html")
  const allImages = Array.from(document.querySelectorAll("img"))
  const requestedCover = context.task.article.coverAssetId ? `wesight-asset://${context.task.article.coverAssetId}` : null
  const supported = supportedXImages(allImages.map(image => image.getAttribute("src") ?? ""), requestedCover, context.task.assets)
  const skippedFormats = supported.skipped
  const checkpoints = await getLocal<Record<string, Checkpoint>>(CHECKPOINT_KEY) ?? {}
  for (const source of checkpoints[context.task.taskId]?.unsupportedImages ?? []) skippedFormats.add(source)
  for (const image of allImages) if (skippedFormats.has(image.getAttribute("src") ?? "")) image.remove()
  const images = allImages.filter(image => !skippedFormats.has(image.getAttribute("src") ?? ""))
  let cover = supported.cover && !skippedFormats.has(supported.cover) ? supported.cover : null
  const plan = xImagePlan(images.map(image => image.getAttribute("src") ?? ""), cover)
  const skipExcess = context.task.targetOptions?.xArticle?.skipExcessImages === true
  if (plan.total > X_IMAGE_LIMIT && !skipExcess) throw new Error(`X 文章最多上传 ${X_IMAGE_LIMIT} 张图片，当前有 ${plan.total} 张`)
  const retained = skipExcess ? images.slice(0, plan.bodyLimit) : images
  if (skipExcess) for (const image of images.slice(plan.bodyLimit)) image.remove()
  const sources = retained.map(image => image.getAttribute("src") ?? "")
  const limited = truncateTitle(context.task.article.title, config.titleLimit)
  if (!limited.title) throw new Error("请先填写 X 文章标题")
  const warnings = limited.truncated ? ["X 文章标题超过 100 字，已截断"] : []
  if (skipExcess && plan.skipped) warnings.push(`X 已跳过超出上限的 ${plan.skipped} 张正文图片，全部文字已保留`)
  const resultWarnings = () => [
    ...(skippedFormats.size ? [`X 已跳过 ${skippedFormats.size} 张不支持格式的图片（如 GIF），全部文字已保留${requestedCover && !cover ? "；封面也已跳过，请在 X 编辑页补充" : ""}`] : []),
    ...warnings
  ]
  const account = await detectAccount()
  if (!account.loggedIn || !account.name) throw new Error(account.message ?? "请先登录 X")
  const state: Checkpoint = checkpoints[context.task.taskId] ?? { account: account.name.toLowerCase(), updatedAt: Date.now(), images: {} }
  if (state.account !== account.name.toLowerCase()) throw new Error("X 当前账号与此同步任务的账号不同，请切回原账号或重新发起同步")
  const draftUrl = () => `https://x.com/compose/articles/edit/${state.draftId}`
  if (state.complete && state.draftId) return { draftUrl: draftUrl(), warnings: resultWarnings() }
  if (state.creationPending && !state.draftId) {
    throw new Error("上次创建 X 草稿的结果未确认，请先检查 X 草稿列表；确认后重新发起同步，避免重复创建")
  }
  const save = async () => {
    state.updatedAt = Date.now()
    const latest = await getLocal<Record<string, Checkpoint>>(CHECKPOINT_KEY) ?? {}
    latest[context.task.taskId] = state
    await setLocal(CHECKPOINT_KEY, Object.fromEntries(Object.entries(latest).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 20)))
  }
  const stage = (message: string) => context.reportProgress?.(message)
  if (skippedFormats.size) stage(`已跳过 ${skippedFormats.size} 张不支持格式的图片，继续同步`)
  stage("正在读取 X 文章接口配置")
  const api = new XArticleApi(await discoverXApi())
  const media = new Map<string, string>()
  const needed = [...new Set([...sources, ...(cover ? [cover] : [])])]
  let completed = 0
  let skippedUploads = 0
  for (const source of needed) {
    // Once content is saved, only an unfinished cover needs another upload.
    if (state.draftId && source !== cover) continue
    const id = /^wesight-asset:\/\/([^/]+)$/.exec(source)?.[1]
    const asset = context.task.assets.find(item => item.id === id)
    const cached = state.images[source]
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      media.set(source, cached.id)
      if (asset) context.uploadProgress?.complete(asset)
      completed++
      stage(`图片已准备 ${completed}/${needed.length - skippedUploads}`)
      continue
    }
    stage(`正在上传图片 ${completed + 1}/${needed.length - skippedUploads}`)
    try {
      let file: File
      if (asset) file = fromDataUrl(await context.getAssetData(asset), asset)
      else if (/^https?:\/\//i.test(source)) {
        const response = await fetch(source, { credentials: "omit", signal: AbortSignal.timeout(30_000) })
        if (!response.ok) throw new Error(`无法读取 X 正文第 ${completed + 1} 张图片`)
        const blob = await response.blob()
        file = new File([blob], `image-${completed + 1}`, { type: blob.type })
      } else throw new Error(`X 正文第 ${completed + 1} 张图片缺少可上传的数据`)
      state.images[source] = await api.uploadImage(file)
      media.set(source, state.images[source]!.id)
      await save()
      if (asset) context.uploadProgress?.complete(asset)
      completed++
      stage(`图片已上传 ${completed}/${needed.length - skippedUploads}`)
    } catch (error) {
      if (error instanceof XUnsupportedImageError) {
        skippedFormats.add(source)
        state.unsupportedImages = Array.from(skippedFormats)
        await save()
        skippedUploads++
        for (const image of retained) if (image.getAttribute("src") === source) image.remove()
        if (cover === source) cover = null
        if (asset) context.uploadProgress?.skip?.(asset)
        stage(`已跳过不支持格式的图片${asset ? `“${asset.fileName}”` : ""}，继续同步`)
        continue
      }
      if (asset) context.uploadProgress?.fail(asset)
      throw error
    }
  }
  if (!state.draftId) {
    const content = xArticleContent(document.body.innerHTML, media)
    if (!content.blocks.length) throw new Error("X 文章正文为空，请补充内容后重试")
    stage("正在创建 X 文章草稿")
    // Persist before sending the non-idempotent mutation. An ambiguous result
    // requires inspection; it must never automatically create another draft.
    state.creationPending = true
    await save()
    try { state.draftId = await api.createDraft(limited.title, content) }
    catch (error) {
      if (error instanceof XApiError && !error.uncertain) {
        state.creationPending = false
        await save()
      }
      if (error instanceof XApiError && error.uncertain) throw new Error(`${error.message}。创建结果未确认，请先检查 X 草稿列表；插件已暂停重复创建`)
      throw error
    }
    state.creationPending = false
    await save()
  }
  if (cover && !state.coverSaved) {
    stage("正在保存 X 文章封面")
    const mediaId = media.get(cover)
    if (!mediaId) throw new Error("X 封面上传结果缺失，请重试；将继续使用同一草稿")
    try { await api.setCover(state.draftId, mediaId) }
    catch (error) {
      throw new Error(`${error instanceof Error ? error.message : "X 封面保存失败"}。草稿已保留，重试会继续保存封面`)
    }
    state.coverSaved = true
    await save()
  }
  state.complete = true
  await save()
  stage("X 草稿已保存，正在打开编辑页")
  return { draftUrl: draftUrl(), warnings: resultWarnings() }
}

function prepareOnce(context: PrepareDraftContext): Promise<PrepareDraftResult> {
  const key = context.task.taskId
  const active = runs.get(key)
  if (active) return active
  const run = prepare(context).finally(() => runs.delete(key))
  runs.set(key, run)
  return run
}

export const xArticleAdapter: PlatformAdapter = {
  id: "x-article", title: config.label, editorUrl: config.editorUrl, titleLimit: config.titleLimit,
  detectAccount, prepareDraft: prepareOnce, retry: prepareOnce, dispose() {}
}
