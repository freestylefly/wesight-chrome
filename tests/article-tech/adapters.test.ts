import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { ARTICLE_TECH_ADAPTERS } from "~platforms/adapters/article-tech"
import { FINAL_ACTION_PATTERN, findActionByText } from "~platforms/article-tech/editor"
import { oschinaEditorRoute } from "~platforms/article-tech/oschina"
import type { ArticleTechPlatformId } from "~platforms/article-tech/site"
import { ARTICLE_TECH_PLATFORMS } from "~platforms/catalog/article-tech"
import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"

const fixture = (id: string) => readFileSync(resolve(process.cwd(), "tests", "fixtures", "article-tech", `${id}.html`), "utf8")

const TITLE = "技术社区批次验收文章"

function makeTask(id: ArticleTechPlatformId, title = TITLE): PublishTaskV1 {
  const assets: PublishAssetV1[] = [1, 2].map(index => ({
    id: String(index).repeat(64),
    fileName: index === 1 ? "正文图片-1.png" : "封面.png",
    mimeType: "image/png",
    size: 3,
    sha256: String(index).repeat(64)
  }))
  const createdAt = Date.now()
  return {
    protocolVersion: 1,
    taskId: `article-tech-${id}`,
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + 600_000).toISOString(),
    source: { vaultPath: "验收文章.md", contentHash: "a".repeat(64) },
    article: {
      title,
      digest: "这是一段摘要",
      markdown: ["## 小标题", "", "> 引用", "", "- 列表", "", "```ts", "const ready = true", "```", "", `![示意图](wesight-asset://${"1".repeat(64)})`].join("\n"),
      html: `<h2>小标题</h2><blockquote>引用</blockquote><ul><li>列表</li></ul><pre><code>const ready = true</code></pre><p><img src="wesight-asset://${"1".repeat(64)}"></p>`,
      coverAssetId: "2".repeat(64),
      tags: ["AI", "前端"],
      original: true
    },
    assets,
    targets: [id],
    behavior: { finalAction: "manual", groupTabs: true }
  }
}

class TestDataTransfer {
  files: File[] = []
  private readonly values = new Map<string, string>()
  items = { add: (file: File) => this.files.push(file) }
  setData(type: string, value: string) { this.values.set(type, value) }
  getData(type: string) { return this.values.get(type) ?? "" }
}

class TestClipboardEvent extends Event {
  readonly clipboardData: TestDataTransfer | null
  constructor(type: string, init: EventInit & { clipboardData?: TestDataTransfer } = {}) {
    super(type, init)
    this.clipboardData = init.clipboardData ?? null
  }
}

/** Stands in for the editors' own paste handling: CodeMirror 5/6 insert pasted plain text. */
function wireEditors(): void {
  for (const textarea of Array.from(document.querySelectorAll<HTMLTextAreaElement>(".CodeMirror textarea"))) {
    if (textarea.dataset.wired) continue
    textarea.dataset.wired = "1"
    textarea.addEventListener("paste", event => {
      const text = (event as unknown as TestClipboardEvent).clipboardData?.getData("text/plain") ?? ""
      textarea.closest(".CodeMirror")!.querySelector(".CodeMirror-code")!.textContent = text
      event.preventDefault()
    })
  }
  for (const content of Array.from(document.querySelectorAll<HTMLElement>(".cm-content"))) {
    if (content.dataset.wired) continue
    content.dataset.wired = "1"
    content.addEventListener("paste", event => {
      content.textContent = (event as unknown as TestClipboardEvent).clipboardData?.getData("text/plain") ?? ""
      event.preventDefault()
    })
  }
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    frame.contentDocument?.body.setAttribute("contenteditable", "true")
  }
}

function insertTemplate(templateId: string, target: Element): void {
  const template = document.querySelector<HTMLTemplateElement>(`#${templateId}`)!
  target.appendChild(template.content.cloneNode(true))
  wireEditors()
}

interface Case {
  id: ArticleTechPlatformId
  mode: "markdown" | "rich"
  path?: string
  title: () => string
  body: () => string
  setup?: () => void
  tagsFilled?: boolean
}

const frameBody = (selector: string) => document.querySelector<HTMLIFrameElement>(selector)!.contentDocument!.body

