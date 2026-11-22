import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { ARTICLE_MEDIA_ADAPTERS } from "~platforms/adapters/article-media"
import { FINAL_ACTION_PATTERN, safeClick, setArticleMediaTimings, type ArticleMediaId } from "~platforms/article-media/kit"
import { weixinEditorUrl, weixinToken } from "~platforms/article-media/weixin"
import { ARTICLE_MEDIA_PLATFORMS } from "~platforms/catalog/article-media"
import { platformFromUrl } from "~platforms/config"
import type { PrepareDraftContext } from "~platforms/types"
import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"

const fixture = (name: string) => readFileSync(resolve(process.cwd(), "tests", "fixtures", "article-media", `${name}.html`), "utf8")

const BODY_TEXT = "这是正文第一段，用于验证自媒体号编辑器填充"

function makeTask(options: { images?: number; cover?: boolean; title?: string; original?: boolean; tags?: string[] } = {}): PublishTaskV1 {
  const assets = Array.from({ length: (options.images ?? 0) + (options.cover ? 1 : 0) }, (_, index): PublishAssetV1 => ({
    id: String(index + 1).repeat(64),
    fileName: `图片-${index + 1}.png`,
    mimeType: "image/png",
    size: 3,
    sha256: String(index + 1).repeat(64)
  }))
  const bodyAssets = assets.slice(0, options.images ?? 0)
  const cover = options.cover ? assets[assets.length - 1]! : null
  const createdAt = Date.now()
  return {
    protocolVersion: 1,
    taskId: "article-media-fixture",
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + 600_000).toISOString(),
    source: { vaultPath: "自媒体验收.md", contentHash: "a".repeat(64) },
    article: {
      title: options.title ?? "自媒体号文章标题",
      digest: "这是一段摘要",
      markdown: [`${BODY_TEXT}`, "", "## 小标题", ...bodyAssets.map(asset => `![图](wesight-asset://${asset.id})`)].join("\n"),
      html: `<p>${BODY_TEXT}</p><h2>小标题</h2>${bodyAssets.map(asset => `<img src="wesight-asset://${asset.id}">`).join("")}`,
      coverAssetId: cover?.id ?? null,
      tags: options.tags ?? ["AI"],
      original: options.original ?? true
    },
    assets,
    targets: ARTICLE_MEDIA_PLATFORMS.map(entry => entry.id),
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
  constructor(type: string, init: EventInit & { clipboardData?: TestDataTransfer | null } = {}) {
    super(type, init)
    this.clipboardData = init.clipboardData ?? null
  }
}

function makeContext(task: PublishTaskV1, extra: Partial<PrepareDraftContext> = {}): PrepareDraftContext {
  return { task, getAssetData: async () => "data:image/png;base64,AQID", ...extra }
}

/** Spies on every control that would publish; none may ever be clicked. */
function guardFinalActions(): ReturnType<typeof vi.fn> {
  const clicked = vi.fn()
  for (const button of Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']"))) {
    if (FINAL_ACTION_PATTERN.test(button.textContent ?? "")) button.addEventListener("click", () => clicked(button.textContent))
  }
  return clicked
}

function allowFileAssignment(input: HTMLInputElement): void {
  Object.defineProperty(input, "files", { configurable: true, writable: true, value: null })
}

function titleValue(): string {
  const control = document.querySelector<HTMLInputElement | HTMLTextAreaElement>("textarea[placeholder*='标题'], input[placeholder*='标题']")
  return control?.value ?? ""
}

function bodyHtml(): string {
  const frame = document.querySelector<HTMLIFrameElement>("iframe[id^='ueditor_']")
  if (frame) return frame.contentDocument?.body.innerHTML ?? ""
  const editor = document.querySelector<HTMLElement>("[contenteditable='true']:not([placeholder*='标题'])")
  return editor?.innerHTML ?? ""
}

function setPath(path: string): void {
  window.history.replaceState({}, "", path)
}

