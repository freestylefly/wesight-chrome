import type { PlatformId, PublishAssetV1, PublishTaskV1 } from "~types/protocol"

const UPLOAD_PROGRESS_ID = "wesight-publish-upload-progress"

export interface UploadProgressController {
  complete(): void
  fail(fileName: string): void
  remove(): void
}

export function uploadAssetsForPlatform(platformId: PlatformId, task: PublishTaskV1): PublishAssetV1[] {
  if (platformId === "xiaohongshu" || platformId === "weibo-post" || platformId === "jike-post") return task.assets
  if (["bilibili-article", "toutiao", "weibo-article"].includes(platformId)) {
    const referenced = task.assets.filter(asset => {
      const token = `wesight-asset://${asset.id}`
      return task.article.html.includes(token) || task.article.markdown.includes(token)
    })
    const cover = task.article.coverAssetId
      ? task.assets.find(asset => asset.id === task.article.coverAssetId)
      : undefined
    if (platformId === "bilibili-article") return task.assets
    return cover && !referenced.some(asset => asset.id === cover.id) ? [...referenced, cover] : referenced
  }

  const assets = task.assets.filter(asset => {
    const token = `wesight-asset://${asset.id}`
    return task.article.html.includes(token) || task.article.markdown.includes(token)
  })
  if (platformId !== "zhihu" || !task.article.coverAssetId) return assets

  const cover = task.assets.find(asset => asset.id === task.article.coverAssetId)
  return cover && !assets.some(asset => asset.id === cover.id) ? [...assets, cover] : assets
}

export function createUploadProgress(platformLabel: string, total: number): UploadProgressController {
  document.querySelector(`#${UPLOAD_PROGRESS_ID}`)?.remove()

  const card = document.createElement("aside")
  card.id = UPLOAD_PROGRESS_ID
  card.setAttribute("role", "status")
  card.setAttribute("aria-live", "polite")
  Object.assign(card.style, {
    position: "fixed",
    zIndex: "2147483647",
    right: "20px",
    bottom: "20px",
    width: "300px",
    padding: "13px 14px",
    border: "1px solid rgba(217,119,87,.32)",
    borderRadius: "12px",
    background: "rgba(255,250,247,.97)",
    boxShadow: "0 12px 34px rgba(35,28,24,.18)",
    color: "#3d2b24",
    fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    fontSize: "13px",
    lineHeight: "1.45",
    backdropFilter: "blur(8px)"
  })

  const heading = document.createElement("div")
  heading.textContent = "WeSight · 图片上传"
  Object.assign(heading.style, { fontWeight: "700", marginBottom: "5px" })

  const detail = document.createElement("div")
  Object.assign(detail.style, { color: "#73584c", marginBottom: "9px" })

  const track = document.createElement("div")
  Object.assign(track.style, {
    height: "6px",
    overflow: "hidden",
    borderRadius: "999px",
    background: "rgba(217,119,87,.16)"
  })

  const bar = document.createElement("span")
  Object.assign(bar.style, {
    display: "block",
    width: "0%",
    height: "100%",
    borderRadius: "inherit",
    background: "#d97757",
    transition: "width .2s ease"
  })
  track.appendChild(bar)
  card.append(heading, detail, track)
  document.body.appendChild(card)

  let completed = 0
  let failedFile = ""
  const render = () => {
    const progress = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 100
    bar.style.width = `${progress}%`
    if (failedFile) {
      detail.textContent = `${platformLabel}：上传失败 ${completed}/${total} · ${failedFile}`
      detail.style.color = "#b3412f"
      bar.style.background = "#c95743"
      return
    }
    detail.textContent = completed >= total
      ? `${platformLabel}：图片上传完成 ${completed}/${total}`
      : `${platformLabel}：正在上传 ${completed}/${total}`
  }
  render()

  return {
    complete() {
      completed = Math.min(total, completed + 1)
      render()
    },
    fail(fileName: string) {
      failedFile = fileName
      render()
    },
    remove() {
      card.remove()
    }
  }
}