const CASES: Case[] = [
  {
    id: "cnblogs-article", mode: "markdown", tagsFilled: true,
    title: () => document.querySelector<HTMLInputElement>("#post-title")!.value,
    body: () => document.querySelector<HTMLTextAreaElement>("#md-editor")!.value
  },
  {
    id: "51cto-article", mode: "markdown",
    title: () => document.querySelector<HTMLInputElement>("input[placeholder*='标题']")!.value,
    body: () => document.querySelector(".CodeMirror-code")!.textContent ?? ""
  },
  {
    id: "infoq-article", mode: "rich",
    title: () => document.querySelector<HTMLTextAreaElement>("textarea[placeholder*='标题']")!.value,
    body: () => document.querySelector(".ProseMirror")!.innerHTML,
    setup: () => document.querySelector(".new-draft")!.addEventListener("click", () => insertTemplate("infoq-editor", document.body))
  },
  {
    id: "segmentfault-article", mode: "markdown",
    title: () => document.querySelector<HTMLInputElement>("input[placeholder*='标题']")!.value,
    body: () => document.querySelector(".cm-content")!.textContent ?? ""
  },
  {
    id: "aliyun-article", mode: "markdown",
    title: () => document.querySelector<HTMLInputElement>("input[placeholder*='标题']")!.value,
    body: () => document.querySelector(".CodeMirror-code")!.textContent ?? ""
  },
  {
    id: "tencentcloud-article", mode: "rich",
    title: () => document.querySelector<HTMLTextAreaElement>("textarea[placeholder*='标题']")!.value,
    body: () => document.querySelector(".ProseMirror")!.innerHTML
  },
  {
    id: "volcengine-article", mode: "markdown",
    title: () => document.querySelector<HTMLTextAreaElement>("textarea[placeholder*='标题']")!.value,
    body: () => document.querySelector<HTMLTextAreaElement>("textarea[placeholder*='Markdown']")!.value
  },
  {
    id: "oschina-article", mode: "rich", path: "/u/123456/blog/ai-write",
    title: () => document.querySelector<HTMLInputElement>("input[placeholder*='标题']")!.value,
    body: () => frameBody("iframe.cke_wysiwyg_frame").innerHTML
  },
  {
    id: "jianshu-article", mode: "markdown",
    title: () => document.querySelector<HTMLInputElement>(".note-editor input[type='text']")!.value,
    body: () => document.querySelector<HTMLTextAreaElement>("#arthur-editor")!.value,
    setup: () => document.querySelector(".new-note")!.addEventListener("click", () => insertTemplate("jianshu-note", document.querySelector(".note-editor")!))
  },
  {
    id: "sspai-article", mode: "rich",
    title: () => document.querySelector<HTMLTextAreaElement>("textarea[placeholder*='标题']")!.value,
    body: () => document.querySelector(".ck-editor__editable")!.innerHTML
  },
  {
    id: "woshipm-article", mode: "rich", path: "/writing",
    title: () => document.querySelector<HTMLInputElement>("input[name='title']")!.value,
    body: () => frameBody("#ueditor_0").innerHTML
  }
]

function load(testCase: Case): { finalClicks: string[] } {
  history.replaceState(null, "", testCase.path ?? "/")
  document.body.innerHTML = fixture(testCase.id)
  wireEditors()
  testCase.setup?.()
  const finalClicks: string[] = []
  document.addEventListener("click", event => {
    const control = (event.target as Element | null)?.closest("button, a, [role='button']")
    const label = control?.textContent?.trim() ?? ""
    if (FINAL_ACTION_PATTERN.test(label)) finalClicks.push(label)
  }, { capture: true, signal: controller.signal })
  document.addEventListener("submit", () => finalClicks.push("form submit"), { capture: true, signal: controller.signal })
  return { finalClicks }
}

let controller: AbortController

