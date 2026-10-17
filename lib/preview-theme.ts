import { sanitizePlatformHtml } from "~lib/content"

// Reuses the structure decorators from Obsidian's templateThemeRenderer.
// Decorations stay in the preview and never enter a platform draft.
export function cangheGreenPreview(html: string): string {
  const root = document.createElement("section")
  root.className = "wesight-wechat-template-canghe-style-tes"
  root.innerHTML = sanitizePlatformHtml(html)
  for (const heading of Array.from(root.querySelectorAll("h2"))) {
    const tail = document.createElement("span")
    tail.className = "wesight-wechat-h2-tail"
    tail.setAttribute("aria-hidden", "true")
    heading.appendChild(tail)
  }
  for (const table of Array.from(root.querySelectorAll("table"))) {
    const wrapper = document.createElement("section")
    wrapper.className = "wesight-wechat-table-wrap"
    table.replaceWith(wrapper)
    wrapper.appendChild(table)
  }
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    const code = pre.querySelector("code")
    const lines = (code?.innerHTML ?? pre.innerHTML).replace(/\n$/, "").split("\n")
    pre.replaceChildren()
    for (const line of lines) {
      const item = document.createElement("code")
      item.innerHTML = line || "<br>"
      pre.appendChild(item)
    }
    const wrapper = document.createElement("section")
    wrapper.className = "wesight-wechat-code-section"
    pre.replaceWith(wrapper)
    wrapper.appendChild(pre)
    const header = document.createElement("section")
    header.className = "wesight-wechat-code-header"
    header.setAttribute("aria-hidden", "true")
    for (let index = 0; index < 3; index += 1) {
      const dot = document.createElement("span")
      dot.className = "wesight-wechat-code-dot"
      dot.textContent = "●"
      header.appendChild(dot)
    }
    pre.prepend(header)
  }
  return root.outerHTML
}
