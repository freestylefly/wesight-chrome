import { PLATFORM_CONFIG } from "~platforms/config"
import {
  attachImages,
  bodyWithHashtags,
  composerRoot,
  countGraphemes,
  findAction,
  imageAssets,
  insertText,
  normalizedTags,
  overLimitError,
  postBody,
  queryVisible,
  skippedVideoWarning,
  waitFor
} from "~platforms/overseas/common"
import { PlatformPageChangedError, type AccountDetection, type PlatformAdapter, type PrepareDraftContext, type PrepareDraftResult } from "~platforms/types"
import type { PlatformId } from "~types/protocol"

export interface ComposerPostSpec {
  id: PlatformId
  /** Short brand name used in messages, e.g. "Bluesky". */
  platform: string
  loginRequired(): boolean
  accountName?(): string | undefined
  /** Controls that open the composer (never a publish button). */
  openLabels: readonly RegExp[]
  editorSelectors: readonly string[]
  imageInputSelectors: readonly string[]
  /** Controls that reveal the image input inside the composer. */
  imageRevealLabels?: readonly RegExp[]
  /** Paste images into the editor when the site keeps no file input in the DOM. */
  pasteImages?: boolean
  imageLimit: number
  textLimit?: number
  /** Bluesky counts graphemes; most others count UTF-16 code units. */
  countGraphemes?: boolean
  /** Append "#tag" to the text, otherwise warn that topics were skipped. */
  hashtags: boolean
  tagsSkippedWarning?: string
  /** Extra hint shown when images were handed over (e.g. a media editor the user must close). */
  imageNote?: string
}

const SETTLE_MS = 300

export function createComposerPostAdapter(spec: ComposerPostSpec): PlatformAdapter {
  const config = PLATFORM_CONFIG[spec.id]
  const runs = new Map<string, Promise<PrepareDraftResult>>()

  async function findEditor(): Promise<HTMLElement | null> {
    // Open the composer as soon as its trigger renders, unless an editor is already open.
    const ready = await waitFor(() => queryVisible<HTMLElement>(spec.editorSelectors) ?? findAction(spec.openLabels), 5_000)
    if (ready && ready.matches(spec.editorSelectors.join(","))) return ready
    ready?.click()
    return waitFor(() => queryVisible<HTMLElement>(spec.editorSelectors), 12_000)
  }

  async function prepare(context: PrepareDraftContext): Promise<PrepareDraftResult> {
    const { task } = context
    if (spec.loginRequired()) throw new Error(`请先登录 ${spec.platform}，登录完成后从发布助手重试`)
    const warnings: string[] = [...skippedVideoWarning(task, spec.platform)]
    const text = spec.hashtags ? bodyWithHashtags(task) : postBody(task)
    if (!spec.hashtags && normalizedTags(task).length) {
      warnings.push(spec.tagsSkippedWarning ?? `${spec.platform} 不使用话题标签，已跳过标签`)
    }
    if (spec.textLimit) {
      const count = spec.countGraphemes ? countGraphemes(text) : text.length
      if (count > spec.textLimit) throw overLimitError(spec.platform, spec.textLimit, count)
    }
    let images = imageAssets(task)
    if (images.length > spec.imageLimit) {
      for (const asset of images.slice(spec.imageLimit)) context.uploadProgress?.skip?.(asset)
      warnings.push(`${spec.platform} 最多 ${spec.imageLimit} 张图片，已跳过后 ${images.length - spec.imageLimit} 张`)
      images = images.slice(0, spec.imageLimit)
    }
    if (!text && !images.length) throw new Error(`${spec.platform} 动态内容为空，请填写文案或添加图片`)

    const editor = await findEditor()
    if (!editor && spec.loginRequired()) throw new Error(`请先登录 ${spec.platform}，登录完成后从发布助手重试`)
    if (!editor) throw new PlatformPageChangedError(config.label, "动态编辑框")
    const retried = editor.dataset.wesightTask === task.taskId
    if (text && !(await insertText(editor, text))) throw new Error(`${spec.platform} 正文填充失败，请刷新编辑页后重试`)
    editor.dataset.wesightTask = task.taskId

    if (images.length && retried && editor.dataset.wesightImages === "1") {
      warnings.push(`已保留之前交给 ${spec.platform} 的图片，请检查是否齐全`)
    } else if (images.length) {
      warnings.push(...await attachImages({
        context,
        assets: images,
        platform: spec.platform,
        root: composerRoot(editor),
        inputSelectors: spec.imageInputSelectors,
        revealLabels: spec.imageRevealLabels,
        pasteTarget: spec.pasteImages ? editor : undefined
      }))
      editor.dataset.wesightImages = "1"
      if (spec.imageNote) warnings.push(spec.imageNote)
    }
    await new Promise(resolve => window.setTimeout(resolve, SETTLE_MS))
    return { draftUrl: location.href, warnings }
  }

  function prepareOnce(context: PrepareDraftContext): Promise<PrepareDraftResult> {
    const key = context.task.taskId
    const active = runs.get(key)
    if (active) return active
    const run = prepare(context).finally(() => runs.delete(key))
    runs.set(key, run)
    return run
  }

  return {
    id: spec.id,
    title: config.label,
    editorUrl: config.editorUrl,
    titleLimit: config.titleLimit,
    async detectAccount(): Promise<AccountDetection> {
      if (spec.loginRequired()) return { loggedIn: false, message: `请先登录 ${spec.platform}，登录完成后重试` }
      const name = spec.accountName?.()
      return name ? { loggedIn: true, name } : { loggedIn: true }
    },
    prepareDraft: prepareOnce,
    retry: prepareOnce,
    dispose() {}
  }
}