describe("批 1a 技术社区文章 adapters", () => {
  beforeEach(() => {
    controller = new AbortController()
    vi.stubGlobal("DataTransfer", TestDataTransfer)
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent)
  })

  afterEach(() => {
    controller.abort()
    document.body.innerHTML = ""
    history.replaceState(null, "", "/")
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test("every catalog entry has a case and an adapter", () => {
    expect(CASES.map(testCase => testCase.id).sort()).toEqual(ARTICLE_TECH_PLATFORMS.map(entry => entry.id).sort())
    for (const entry of ARTICLE_TECH_PLATFORMS) {
      expect(entry.permission).toBe("optional")
      expect(entry.stage).toBe("beta")
      expect(ARTICLE_TECH_ADAPTERS[entry.id].id).toBe(entry.id)
    }
  })

  describe.each(CASES)("$id", testCase => {
    const adapter = ARTICLE_TECH_ADAPTERS[testCase.id]

    test("fills title and body, leaves image/cover/tag warnings, and never clicks publish", async () => {
      const { finalClicks } = load(testCase)
      const skip = vi.fn()
      const result = await adapter.prepareDraft({
        task: makeTask(testCase.id),
        getAssetData: async () => "data:image/png;base64,AAAA",
        uploadProgress: { complete: vi.fn(), skip, fail: vi.fn() }
      })

      expect(testCase.title()).toBe(TITLE)
      const body = testCase.body()
      expect(body).toContain("小标题")
      expect(body).toContain("【待插入图片：正文图片-1.png】")
      expect(body).not.toContain("wesight-asset://")
      if (testCase.mode === "markdown") expect(body).toContain("## 小标题")
      else expect(body).toContain("<h2>小标题</h2>")

      expect(skip).toHaveBeenCalledTimes(1)
      expect(result.warnings.some(warning => warning.includes("正文图片-1.png") && warning.includes("未自动上传"))).toBe(true)
      expect(result.warnings.some(warning => warning.includes("封面未自动设置") && warning.includes("封面.png"))).toBe(true)
      if (testCase.tagsFilled) expect(result.warnings.some(warning => warning.startsWith("标签已填入"))).toBe(true)
      else expect(result.warnings.some(warning => warning.includes("标签未自动填写") && warning.includes("AI、前端"))).toBe(true)
      expect(result.warnings.some(warning => warning.includes("正文可能没有完整填入"))).toBe(false)
      expect(result.draftUrl).toBe(location.href)
      expect(finalClicks).toEqual([])
    }, 10_000)

    test("reports logged in on the editor page", async () => {
      load(testCase)
      await expect(adapter.detectAccount()).resolves.toEqual({ loggedIn: true })
    })

    test("reports login_required when a login form is showing", async () => {
      load(testCase)
      document.body.insertAdjacentHTML("beforeend", "<form action='/login'><input type='password'></form>")
      const account = await adapter.detectAccount()
      expect(account.loggedIn).toBe(false)
      expect(account.message).toContain("请先登录")
    })
  })

  test("site-specific logged-out redirects are detected", async () => {
    history.replaceState(null, "", "/")
    await expect(ARTICLE_TECH_ADAPTERS["woshipm-article"].detectAccount()).resolves.toMatchObject({ loggedIn: false })
    history.replaceState(null, "", "/sign_in")
    await expect(ARTICLE_TECH_ADAPTERS["jianshu-article"].detectAccount()).resolves.toMatchObject({ loggedIn: false })
    history.replaceState(null, "", "/user/login")
    await expect(ARTICLE_TECH_ADAPTERS["segmentfault-article"].detectAccount()).resolves.toMatchObject({ loggedIn: false })
    history.replaceState(null, "", "/home/login")
    await expect(ARTICLE_TECH_ADAPTERS["oschina-article"].detectAccount()).resolves.toMatchObject({ loggedIn: false })
  })

  test("truncates titles to the platform limit and says so", async () => {
    const testCase = CASES.find(candidate => candidate.id === "woshipm-article")!
    load(testCase)
    const longTitle = "长".repeat(80)
    const result = await ARTICLE_TECH_ADAPTERS["woshipm-article"].prepareDraft({
      task: makeTask("woshipm-article", longTitle),
      getAssetData: async () => "data:image/png;base64,AAAA"
    })
    expect(testCase.title()).toBe("长".repeat(50))
    expect(result.warnings[0]).toContain("50")
  })

  test("throws a readable error when the editor is missing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      document.body.innerHTML = "<input placeholder='请输入标题'><button>发布</button>"
      const pending = ARTICLE_TECH_ADAPTERS["segmentfault-article"].prepareDraft({
        task: makeTask("segmentfault-article"),
        getAssetData: async () => ""
      })
      const assertion = expect(pending).rejects.toThrow("页面结构可能已更新，未找到正文编辑器")
      await vi.advanceTimersByTimeAsync(25_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  test("OSChina derives the blog editor route from the signed-in user's space link", () => {
    history.replaceState(null, "", "/")
    document.body.innerHTML = "<a href='https://my.oschina.net/u/987654'>我的空间</a>"
    expect(oschinaEditorRoute()).toBe("https://my.oschina.net/u/987654/blog/ai-write")
    document.body.innerHTML = ""
    expect(oschinaEditorRoute()).toBeNull()
  })

  test("new-draft lookup never returns a final publish control", () => {
    document.body.innerHTML = "<button>发布文章</button><button>写文章并发布</button><a href='#'>写文章</a>"
    expect(findActionByText(["写文章"])?.tagName).toBe("A")
    document.body.innerHTML = "<button>发布文章</button>"
    expect(findActionByText(["文章"])).toBeNull()
  })
})