interface Case {
  id: ArticleMediaId
  fixture: string
  path?: string
  /** A signed-out page marker for the login_required path. */
  login: string
  loginPath?: string
  digestFilled?: boolean
  tagsTried?: boolean
}

const CASES: Case[] = [
  { id: "qq-article", fixture: "qq", login: "<button>扫码登录</button>", digestFilled: true, tagsTried: true },
  { id: "baijiahao-article", fixture: "baijiahao", login: "<a>登录百家号</a>" },
  { id: "netease-article", fixture: "netease", login: "<iframe src='https://dl.reg.163.com/webzj/index.html'></iframe>" },
  { id: "sohu-article", fixture: "sohu", login: "<button>账号登录</button>", digestFilled: true },
  { id: "douyin-article", fixture: "douyin", login: "<span role='tab'>验证码登录</span>", tagsTried: true },
  { id: "zsxq-article", fixture: "zsxq", login: "<button>微信扫码登录</button>" },
  { id: "smzdm-article", fixture: "smzdm", login: "<input type='password'>", tagsTried: true },
  { id: "xueqiu-article", fixture: "xueqiu", login: "<a>立即登录</a>" },
  { id: "eastmoney-article", fixture: "eastmoney", login: "<button>扫码登录</button>", digestFilled: true },
  { id: "tonghuashun-article", fixture: "tonghuashun", login: "<button>密码登录</button>" },
  { id: "yidian-article", fixture: "yidian", login: "<div></div>", loginPath: "/#/login", tagsTried: true },
  { id: "dayu-article", fixture: "dayu", login: "<button>去登录</button>" },
  { id: "topnews-article", fixture: "topnews", login: "<div></div>", loginPath: "/#/login" },
  { id: "kuaichuan-article", fixture: "kuaichuan", login: "<a>登录/注册</a>" },
  { id: "autohome-article", fixture: "autohome", login: "<input type='password'>" },
  { id: "dongchedi-article", fixture: "dongchedi", login: "<span role='tab'>扫码登录</span>" }
]

