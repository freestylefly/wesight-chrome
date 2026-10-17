import { readAccountPage } from "~lib/account-page"

const jikeNavigation = (profile = "/u/550e8400-e29b-41d4-a716-446655440000") => `<div class="mantine-Stack-root">
  <a href="/following"><div title="动态"><svg></svg></div></a>
  <a href="/explore"><div title="发现"><svg></svg></div></a>
  <a href="/notification"><div title="通知"><svg></svg></div></a>
  <a href="${profile}"><div title="个人主页"><svg></svg></div></a>
  <a href="/more"><div title="更多"><svg></svg></div></a>
</div>`

// Current creator homepage/publisher markup, with a synthetic identity.
const xhsHeader = () => `<div id="header-area"><div class="d-topbar"><div class="d-topbar-title"><div class="name">创作服务平台</div></div><div class="d-topbar-default"><div class="cursor-pointer flex-center user-info"><img class="user_avatar" src="https://example.com/self.jpg"><span class="name-box">小红书本人</span><img class="arrow" src="https://example.com/arrow.svg"><div class="menu-list" style="display:none"><span>退出登录</span></div></div></div></div></div>`

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 30, height: 30 }] as unknown as DOMRectList)
})
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("read-only account identity from existing pages", () => {
  test("recognizes the current CSDN toolbar and ignores its lazy placeholder nickname", () => {
    vi.stubGlobal("location", new URL("https://mp.csdn.net/mp_blog/creation/editor"))
    document.body.innerHTML = '<div class="toolbar-btn-login"><a class="hasAvatar" href="https://blog.csdn.net/creator"><img src="https://profile-avatar.csdnimg.cn/avatar.jpg"></a></div><div id="csdn-toolbar-profile-new"><p class="csdn-profile-nickName">--</p></div>'
    const before = document.body.innerHTML
    expect(readAccountPage("csdn")).toMatchObject({ state: "logged_in", name: "creator" })
    document.querySelector("p")!.textContent = "创作者"
    expect(readAccountPage("csdn")).toMatchObject({ state: "logged_in", name: "创作者" })
    document.querySelector("p")!.textContent = "--"
    expect(document.body.innerHTML).toBe(before)
  })
  test("does not mistake a CSDN article author's link for the signed-in account", () => {
    vi.stubGlobal("location", new URL("https://www.csdn.net/"))
    document.body.innerHTML = '<a href="https://blog.csdn.net/author"><img src="https://example.com/a.jpg">作者</a>'
    expect(readAccountPage("csdn")).toEqual({ state: "unknown" })
  })
  test("recognizes Weibo's current navigation profile without touching the composer", () => {
    vi.stubGlobal("location", new URL("https://weibo.com/"))
    document.body.innerHTML = '<div class="woo-tab-nav"><a href="/u/123456" title="微博用户"><img alt="profile" src="https://example.com/a.jpg"></a></div><textarea>正在编辑的内容</textarea>'
    const before = document.body.innerHTML
    expect(readAccountPage("weibo-article")).toMatchObject({ state: "logged_in", name: "微博用户" })
    expect(document.body.innerHTML).toBe(before)
  })
  test("ignores other users' avatars and hidden login remnants", () => {
    vi.stubGlobal("location", new URL("https://weibo.com/"))
    document.body.innerHTML = '<article><a href="/u/123456"><img alt="profile"></a></article>'
    expect(readAccountPage("weibo-article")).toEqual({ state: "unknown" })
    document.body.innerHTML = '<div class="woo-tab-nav" hidden><a href="/u/123456"><img alt="profile"></a></div>'
    expect(readAccountPage("weibo-article")).toEqual({ state: "unknown" })
  })
  test("handles tab navigation races without reading another site's identity", () => {
    vi.stubGlobal("location", new URL("https://example.com/"))
    document.body.innerHTML = '<div class="woo-tab-nav"><a href="/u/123456"><img alt="profile"></a></div>'
    expect(readAccountPage("weibo-article")).toEqual({ state: "unknown" })
  })
  test("reads the X account switcher without needing an old content script receiver", () => {
    vi.stubGlobal("location", new URL("https://x.com/home"))
    document.body.innerHTML = '<button data-testid="SideNav_AccountSwitcher_Button"><span>账号</span><span>@creator</span></button>'
    expect(readAccountPage("x-article")).toEqual({ state: "logged_in", name: "creator" })
    expect(readAccountPage("x-post")).toEqual({ state: "logged_in", name: "creator" })
    document.body.innerHTML = '<a data-testid="loginButton" href="/i/flow/login">Log in</a>'
    expect(readAccountPage("x-article")).toEqual({ state: "login_required" })
    expect(readAccountPage("x-post")).toEqual({ state: "login_required" })
  })
  test.each(["xiaohongshu", "jike-post"] as const)("keeps an unloaded %s application shell unknown", platformId => {
    vi.stubGlobal("location", new URL(platformId === "xiaohongshu" ? "https://creator.xiaohongshu.com/publish/publish" : "https://web.okjike.com/"))
    document.body.innerHTML = '<main id="app"><div class="skeleton"></div></main>'
    expect(readAccountPage(platformId)).toEqual({ state: "unknown" })
  })
  test("reads a Xiaohongshu account that appears after SPA login without mutating the page", () => {
    vi.stubGlobal("location", new URL("https://creator.xiaohongshu.com/publish/publish"))
    document.body.innerHTML = '<form><p>扫码登录</p><input type="tel"><button>登录</button></form>'
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "login_required" })
    document.body.innerHTML = '<header><div class="user-info"><img src="https://example.com/own.jpg"><span class="user-name">创作者本人</span></div></header>'
    const before = document.body.innerHTML
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "logged_in", name: "创作者本人", avatar: "https://example.com/own.jpg" })
    expect(document.body.innerHTML).toBe(before)
  })
  test("does not confuse a Xiaohongshu note author's identity or hidden account remnants with the current user", () => {
    vi.stubGlobal("location", new URL("https://creator.xiaohongshu.com/new/home"))
    document.body.innerHTML = '<article class="user-info"><img src="https://example.com/author.jpg"><span class="user-name">文章作者</span></article><header style="display:none"><div class="user-info"><img src="https://example.com/own.jpg"><span class="user-name">旧账号</span></div></header>'
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "unknown" })
    document.querySelector("header")!.setAttribute("style", "opacity:0")
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "unknown" })
  })
  test.each(["/new/home", "/publish/publish?target=image"])("reads the current Xiaohongshu header on %s without a semantic header or open editor", route => {
    vi.stubGlobal("location", new URL(`https://creator.xiaohongshu.com${route}`))
    document.body.innerHTML = `${xhsHeader()}<article class="user-info"><img src="https://example.com/other.jpg"><span class="name-box">其他作者</span></article><textarea>保留现有文案</textarea>`
    const before = document.body.innerHTML
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "logged_in", name: "小红书本人", avatar: "https://example.com/self.jpg" })
    expect(document.body.innerHTML).toBe(before)
  })
  test.each(["hidden", 'style="display:none"', 'aria-hidden="true"'])("ignores hidden current Xiaohongshu account chrome (%s)", attribute => {
    vi.stubGlobal("location", new URL("https://creator.xiaohongshu.com/new/home"))
    document.body.innerHTML = `<div ${attribute}>${xhsHeader()}</div>`
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "unknown" })
  })
  test("does not infer creator authentication from the ordinary Xiaohongshu website or a partial header", () => {
    vi.stubGlobal("location", new URL("https://www.xiaohongshu.com/explore"))
    document.body.innerHTML = xhsHeader()
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "unknown" })
    vi.stubGlobal("location", new URL("https://creator.xiaohongshu.com/new/home"))
    document.querySelector(".user_avatar")!.remove()
    document.querySelector(".arrow")!.remove()
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "unknown" })
    document.body.innerHTML = xhsHeader()
    document.querySelector(".name-box")!.textContent = "登录"
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "unknown" })
  })
  test("recognizes the current extension-only Xiaohongshu image uploader without uploading a file", () => {
    vi.stubGlobal("location", new URL("https://creator.xiaohongshu.com/publish/publish?target=image"))
    document.body.innerHTML = '<div class="creator-tab active"><span class="title">上传图文</span></div><input type="file" class="upload-input" multiple accept=".jpg,.jpeg,.png,.webp">'
    const before = document.body.innerHTML
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "logged_in" })
    expect(document.body.innerHTML).toBe(before)
    document.querySelector("input")!.setAttribute("accept", ".pdf,.docx")
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "unknown" })
    document.querySelector("input")!.setAttribute("accept", ".jpg")
    document.querySelector(".creator-tab")!.setAttribute("hidden", "")
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "unknown" })
  })
  test("prioritizes an expired-session form over the current Xiaohongshu header", () => {
    vi.stubGlobal("location", new URL("https://creator.xiaohongshu.com/new/home"))
    document.body.innerHTML = `${xhsHeader()}<form role="dialog"><p>手机号登录</p><input type="tel"></form>`
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "login_required" })
  })
  test("requires an actual Xiaohongshu editing or upload workflow instead of generic page controls", () => {
    vi.stubGlobal("location", new URL("https://creator.xiaohongshu.com/publish/publish"))
    document.body.innerHTML = '<button class="creator-tab">上传图文</button>'
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "unknown" })
    document.body.insertAdjacentHTML("beforeend", '<input type="file" accept="image/*" hidden>')
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "logged_in" })
    document.body.innerHTML = '<input placeholder="填写标题"><div class="ql-editor" contenteditable="true"></div><button>发布</button>'
    expect(readAccountPage("xiaohongshu")).toEqual({ state: "logged_in" })
  })
  test("does not let hidden login remnants mask a current Jike account", () => {
    vi.stubGlobal("location", new URL("https://web.okjike.com/"))
    document.body.innerHTML = '<div class="login" hidden><p>登录即刻</p><input type="tel"></div><nav><div class="user-info"><img src="https://example.com/self.jpg"><span class="user-name">即刻本人</span></div></nav>'
    expect(readAccountPage("jike-post")).toEqual({ state: "logged_in", name: "即刻本人", avatar: "https://example.com/self.jpg" })
  })
  test("distinguishes Jike's own navigation profile from users in the feed and profile page", () => {
    vi.stubGlobal("location", new URL("https://web.okjike.com/u/someone"))
    document.body.innerHTML = '<article><a href="/u/someone"><img src="https://example.com/other.jpg">他人</a></article><div class="user-info"><img src="https://example.com/other.jpg"><span class="user-name">他人主页</span></div>'
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
    document.body.insertAdjacentHTML("beforeend", '<nav><a href="/u/my-id" aria-label="我的主页"><img src="https://example.com/self.jpg"></a></nav>')
    expect(readAccountPage("jike-post")).toEqual({ state: "logged_in", avatar: "https://example.com/self.jpg" })
    document.querySelector("nav a")!.setAttribute("href", "https://other.example/u/my-id")
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
  })
  test("only recognizes Jike's visible composer when its editing and publishing controls are present", () => {
    vi.stubGlobal("location", new URL("https://web.okjike.com/"))
    document.body.innerHTML = '<textarea placeholder="分享新鲜事"></textarea>'
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
    document.body.innerHTML = '<form><textarea placeholder="分享新鲜事"></textarea><button>发布</button></form>'
    expect(readAccountPage("jike-post")).toEqual({ state: "logged_in" })
    document.querySelector("form")!.setAttribute("aria-hidden", "true")
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
  })
  test("recognizes Jike's real icon-only Stack navigation without a profile avatar or an open composer", () => {
    vi.stubGlobal("location", new URL("https://web.okjike.com/"))
    document.body.innerHTML = `${jikeNavigation()}<button>创建动态</button><article><a href="/u/feed-author"><img src="https://example.com/author.jpg">其他作者</a></article><textarea>保留正在写的文案</textarea>`
    const before = document.body.innerHTML
    expect(readAccountPage("jike-post")).toEqual({ state: "logged_in" })
    expect(document.body.innerHTML).toBe(before)
  })
  test.each(["hidden", 'style="display:none"', 'aria-hidden="true"'])("ignores hidden Jike Stack navigation (%s)", attribute => {
    vi.stubGlobal("location", new URL("https://web.okjike.com/"))
    document.body.innerHTML = `<div ${attribute}>${jikeNavigation()}</div>`
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
  })
  test("does not accept Jike's guest controls or a lone profile title as an authenticated navigation", () => {
    vi.stubGlobal("location", new URL("https://web.okjike.com/u/another-user"))
    document.body.innerHTML = '<article><a href="/u/another-user"><div title="个人主页"><img src="https://example.com/author.jpg">他人主页</div></a></article><button>创建动态</button>'
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
    document.body.innerHTML = jikeNavigation().replace('<a href="/notification"><div title="通知"><svg></svg></div></a>', '<a href="/login">登录</a>')
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
  })
  test("rejects an external own-profile or sibling route in Jike navigation", () => {
    vi.stubGlobal("location", new URL("https://web.okjike.com/"))
    document.body.innerHTML = jikeNavigation("https://other.example/u/another-user")
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
    document.body.innerHTML = jikeNavigation().replace('href="/notification"', 'href="https://other.example/notification"')
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
  })
  test("requires a visible Jike dialog and publishing action for its role=textbox composer", () => {
    vi.stubGlobal("location", new URL("https://web.okjike.com/"))
    document.body.innerHTML = '<div contenteditable="true" role="textbox">原有文案</div><button>发布</button>'
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
    document.body.innerHTML = '<div class="mantine-Modal-body" role="dialog"><div contenteditable="true" role="textbox">原有文案</div><button>发布</button></div>'
    const before = document.body.innerHTML
    expect(readAccountPage("jike-post")).toEqual({ state: "logged_in" })
    expect(document.body.innerHTML).toBe(before)
    document.querySelector("button")!.remove()
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
    document.querySelector('[role="dialog"]')!.insertAdjacentHTML("beforeend", '<button>发布</button>')
    document.querySelector('[role="dialog"]')!.setAttribute("hidden", "")
    expect(readAccountPage("jike-post")).toEqual({ state: "unknown" })
  })
  test("gives a visible expired-session login dialog priority over Jike's cached icon navigation", () => {
    vi.stubGlobal("location", new URL("https://web.okjike.com/"))
    document.body.innerHTML = `${jikeNavigation()}<form role="dialog"><p>登录即刻</p><input type="tel"><button>登录</button></form>`
    expect(readAccountPage("jike-post")).toEqual({ state: "login_required" })
  })
  test.each(["xiaohongshu", "jike-post"] as const)("recognizes the explicit %s authentication route", platformId => {
    vi.stubGlobal("location", new URL(platformId === "xiaohongshu" ? "https://creator.xiaohongshu.com/login" : "https://web.okjike.com/login"))
    expect(readAccountPage(platformId)).toEqual({ state: "login_required" })
  })
  test.each(["xiaohongshu", "jike-post"] as const)("requires login when %s displays an expired-session login form over stale account chrome", platformId => {
    vi.stubGlobal("location", new URL(platformId === "xiaohongshu" ? "https://creator.xiaohongshu.com/publish/publish" : "https://web.okjike.com/"))
    document.body.innerHTML = '<header><div class="user-info"><img src="https://example.com/self.jpg"><span class="user-name">缓存账号</span></div></header><form role="dialog"><p>手机号登录</p><input type="tel"><button>登录</button></form>'
    expect(readAccountPage(platformId)).toEqual({ state: "login_required" })
  })
})
