const BLOCKED_TAGS = new Set([
  "SCRIPT", "STYLE", "FORM", "IFRAME", "OBJECT", "EMBED", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "META", "LINK"
])

const ALLOWED_STYLE_PROPERTIES = new Set([
  "color", "background-color", "text-align", "font-weight", "font-style", "text-decoration"
])

function safeResource(value: string, image: boolean): boolean {
  if (image && /^(?:wesight-asset|data:image\/|https?:)/i.test(value)) return true
  return /^(?:https?:|mailto:|#)/i.test(value)
}

function cleanStyle(value: string): string {
  return value
    .split(";")
    .map(rule => rule.trim())
    .filter(Boolean)
    .map(rule => {
      const separator = rule.indexOf(":")
      if (separator < 0) return ""
      const property = rule.slice(0, separator).trim().toLowerCase()
      const styleValue = rule.slice(separator + 1).trim()
      if (!ALLOWED_STYLE_PROPERTIES.has(property) || /url\s*\(|expression\s*\(/i.test(styleValue)) return ""
      return `${property}: ${styleValue}`
    })
    .filter(Boolean)
    .join("; ")
}

export function sanitizePlatformHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html")
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (BLOCKED_TAGS.has(element.tagName)) {
      element.remove()
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === "style") {
        const style = cleanStyle(attribute.value)
        if (style) element.setAttribute("style", style)
        else element.removeAttribute("style")
      }
      if ((name === "href" || name === "src") && !safeResource(attribute.value, name === "src")) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return document.body.innerHTML
}

export function replaceAssetTokens(source: string, urls: ReadonlyMap<string, string>): string {
  let result = source
  for (const [assetId, url] of urls) {
    result = result.split(`wesight-asset://${assetId}`).join(url)
  }
  return result
}

export function platformPlainText(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html")
  for (const lineBreak of Array.from(document.body.querySelectorAll("br"))) {
    lineBreak.replaceWith(document.createTextNode("\n"))
  }
  for (const block of Array.from(document.body.querySelectorAll(
    "p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figure"
  ))) {
    block.append(document.createTextNode("\n"))
  }
  return (document.body.textContent ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function truncateTitle(title: string, limit: number): { title: string; truncated: boolean } {
  const characters = Array.from(title.trim())
  return characters.length <= limit
    ? { title: characters.join(""), truncated: false }
    : { title: characters.slice(0, limit).join(""), truncated: true }
}
