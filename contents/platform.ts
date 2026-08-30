import type { PlasmoCSConfig } from "plasmo"

import { createUploadProgress, uploadAssetsForPlatform, type UploadProgressController } from "~lib/upload-progress"
import { platformFromUrl } from "~platforms/config"
import { PLATFORM_ADAPTERS } from "~platforms/index"
import type { ContentRequest, ExtensionRequest, ExtensionResponse } from "~types/messages"
import type { PlatformId, PublishAssetV1 } from "~types/protocol"

export const config: PlasmoCSConfig = {
  matches: [
    "https://www.zhihu.com/*",
    "https://zhuanlan.zhihu.com/*",
    "https://www.csdn.net/*",
    "https://editor.csdn.net/*",
    "https://mp.csdn.net/*",
    "https://passport.csdn.net/*",
    "https://juejin.cn/*",
    "https://passport.juejin.cn/*",
    "https://member.bilibili.com/*",
    "https://passport.bilibili.com/*"
  ],
  run_at: "document_idle"
}

function showReadyBanner(warnings: string[]): void {
  document.querySelector("#wesight-publish-upload-progress")?.remove()
  document.querySelector("#wesight-publish-ready-banner")?.remove()
  const banner = document.createElement("aside")
  banner.id = "wesight-publish-ready-banner"
  banner.setAttribute("role", "status")
  Object.assign(banner.style, {
    position: "fixed",
    zIndex: "2147483647",
    top: "16px",
    right: "16px",
    maxWidth: "360px",
    padding: "12px 14px",
    border: "1px solid rgba(217,119,87,.35)",
    borderRadius: "10px",
    background: "#fffaf7",
    boxShadow: "0 12px 32px rgba(35,28,24,.18)",
    color: "#3d2b24",
    fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    fontSize: "13px",
    lineHeight: "1.5"
  })
  const title = document.createElement("strong")
  title.textContent = "WeSight：内容已准备，请检查后发布"
  title.style.display = "block"
  banner.appendChild(title)
  if (warnings.length) {
    const detail = document.createElement("div")
    detail.textContent = warnings[0] + (warnings.length > 1 ? `，另有 ${warnings.length - 1} 项提示` : "")
    detail.style.marginTop = "4px"
    detail.style.color = "#8a4b32"
    banner.appendChild(detail)
  }
  document.body.appendChild(banner)
}

async function send(request: ExtensionRequest): Promise<unknown> {
  const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse>(request)
  if (!response?.ok) throw new Error(response?.error ?? "扩展后台响应失败")
  return response.value
}

const platformId = platformFromUrl(location.href)

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  void (async () => {
    if (!platformId) throw new Error("当前页面不属于已支持的平台")
    const adapter = PLATFORM_ADAPTERS[platformId]
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
    const uploadProgress: UploadProgressController | null = uploadAssets.length
      ? createUploadProgress(adapter.title, uploadAssets.length)
      : null
    const assetProgress = {
      complete: (_asset: PublishAssetV1) => uploadProgress?.complete(),
      fail: (asset: PublishAssetV1) => uploadProgress?.fail(asset.fileName)
    }
    try {
      const result = await adapter.prepareDraft({
        task: message.task,
        uploadProgress: assetProgress,
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
      showReadyBanner(result.warnings)
      await send({
        type: "PLATFORM_RESULT",
        taskId: message.task.taskId,
        platformId,
        warnings: result.warnings,
        draftUrl: result.draftUrl
      })
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
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
if (platformId) {
  void send({ type: "PLATFORM_PAGE_READY", platformId, url: location.href }).catch(() => undefined)
}

window.addEventListener("pagehide", () => {
  if (platformId) PLATFORM_ADAPTERS[platformId].dispose()
}, { once: true })
