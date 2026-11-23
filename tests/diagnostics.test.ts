import { afterEach, describe, expect, it } from "vitest"

import {
  buildEvent,
  maskName,
  normalizeIncomingEvent,
  probeCode,
  redactText,
  sanitizeData,
  sanitizeUrl,
  selfCheckRow,
  setSensitiveTerms
} from "~lib/diagnostics"

afterEach(() => setSensitiveTerms([]))

describe("diagnostics redaction", () => {
  it("keeps only host and path of URLs", () => {
    expect(sanitizeUrl("https://mp.toutiao.com/profile_v4/graphic/publish?token=abc&pgc_id=1#x")).toBe("mp.toutiao.com/profile_v4/graphic/publish")
    expect(sanitizeUrl("https://www.zhihu.com/people/1234567890/posts")).toBe("www.zhihu.com/people/:id/posts")
    expect(sanitizeUrl("data:image/png;base64,AAAA")).toBe("data:[omitted]")
  })

  it("strips URLs, tokens and cookies inside free text", () => {
    const text = redactText("跳转到 https://passport.csdn.net/login?code=secret123&from=x 失败 Bearer abc.def token=xyz")
    expect(text).toContain("passport.csdn.net/login")
    expect(text).not.toContain("secret123")
    expect(text).not.toContain("abc.def")
    expect(text).not.toContain("xyz")
  })

  it("removes article titles, tags and file names of the running task", () => {
    setSensitiveTerms(["我的秘密标题", "私人标签", "family-photo.png"])
    const text = redactText("图片“family-photo.png”上传失败，标题“我的秘密标题”过长，标签 私人标签")
    expect(text).not.toContain("我的秘密标题")
    expect(text).not.toContain("私人标签")
    expect(text).not.toContain("family-photo")
    expect(redactText("截图 holiday shot.jpeg 未上传")).toContain("[文件].jpeg")
  })

  it("drops secret-looking keys and masks names", () => {
    expect(sanitizeData({ cookie: "a=b", accessToken: "x", status: 200, pageUrl: "https://a.com/p?q=1" }))
      .toEqual({ status: 200, pageUrl: "a.com/p" })
    expect(maskName("张三丰")).toBe("张*")
    expect(maskName(undefined)).toBe("")
  })

  it("keeps result codes readable", () => {
    expect(probeCode({ code: -101, data: {} })).toBe("code=-101")
    expect(probeCode({ err_no: 0 })).toBe("err_no=0")
    expect(redactText("code=-101 / err_no=403")).toBe("code=-101 / err_no=403")
  })

  it("re-validates events from other contexts", () => {
    const event = normalizeIncomingEvent({ level: "nope", category: "draft", scope: "zhihu", message: "x https://a.com/b?t=1", data: { session: "s", n: 1 } })
    expect(event).toMatchObject({ level: "info", category: "draft", scope: "zhihu", message: "x a.com/b", data: { n: 1 } })
    expect(normalizeIncomingEvent("bad")).toBeNull()
  })

  it("builds a self-check row without the account name", () => {
    const row = selfCheckRow("csdn", "CSDN", { state: "logged_in", name: "王小明" }, {
      method: "api",
      steps: [{ url: "g-api.csdn.net/x", status: 200, finalUrl: "g-api.csdn.net/x", kind: "json", code: "code=200", ms: 12 }]
    }, 15)
    expect(row).toMatchObject({ result: "logged_in", method: "api", httpStatus: "200", code: "code=200", nameRead: true, maskedName: "王*" })
    expect(JSON.stringify(row)).not.toContain("王小明")
    expect(buildEvent("info", "login", "csdn", "ok").data).toBeUndefined()
  })
})
