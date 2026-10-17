const READY_BANNER_ID = "wesight-publish-ready-banner"
const UPLOAD_PROGRESS_ID = "wesight-publish-upload-progress"

export const READY_BANNER_AUTO_DISMISS_MS = 5_000

let autoDismissTimer: ReturnType<typeof setTimeout> | null = null

export function removeReadyBanner(): void {
  if (autoDismissTimer !== null) {
    clearTimeout(autoDismissTimer)
    autoDismissTimer = null
  }
  document.querySelector(`#${READY_BANNER_ID}`)?.remove()
}

export function showReadyBanner(warnings: string[]): void {
  document.querySelector(`#${UPLOAD_PROGRESS_ID}`)?.remove()
  removeReadyBanner()

  const banner = document.createElement("aside")
  banner.id = READY_BANNER_ID
  banner.setAttribute("role", "status")
  banner.setAttribute("aria-live", "polite")
  Object.assign(banner.style, {
    position: "fixed",
    zIndex: "2147483647",
    top: "16px",
    right: "16px",
    maxWidth: "360px",
    padding: "12px 40px 12px 14px",
    border: "1px solid rgba(217,119,87,.35)",
    borderRadius: "10px",
    background: "#fffaf7",
    boxShadow: "0 12px 32px rgba(35,28,24,.18)",
    color: "#3d2b24",
    fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    fontSize: "13px",
    lineHeight: "1.5"
  })

  const closeButton = document.createElement("button")
  closeButton.type = "button"
  closeButton.textContent = "×"
  closeButton.setAttribute("aria-label", "关闭 WeSight 提示")
  closeButton.title = "关闭"
  Object.assign(closeButton.style, {
    position: "absolute",
    top: "7px",
    right: "8px",
    width: "26px",
    height: "26px",
    padding: "0",
    border: "0",
    borderRadius: "6px",
    background: "transparent",
    color: "#73584c",
    cursor: "pointer",
    font: "20px/24px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"
  })
  closeButton.addEventListener("click", removeReadyBanner)

  const title = document.createElement("strong")
  title.textContent = "WeSight：内容已准备，请检查后发布"
  title.style.display = "block"
  banner.append(closeButton, title)

  if (warnings.length) {
    const detail = document.createElement("div")
    detail.textContent = warnings[0] + (warnings.length > 1 ? `，另有 ${warnings.length - 1} 项提示` : "")
    detail.style.marginTop = "4px"
    detail.style.color = "#8a4b32"
    banner.appendChild(detail)
  }

  document.body.appendChild(banner)
  autoDismissTimer = setTimeout(() => {
    if (document.querySelector(`#${READY_BANNER_ID}`) === banner) banner.remove()
    autoDismissTimer = null
  }, READY_BANNER_AUTO_DISMISS_MS)
}