describe("article-media adapters", () => {
  beforeEach(() => {
    vi.stubGlobal("DataTransfer", TestDataTransfer)
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent)
    setArticleMediaTimings({ image: 200, paste: 50 })
    setPath("/")
  })

  afterEach(() => {
    document.body.innerHTML = ""
    setArticleMediaTimings(null)
    setPath("/")
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test("every catalog entry has an adapter bound to its id and routes back to itself", () => {
    for (const entry of ARTICLE_MEDIA_PLATFORMS) {
      expect(ARTICLE_MEDIA_ADAPTERS[entry.id].id).toBe(entry.id)
      expect(platformFromUrl(entry.editorUrl)).toBe(entry.id)
      expect(entry.permission).toBe("optional")
      expect(entry.stage).toBe("beta")
    }
  })

  describe.each(CASES)("$id", testCase => {
    const adapter = ARTICLE_MEDIA_ADAPTERS[testCase.id]

    test("fills title and body, warns for skipped parts, and never clicks publish", async () => {
      document.body.innerHTML = fixture(testCase.fixture)
      if (testCase.path) setPath(testCase.path)
      const clicked = guardFinalActions()
      expect(await adapter.detectAccount()).toEqual({ loggedIn: true })

      const result = await adapter.prepareDraft(makeContext(makeTask()))

      expect(titleValue()).toBe("自媒体号文章标题")
      expect(bodyHtml()).toContain(BODY_TEXT)
      expect(bodyHtml()).toContain("<h2>小标题</h2>")
      expect(result.editorPending).toBeUndefined()
      const warnings = result.warnings.join(" ")
      expect(warnings).toContain("原创声明")
      if (testCase.digestFilled) {
        expect(document.querySelector<HTMLTextAreaElement>("textarea[placeholder*='摘要']")?.value).toBe("这是一段摘要")
        expect(warnings).not.toContain("摘要请")
      } else {
        expect(warnings).toContain("摘要请")
      }
      expect(warnings).toContain(testCase.tagsTried ? "已尝试填写标签" : "标签（AI）请")
      expect(clicked).not.toHaveBeenCalled()
    })

    test("reports login_required on a signed-out page", async () => {
      document.body.innerHTML = testCase.login
      if (testCase.loginPath) setPath(testCase.loginPath)
      const account = await adapter.detectAccount()
      expect(account.loggedIn).toBe(false)
      expect(account.message).toMatch(/登录/)
    })
  })

  test("truncates long titles to the platform limit", async () => {
    document.body.innerHTML = fixture("douyin")
    const result = await ARTICLE_MEDIA_ADAPTERS["douyin-article"].prepareDraft(makeContext(makeTask({ title: "长".repeat(40) })))
    expect(titleValue()).toHaveLength(30)
    expect(result.warnings[0]).toContain("已按 30 个字符填充")
  })

  test("uploads body images through the editor toolbar and selects the cover input", async () => {
    document.body.innerHTML = fixture("qq")
    const toolbar = document.querySelector<HTMLElement>("[role='toolbar']")!
    toolbar.querySelector("button")!.addEventListener("click", () => {
      if (toolbar.querySelector("input")) return
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "image/*"
      allowFileAssignment(input)
      input.addEventListener("change", () => {
        const image = document.createElement("img")
        image.src = `https://inews.gtimg.com/om-fixture-${toolbar.querySelectorAll("img").length}.png`
        toolbar.appendChild(image)
      })
      toolbar.appendChild(input)
    })
    const coverInput = document.querySelector<HTMLInputElement>(".article-cover input")!
    allowFileAssignment(coverInput)
    const coverChange = vi.fn()
    coverInput.addEventListener("change", coverChange)
    const clicked = guardFinalActions()
    const complete = vi.fn()
    const skip = vi.fn()

    const result = await ARTICLE_MEDIA_ADAPTERS["qq-article"].prepareDraft(makeContext(makeTask({ images: 2, cover: true }), {
      uploadProgress: { complete, skip, fail: vi.fn() }
    }))

    const body = bodyHtml()
    expect(body).toContain("https://inews.gtimg.com/om-fixture-0.png")
    expect(body).toContain("https://inews.gtimg.com/om-fixture-1.png")
    expect(body).not.toContain("wesight-asset://")
    expect(body).not.toContain("data:image")
    expect(complete).toHaveBeenCalledTimes(2)
    expect(skip).not.toHaveBeenCalled()
    expect(coverChange).toHaveBeenCalledOnce()
    expect((coverInput.files as unknown as File[])[0]?.name).toBe("图片-3.png")
    expect(result.warnings.join(" ")).toContain("已选择封面")
    expect(clicked).not.toHaveBeenCalled()
  })

  test("leaves a placeholder and a warning when the editor cannot upload an image", async () => {
    document.body.innerHTML = fixture("netease")
    const complete = vi.fn()
    const skip = vi.fn()
    const result = await ARTICLE_MEDIA_ADAPTERS["netease-article"].prepareDraft(makeContext(makeTask({ images: 1, cover: true }), {
      uploadProgress: { complete, skip, fail: vi.fn() }
    }))
    const body = bodyHtml()
    expect(body).toContain("［图片：图片-1.png，请在此处手动插入］")
    expect(body).not.toContain("wesight-asset://")
    expect(body).not.toContain("data:image")
    expect(skip).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
    const warnings = result.warnings.join(" ")
    expect(warnings).toContain("1 张正文图片未能通过网易号编辑器上传")
    expect(warnings).toContain("封面“图片-2.png”请在网易号编辑页手动上传")
  })

  test("routes the body through the editor's own paste handler and replaces existing content", async () => {
    document.body.innerHTML = fixture("autohome")
    const editor = document.querySelector<HTMLElement>(".ProseMirror")!
    editor.innerHTML = "<p>旧内容</p>"
    const pasted = vi.fn()
    editor.addEventListener("paste", event => {
      const data = (event as unknown as TestClipboardEvent).clipboardData
      const html = data?.getData("text/html") ?? ""
      if (!html) return
      event.preventDefault()
      pasted(html)
      const selection = window.getSelection()
      const replacing = selection?.rangeCount ? selection.getRangeAt(0).toString() === editor.textContent : false
      editor.innerHTML = replacing ? `<div data-pasted="1">${html}</div>` : `${editor.innerHTML}${html}`
    })
    await ARTICLE_MEDIA_ADAPTERS["autohome-article"].prepareDraft(makeContext(makeTask()))
    expect(pasted).toHaveBeenCalledOnce()
    expect(editor.querySelector("[data-pasted='1']")?.innerHTML).toContain(BODY_TEXT)
    expect(editor.innerHTML).not.toContain("旧内容")
  })

  test("does not mention 原创 when the article is not original", async () => {
    document.body.innerHTML = fixture("sohu")
    const result = await ARTICLE_MEDIA_ADAPTERS["sohu-article"].prepareDraft(makeContext(makeTask({ original: false, tags: [] })))
    const warnings = result.warnings.join(" ")
    expect(warnings).not.toContain("原创声明")
    expect(warnings).not.toContain("标签")
  })

  test("fills a UEditor iframe body (百家号)", async () => {
    document.body.innerHTML = fixture("baijiahao")
    const frameBody = document.querySelector<HTMLIFrameElement>("#ueditor_0")!.contentDocument!.body
    frameBody.setAttribute("contenteditable", "true")
    frameBody.innerHTML = "<p>请输入正文</p>"
    const clicked = guardFinalActions()
    await ARTICLE_MEDIA_ADAPTERS["baijiahao-article"].prepareDraft(makeContext(makeTask()))
    expect(frameBody.innerHTML).toContain(BODY_TEXT)
    expect(frameBody.innerHTML).not.toContain("请输入正文")
    expect(clicked).not.toHaveBeenCalled()
  })

  test("explains the manual entry step when the 知识星球 editor is not open", async () => {
    document.body.innerHTML = "<main><button>发表</button></main>"
    const zsxq = await import("~platforms/article-media/sites")
    const adapter = zsxq.zsxqArticleAdapter
    vi.useFakeTimers()
    try {
      const pending = adapter.prepareDraft(makeContext(makeTask()))
      const assertion = expect(pending).rejects.toThrow("写文章")
      await vi.advanceTimersByTimeAsync(61_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  test("safeClick refuses final publish controls", () => {
    document.body.innerHTML = "<button>发布</button><button aria-label='群发'>x</button><button>图片</button>"
    const [publish, broadcast, image] = Array.from(document.querySelectorAll("button"))
    const clicked = vi.fn()
    for (const button of [publish, broadcast, image]) button!.addEventListener("click", () => clicked(button!.textContent))
    expect(safeClick(publish!)).toBe(false)
    expect(safeClick(broadcast!)).toBe(false)
    expect(safeClick(image!)).toBe(true)
    expect(clicked).toHaveBeenCalledOnce()
    expect(clicked).toHaveBeenCalledWith("图片")
  })
})

describe("weixin-article", () => {
  const adapter = ARTICLE_MEDIA_ADAPTERS["weixin-article"]

  beforeEach(() => {
    vi.stubGlobal("DataTransfer", TestDataTransfer)
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent)
    setArticleMediaTimings({ image: 200, paste: 50 })
  })

  afterEach(() => {
    document.body.innerHTML = ""
    setArticleMediaTimings(null)
    setPath("/")
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test("reports login_required on the QR login home page", async () => {
    setPath("/")
    document.body.innerHTML = "<div class='login__type__container'><a>使用账号登录</a></div>"
    expect(await adapter.detectAccount()).toEqual({ loggedIn: false, message: "请先扫码登录微信公众平台" })
  })

  test("reads the token on the signed-in home page and opens the article editor without filling", async () => {
    setPath("/cgi-bin/home?t=home/index&lang=zh_CN&token=246810")
    document.body.innerHTML = "<a href='/cgi-bin/appmsg?t=media/appmsg_list&token=246810'>内容管理</a><button>新的创作</button><button>群发</button>"
    const clicked = guardFinalActions()
    expect(weixinToken()).toBe("246810")
    expect(await adapter.detectAccount()).toEqual({ loggedIn: true })

    const result = await adapter.prepareDraft(makeContext(makeTask()))

    expect(result.editorPending).toBe(true)
    expect(result.draftUrl).toBe(weixinEditorUrl("246810"))
    const url = new URL(result.draftUrl)
    expect(url.origin).toBe("https://mp.weixin.qq.com")
    expect(url.searchParams.get("t")).toBe("media/appmsg_edit_v2")
    expect(url.searchParams.get("token")).toBe("246810")
    expect(platformFromUrl(result.draftUrl)).toBe("weixin-article")
    expect(clicked).not.toHaveBeenCalled()
  })

  test("falls back to a token found in page links", () => {
    setPath("/")
    document.body.innerHTML = "<a href='https://mp.weixin.qq.com/cgi-bin/home?t=home/index&token=13579'>首页</a>"
    expect(weixinToken()).toBe("13579")
  })

  test("fills the editor page, keeps images as placeholders when paste upload is not confirmed, and never clicks 发表/群发", async () => {
    setPath("/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=246810&lang=zh_CN")
    document.body.innerHTML = fixture("weixin")
    const clicked = guardFinalActions()
    const skip = vi.fn()

    const result = await adapter.prepareDraft(makeContext(makeTask({ images: 1, cover: true }), {
      uploadProgress: { complete: vi.fn(), skip, fail: vi.fn() }
    }))

    expect(result.editorPending).toBeUndefined()
    expect(document.querySelector<HTMLTextAreaElement>("#title")?.value).toBe("自媒体号文章标题")
    expect(document.querySelector<HTMLInputElement>("#author")?.value).toBe("")
    const body = document.querySelector<HTMLElement>(".ProseMirror")!.innerHTML
    expect(body).toContain(BODY_TEXT)
    expect(body).toContain("［图片：图片-1.png")
    expect(document.querySelector<HTMLTextAreaElement>("#js_description")?.value).toBe("这是一段摘要")
    expect(skip).toHaveBeenCalledOnce()
    const warnings = result.warnings.join(" ")
    expect(warnings).toContain("封面“图片-2.png”请在公众号编辑页手动上传")
    expect(warnings).toContain("原创声明")
    expect(warnings).toContain("保存为草稿")
    expect(clicked).not.toHaveBeenCalled()
  })

  test("uses the platform image URL when the editor uploads a pasted image", async () => {
    setPath("/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=246810&lang=zh_CN")
    document.body.innerHTML = fixture("weixin")
    const editor = document.querySelector<HTMLElement>(".ProseMirror")!
    editor.addEventListener("paste", event => {
      const data = (event as unknown as TestClipboardEvent).clipboardData
      if (!data?.files.length) return
      const image = document.createElement("img")
      image.src = "https://mmbiz.qpic.cn/fixture/0?wx_fmt=png"
      editor.appendChild(image)
    })
    const complete = vi.fn()
    await adapter.prepareDraft(makeContext(makeTask({ images: 1 }), { uploadProgress: { complete, skip: vi.fn(), fail: vi.fn() } }))
    expect(editor.innerHTML).toContain("https://mmbiz.qpic.cn/fixture/0?wx_fmt=png")
    expect(editor.innerHTML).not.toContain("［图片：")
    expect(complete).toHaveBeenCalledOnce()
  })
})
