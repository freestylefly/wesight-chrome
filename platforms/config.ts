import type { PlatformId } from "~types/protocol"

export const PLATFORM_CONFIG: Record<PlatformId, {
  label: string
  shortLabel: string
  editorUrl: string
  titleLimit: number
}> = {
  zhihu: {
    label: "知乎专栏",
    shortLabel: "知乎",
    editorUrl: "https://zhuanlan.zhihu.com/write",
    titleLimit: 100
  },
  csdn: {
    label: "CSDN 博客",
    shortLabel: "CSDN",
    editorUrl: "https://mp.csdn.net/mp_blog/creation/editor",
    titleLimit: 100
  },
  juejin: {
    label: "掘金文章",
    shortLabel: "掘金",
    editorUrl: "https://juejin.cn/editor/drafts/new?v=2",
    titleLimit: 80
  },
  "bilibili-article": {
    label: "B站专栏",
    shortLabel: "B站",
    editorUrl: "https://member.bilibili.com/york/read-editor",
    titleLimit: 40
  }
}

export function platformFromUrl(url: string): PlatformId | null {
  const host = new URL(url).hostname
  if (host === "www.zhihu.com" || host === "zhuanlan.zhihu.com") return "zhihu"
  if (host === "www.csdn.net" || host === "editor.csdn.net" || host === "mp.csdn.net" || host === "passport.csdn.net") return "csdn"
  if (host === "juejin.cn" || host === "passport.juejin.cn") return "juejin"
  if (host === "member.bilibili.com" || host === "passport.bilibili.com") return "bilibili-article"
  return null
}
