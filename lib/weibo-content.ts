/** Weibo's editor resets paragraph margins, so persist spacing as an empty paragraph. */
export function spaceWeiboParagraphs(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html")
  const isBodyParagraph = (element: Element | null): element is HTMLParagraphElement => !!element
    && element.tagName === "P"
    && !element.closest("li, table, pre, blockquote, figure, figcaption")
    && !element.querySelector("img, video, audio, iframe, figure")
    && !!element.textContent?.replace(/[\s\u200B-\u200D\uFEFF]/g, "")

  for (const paragraph of Array.from(document.body.querySelectorAll("p"))) {
    if (!isBodyParagraph(paragraph) || !isBodyParagraph(paragraph.nextElementSibling)) continue
    const spacer = document.createElement("p")
    spacer.appendChild(document.createElement("br"))
    paragraph.after(spacer)
  }
  return document.body.innerHTML
}
