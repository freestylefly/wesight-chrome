import type { AccountRecord } from "~lib/storage"
import type { PlatformId } from "~types/protocol"

/** Self-contained: Chrome serializes this function into an existing platform tab. */
export function readAccountPage(platformId: PlatformId): AccountRecord {
  const unknown: AccountRecord = { state: "unknown" }
  const host = location.hostname
  const visible = (element: Element) => {
    if (element.closest('[hidden], [aria-hidden="true"]')) return false
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false
    }
    return element.getClientRects().length > 0
  }
  const firstVisible = (selectors: string, root: ParentNode = document) => Array.from(root.querySelectorAll(selectors)).find(visible) ?? null
  const compact = (element: Element) => element.textContent?.replace(/\s+/g, " ").trim() ?? ""
  const imageUrl = (element: Element | null) => {
    const value = element?.getAttribute("src")
    if (!value) return undefined
    try { const url = new URL(value, location.href); return url.protocol === "https:" ? url.href : undefined } catch { return undefined }
  }
  // Only search account-specific chrome, never feed authors or the open profile.
  const identity = (region: Element, nameSelectors: string): AccountRecord | null => {
    if (!visible(region)) return null
    const avatar = imageUrl(firstVisible("img[src]", region))
    const label = firstVisible(nameSelectors, region)
    const name = label ? compact(label) : region.getAttribute("data-user-name")?.trim()
    const nickname = name && name.length <= 120 && !/^(?:--|登录|未登录|账号|头像|个人中心|我的主页|我的|我|avatar|profile)$/i.test(name) ? name : undefined
    if (!avatar || !nickname) return null
    return { state: "logged_in", name: nickname, avatar }
  }
  const loginFormVisible = () => {
    const roots = document.querySelectorAll('form, [role="dialog"], [class*="login"], [class*="Login"]')
    return Array.from(roots).some(root => visible(root)
      && /(?:扫码登录|手机号登录|手机登录|登录即刻|验证码登录|登录后创作|登录\/注册)/.test(compact(root))
      && Boolean(firstVisible('input[type="tel"], input[type="password"], input[autocomplete="one-time-code"], canvas, img[src*="qr"], [class*="qrcode"], [class*="QRCode"]', root)))
  }
  if (platformId === "xiaohongshu" && host === "creator.xiaohongshu.com") {
    if (/^\/(?:login|signin)(?:\/|$)/i.test(location.pathname) || loginFormVisible()) return { state: "login_required" }
    const accountRegions = document.querySelectorAll('#header-area .user-info, header .user-info, .header .user-info, .creator-header .user-info, .reds-header .user-info, header [data-testid="user-menu"], [role="banner"] [data-testid="user-menu"]')
    for (const region of accountRegions) {
      const result = identity(region, '.name-box, .user-name, .username, .name, [data-testid="user-name"]')
      if (result) return result
    }
    // An editor or an active upload workflow is positive evidence. A blank SPA
    // shell, an arbitrary contenteditable and the absence of a login modal are not.
    const title = firstVisible('input[placeholder*="标题"], textarea[placeholder*="标题"]')
    const editor = firstVisible('.ql-editor[contenteditable="true"], .tiptap[contenteditable="true"], [contenteditable="true"][data-placeholder*="正文"]')
    const action = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], .creator-tab')).some(element => visible(element) && /^(?:发布|发布笔记|上传图文|上传视频)$/.test(compact(element)))
    // File inputs can be hidden by the site's upload button; use the visible
    // workflow entry together with a real upload input as the evidence.
    const upload = Array.from(document.querySelectorAll('input[type="file"][accept]')).some(input =>
      input.getAttribute("accept")!.split(",").some(value => /^(?:image\/[\w*.+-]+|video\/[\w*.+-]+|\.(?:jpe?g|png|webp|gif|mp4|mov|webm|m4v))$/i.test(value.trim())))
    return action && ((title && editor) || upload) ? { state: "logged_in" } : unknown
  }
  if (platformId === "jike-post" && host === "web.okjike.com") {
    if (/^\/(?:login|signin)(?:\/|$)/i.test(location.pathname) || loginFormVisible()) return { state: "login_required" }
    const accountRegions = document.querySelectorAll('nav [data-testid="user-menu"], aside [data-testid="user-menu"], header [data-testid="user-menu"], nav .user-info, aside .user-info, header .user-info, [role="navigation"] .user-info')
    for (const region of accountRegions) {
      const result = identity(region, '.user-name, .username, .name, [data-testid="user-name"]')
      if (result) return result
    }
    // A navigation link to one's own profile is labelled as such. A feed
    // author's /u/... link alone never identifies the current account.
    for (const profile of document.querySelectorAll('nav a[href], aside a[href], [role="navigation"] a[href]')) {
      if (!visible(profile)) continue
      let url: URL
      try { url = new URL(profile.getAttribute("href")!, location.href) } catch { continue }
      if (url.hostname !== host || !/^\/(?:u|users)\/[\w-]+\/?$/.test(url.pathname)) continue
      if (!/^(?:我|我的|我的主页|个人主页)$/.test(profile.getAttribute("aria-label")?.trim() || compact(profile))) continue
      const avatar = imageUrl(firstVisible('img[src]', profile))
      if (avatar) return { state: "logged_in", avatar }
    }
    // Jike's current sidebar is a plain Stack of icon links. Its own-profile
    // link has no text or avatar; the visible title and sibling routes identify
    // the authenticated navigation without borrowing identities from the feed.
    const navigationLabels: Record<string, string> = { "/following": "动态", "/explore": "发现", "/notification": "通知", "/more": "更多" }
    const titled = (element: Element, title: string) => element.getAttribute("title") === title
      || Array.from(element.querySelectorAll("[title]")).some(child => visible(child) && child.getAttribute("title") === title)
    for (const profile of document.querySelectorAll('a[href]')) {
      if (!visible(profile) || !titled(profile, "个人主页")) continue
      let url: URL
      try { url = new URL(profile.getAttribute("href")!, location.href) } catch { continue }
      if (url.origin !== location.origin || !/^\/u\/[\w-]+\/?$/.test(url.pathname)) continue
      const siblings = Array.from(profile.parentElement?.children ?? []).filter(element => element.matches("a[href]") && visible(element))
      const routes = new Set(siblings.flatMap(element => {
        try {
          const target = new URL(element.getAttribute("href")!, location.href)
          const label = navigationLabels[target.pathname]
          return target.origin === location.origin && label && titled(element, label) ? [target.pathname] : []
        } catch { return [] }
      }))
      if (Object.keys(navigationLabels).every(route => routes.has(route))) return { state: "logged_in" }
    }
    const editor = firstVisible('[role="dialog"] [contenteditable="true"][role="textbox"], textarea[placeholder*="分享"], textarea[placeholder*="动态"], [contenteditable="true"][data-placeholder*="分享"], [contenteditable="true"][data-placeholder*="动态"]')
    const composer = editor?.closest('form, [role="dialog"], [class*="composer"], [class*="Composer"], [class*="postForm"]')
    const action = composer && Array.from(composer.querySelectorAll('button, [role="button"]')).some(element => visible(element) && /^(?:发布|发布动态|发送|分享)$/.test(compact(element)))
    return editor && action ? { state: "logged_in" } : unknown
  }
  if (platformId === "csdn" && ["www.csdn.net", "mp.csdn.net", "editor.csdn.net"].includes(host)) {
    const profile = document.querySelector('.toolbar-btn-login a.hasAvatar[href]')
    if (!profile || !visible(profile)) return unknown
    const username = /^https:\/\/blog\.csdn\.net\/([\w-]+)\/?$/.exec(profile.getAttribute("href") ?? "")?.[1]
    if (!username) return unknown
    const nickname = document.querySelector("#csdn-toolbar-profile-new .csdn-profile-nickName")?.textContent?.trim()
    return { state: "logged_in", name: nickname && nickname !== "--" ? nickname : username, avatar: imageUrl(profile.querySelector("img")) }
  }
  if (platformId === "weibo-article" && ["weibo.com", "www.weibo.com"].includes(host)) {
    const avatar = document.querySelector('.woo-tab-nav img[alt="profile"], [role="navigation"] img[alt="profile"], nav img[alt="profile"]')
    const profile = avatar?.closest("a[href]")
    if (!profile || !visible(profile)) return unknown
    const url = new URL(profile.getAttribute("href")!, location.href)
    if (!["weibo.com", "www.weibo.com"].includes(url.hostname) || !/^\/u\/\d+\/?$/.test(url.pathname)) return unknown
    const name = profile.getAttribute("title")?.trim() || profile.querySelector("[aria-label]")?.getAttribute("aria-label")?.trim()
    return { state: "logged_in", ...(name ? { name } : {}), avatar: imageUrl(avatar ?? null) }
  }
  if ((platformId === "x-article" || platformId === "x-post") && ["x.com", "twitter.com"].includes(host)) {
    const profile = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')
    if (!profile || !visible(profile)) {
      const login = document.querySelector('[data-testid="loginButton"]')
      return login && visible(login) ? { state: "login_required" } : unknown
    }
    const name = Array.from(profile.querySelectorAll("span"), span => span.textContent?.trim()).find(value => /^@[\w]+$/.test(value ?? ""))
    return name ? { state: "logged_in", name: name.slice(1) } : unknown
  }
  return unknown
}
