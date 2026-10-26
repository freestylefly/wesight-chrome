import type { PlasmoCSConfig } from "plasmo"

import { showReadyBanner } from "~lib/ready-banner"
import { createUploadProgress, uploadAssetsForPlatform, type UploadProgressController } from "~lib/upload-progress"
import { isXPlatform, platformFromUrl } from "~platforms/config"
import { PLATFORM_ADAPTERS } from "~platforms/index"
import type { ContentRequest, ExtensionRequest, ExtensionResponse } from "~types/messages"
import type { PlatformId, PublishAssetV1 } from "~types/protocol"

export const config: PlasmoCSConfig = {
  matches: [
    "https://www.zhihu.com/*",
    "https://creator.xiaohongshu.com/*",
    "https://zhuanlan.zhihu.com/*",
    "https://www.csdn.net/*",
    "https://editor.csdn.net/*",
    "https://mp.csdn.net/*",
    "https://passport.csdn.net/*",
    "https://juejin.cn/*",
    "https://passport.juejin.cn/*",
    "https://member.bilibili.com/*",
    "https://passport.bilibili.com/*",
    "https://mp.toutiao.com/*",
    "https://sso.toutiao.com/*",
    "https://card.weibo.com/*",
    "https://weibo.com/*",
    "https://www.weibo.com/*",
    "https://passport.weibo.com/*",
    "https://login.sina.com.cn/*",
    "https://web.okjike.com/*",
    "https://x.com/*",
    "https://twitter.com/*"
  ],
  run_at: "document_idle"
}

async function send(request: ExtensionRequest): Promise<unknown> {
  const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse>(request)
  if (!response?.ok) throw new Error(response?.error ?? "扩展后台响应失败")
  return response.value
}

const usedAdapters = new Set<PlatformId>()

function requestPlatform(message: ContentRequest): PlatformId | null {
  const current = platformFromUrl(location.href)
  if (message.type !== "PREPARE_DRAFT") return current
  if (message.platformId) {
    if (message.platformId === current || (isXPlatform(current) && isXPlatform(message.platformId))) return message.platformId
    throw new Error("当前页面与同步平台不匹配")
  }
  // Accept tasks from an older background instance while selecting the one X
  // destination from the task, rather than a route captured before SPA navigation.
  if (isXPlatform(current)) {
    const targets = message.task.targets.filter(isXPlatform)
    if (targets.length === 1) return targets[0]!
  }
  return current
}

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  void (async () => {
    const platformId = requestPlatform(message)
    if (!platformId) throw new Error("当前页面不属于已支持的平台")
    const adapter = PLATFORM_ADAPTERS[platformId]
    usedAdapters.add(platformId)
    if (message.type === "CHECK_ACCOUNT") return adapter.detectAccount()
    if (message.type === "SHOW_READY") {
      showReadyBanner(message.warnings)
      return true
    }
    if (!message.task.targets.includes(platformId)) throw new Error("当前任务未选择此平台")
    const account = await adapter.detectAccount()
    if (!account.loggedIn) {
      await send({
        type: "PLATFORM_LOGIN_REQUIRED",
        taskId: message.task.taskId,
        platformId,
        message: account.message ?? `请先登录${adapter.title}`
      })
      return { loginRequired: true }
    }
    const uploadAssets = uploadAssetsForPlatform(platformId, message.task)
    const uploadProgress: UploadProgressController | null = uploadAssets.length || platformId === "x-article" || platformId === "x-post"
      ? createUploadProgress(adapter.title, uploadAssets.length, message.task.media?.videoAssetId ? "视频" : "图片")
      : null
    let progressUpdates = Promise.resolve()
    let uploadFailed = false
    const assetProgress = {
      complete: (_asset: PublishAssetV1) => uploadProgress?.complete(),
      skip: (_asset: PublishAssetV1) => uploadProgress?.skip(),
      fail: (asset: PublishAssetV1) => {
        uploadFailed = true
        uploadProgress?.fail(asset.fileName)
      }
    }
    try {
      const result = await adapter.prepareDraft({
        task: message.task,
        reportProgress: text => {
          uploadProgress?.stage(text)
          progressUpdates = progressUpdates.then(() => send({ type: "PLATFORM_PROGRESS", taskId: message.task.taskId, platformId, message: text })).then(() => undefined).catch(() => undefined)
        },
        uploadProgress: assetProgress,
        getAssetBlob: async (asset: PublishAssetV1) => {
          const parts: ArrayBuffer[] = []
          let offset = 0
          while (offset < asset.size) {
            const chunk = await send({ type: "GET_ASSET_CHUNK", taskId: message.task.taskId, assetId: asset.id, offset }) as { base64: string; end: number }
            if (!Number.isSafeInteger(chunk.end) || chunk.end <= offset || chunk.end > asset.size || typeof chunk.base64 !== "string") throw new Error("视频附件分片读取失败")
            parts.push(Uint8Array.from(atob(chunk.base64), char => char.charCodeAt(0)).buffer)
            offset = chunk.end
          }
          return new Blob(parts, { type: asset.mimeType })
        },
        getAssetData: async (asset: PublishAssetV1) => {
          const value = await send({ type: "GET_ASSET_DATA", taskId: message.task.taskId, asset })
          if (typeof value !== "string") throw new Error(`图片 ${asset.fileName} 数据无效`)
          return value
        },
        pageBridge: {
          fillEditor: async input => {
            await send({ type: "FILL_PLATFORM_EDITOR", ...input })
          },
          uploadAsset: async (assetPlatformId, asset) => {
            try {
              const value = await send({
                type: "UPLOAD_PLATFORM_ASSET",
                taskId: message.task.taskId,
                platformId: assetPlatformId,
                asset
              })
              if (typeof value !== "string" || !/^https?:\/\//i.test(value)) {
                throw new Error(`${adapter.title} 图片“${asset.fileName}”上传返回数据无效`)
              }
              assetProgress.complete(asset)
              return value
            } catch (error) {
              assetProgress.fail(asset)
              throw error
            }
          }
        }
      })
      await progressUpdates
      if (result.editorPending) uploadProgress?.remove()
      else showReadyBanner(result.warnings)
      await send({
        type: "PLATFORM_RESULT",
        taskId: message.task.taskId,
        platformId,
        warnings: result.warnings,
        draftUrl: result.draftUrl,
        ...(result.editorPending ? { editorPending: true } : {})
      })
      return result
    } catch (error) {
      await progressUpdates
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (!uploadFailed) uploadProgress?.remove()
      await send({ type: "PLATFORM_FAILED", taskId: message.task.taskId, platformId, message: errorMessage })
      throw error
    }
  })()
    .then(value => sendResponse({ ok: true, value } satisfies ExtensionResponse))
    .catch(error => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies ExtensionResponse))
  return true
})

// Register the receiver before announcing that the page is ready. The background
// responds to PLATFORM_PAGE_READY immediately with PREPARE_DRAFT, so announcing
// first can lose the initial task on a freshly opened editor tab.
function announcePage(): void {
  const platformId = platformFromUrl(location.href)
  if (platformId) void send({ type: "PLATFORM_PAGE_READY", platformId, url: location.href }).catch(() => undefined)
}
announcePage()
window.addEventListener("popstate", announcePage)

window.addEventListener("pagehide", () => {
  window.removeEventListener("popstate", announcePage)
  for (const platformId of usedAdapters) PLATFORM_ADAPTERS[platformId].dispose()
}, { once: true })
