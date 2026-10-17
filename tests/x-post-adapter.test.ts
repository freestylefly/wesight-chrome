import { webcrypto } from "node:crypto"
import { xPostAdapter } from "~platforms/x-post"
import type { PublishAssetV1, PublishTaskV1 } from "~types/protocol"

const mock = vi.hoisted(() => ({ nativeText: vi.fn(), attach: vi.fn() }))
vi.mock("~lib/x-post-native-text", () => ({ prepareXPostNativeText: mock.nativeText }))
vi.mock("~lib/x-post-native-media", () => ({ attachXPostNativeImages: mock.attach }))
let store: Record<string, unknown>

function task(count = 2): PublishTaskV1 {
  return {
    protocolVersion: 1, taskId: "x-post-test", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    source: { vaultPath: "动态", contentHash: "a".repeat(64) },
    article: { title: "动态", digest: "", tags: ["测试"], coverAssetId: null, markdown: "正文内容\n第二段", html: "<p>正文内容</p>" },
    targetOptions: { xPost: { includeTitle: false } },
    assets: Array.from({ length: count }, (_, i) => ({ id: `image-${i + 1}`, fileName: `${i + 1}.png`, mimeType: "image/png", size: 8, sha256: "a".repeat(64) })),
    targets: ["x-post"], behavior: { finalAction: "manual", groupTabs: true }
  }
}
function context(count = 2) {
  return { task: task(count), getAssetData: vi.fn(async (_asset: PublishAssetV1) => "data:image/png;base64,iVBORw0KGgo="), reportProgress: vi.fn(),
    pageBridge: { fillEditor: vi.fn(), uploadAsset: vi.fn(), prepareXPost: vi.fn() },
    uploadProgress: { complete: vi.fn(), skip: vi.fn(), fail: vi.fn() } }
}
const readyUrl = "https://x.com/compose/post?wesight_x_post_task=x-post-test"

beforeEach(() => {
  store = {}
  mock.nativeText.mockReset().mockResolvedValue({ draftUrl: readyUrl, warnings: ["文案已载入 X Post 编辑窗口，请确认后手动发布"] })
  mock.attach.mockReset().mockResolvedValue({ draftUrl: readyUrl, uploading: false, reused: false })
  vi.stubGlobal("crypto", webcrypto)
  document.body.innerHTML = '<div data-testid="SideNav_AccountSwitcher_Button"><span>@test_user</span></div>'
  vi.stubGlobal("chrome", { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(store[key]) })),
    set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(store, structuredClone(value)) })
  } } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("X native Post adapter", () => {
  test("text-only posts open X's native text URL and never touch the image uploader", async () => {
    const input = context(0)
    mock.nativeText.mockResolvedValueOnce({ draftUrl: "https://x.com/compose/post?text=fixture", editorPending: true, warnings: [] })
    expect((await xPostAdapter.prepareDraft(input)).editorPending).toBe(true)
    expect(mock.nativeText).toHaveBeenCalledWith(expect.objectContaining({ taskId: "x-post-test", account: "test_user", text: "正文内容\n第二段", requested: false }))
    expect((store.wesight_x_post_checkpoints_v1 as any)["x-post-test"].nativeUrlRequested).toBe(true)
    const result = await xPostAdapter.retry(input)
    expect(mock.nativeText).toHaveBeenLastCalledWith(expect.objectContaining({ requested: true }))
    expect(result.draftUrl).toBe(readyUrl)
    expect(mock.attach).not.toHaveBeenCalled(); expect(input.pageBridge.prepareXPost).not.toHaveBeenCalled()
  })

  test("text with images waits for X's text prefill, then hands the image files to X's Post uploader", async () => {
    const input = context(2)
    mock.nativeText.mockResolvedValueOnce({ draftUrl: "https://x.com/compose/post?text=fixture", editorPending: true, warnings: [] })
    expect((await xPostAdapter.prepareDraft(input)).editorPending).toBe(true)
    expect(mock.attach).not.toHaveBeenCalled()
    const result = await xPostAdapter.retry(input)
    expect(mock.attach).toHaveBeenCalledTimes(1)
    const call = mock.attach.mock.calls[0]![0]
    expect(call).toMatchObject({ taskId: "x-post-test", requireEmptyText: false })
    expect(call.files.map((file: File) => [file.name, file.type])).toEqual([["1.png", "image/png"], ["2.png", "image/png"]])
    expect(input.uploadProgress.complete).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ draftUrl: readyUrl, warnings: ["文案和图片已载入 X Post 编辑窗口，请确认后手动发布"] })
    expect(input.pageBridge.prepareXPost).not.toHaveBeenCalled()
    expect(JSON.stringify(store)).not.toContain("正文内容")
  })

  test("image-only posts skip the text URL and require an empty X editor", async () => {
    const input = context(1)
    input.task.article.markdown = ""; input.task.article.tags = []
    await xPostAdapter.prepareDraft(input)
    expect(mock.nativeText).not.toHaveBeenCalled()
    expect(mock.attach).toHaveBeenCalledWith(expect.objectContaining({ requireEmptyText: true }))
  })

  test("reports a still-running X upload and preserved edits without failing", async () => {
    mock.attach.mockResolvedValueOnce({ draftUrl: readyUrl, uploading: true, reused: false })
    expect((await xPostAdapter.prepareDraft(context(1))).warnings.at(-1)).toContain("仍在 X 中上传")
    mock.attach.mockResolvedValueOnce({ draftUrl: readyUrl, uploading: false, reused: true })
    expect((await xPostAdapter.retry(context(1))).warnings.at(-1)).toContain("保留")
  })

  test("recovers old uncertain draft checkpoints without any API mutation", async () => {
    store.wesight_x_post_checkpoints_v1 = { "x-post-test": { account: "test_user", contentKey: "", updatedAt: 1, images: { "image-1": { id: "1", expiresAt: 0 } }, skippedImages: [], creationPending: true, composerMode: "native" } }
    const input = context(1)
    const { sha256 } = await import("~lib/crypto")
    const text = "正文内容\n第二段"
    ;(store.wesight_x_post_checkpoints_v1 as any)["x-post-test"].contentKey = await sha256(JSON.stringify({ text, assets: input.task.assets.map(asset => [asset.id, asset.sha256]) }))
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy)
    await xPostAdapter.prepareDraft(input)
    expect(mock.attach).toHaveBeenCalledTimes(1); expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("includes only real user titles", async () => {
    const input = context(0)
    input.task.article.title = "标题"
    input.task.targetOptions = { xPost: { includeTitle: true } }
    await xPostAdapter.prepareDraft(input)
    expect(mock.nativeText).toHaveBeenCalledWith(expect.objectContaining({ text: "标题\n\n正文内容\n第二段" }))
  })

  test("tells the user to switch tabs when X waits in the background", async () => {
    const input = context(0)
    mock.nativeText.mockImplementationOnce(async (value: { onHidden?: () => void }) => { value.onHidden?.(); return { draftUrl: readyUrl, warnings: [] } })
    await xPostAdapter.prepareDraft(input)
    expect(input.reportProgress).toHaveBeenCalledWith("X 标签页在后台，切换到 X 标签页后自动继续")
  })

  test("rejects excessive X-weighted text without silently truncating", async () => {
    const input = context(0)
    input.task.article.markdown = "中".repeat(141)
    await expect(xPostAdapter.prepareDraft(input)).rejects.toThrow("请为 X 单独精简文案")
    expect(mock.nativeText).not.toHaveBeenCalled()
    expect(input.task.article.markdown).toHaveLength(141)
  })

  test("blocks more than four supported images, video and oversized images before opening X", async () => {
    await expect(xPostAdapter.prepareDraft(context(5))).rejects.toThrow("4 张")
    const input = context(1)
    input.task.assets[0]!.mimeType = "video/mp4"; input.task.media = { videoAssetId: "image-1" }
    await expect(xPostAdapter.prepareDraft(input)).rejects.toThrow("暂不支持同步视频")
    const large = context(1)
    large.task.assets[0]!.size = 5 * 1024 * 1024 + 1
    await expect(xPostAdapter.prepareDraft(large)).rejects.toThrow("5 MB")
    expect(mock.nativeText).not.toHaveBeenCalled(); expect(mock.attach).not.toHaveBeenCalled()
  })

  test("skips known GIFs before the four-image limit and preserves all text", async () => {
    const input = context(5)
    Object.assign(input.task.assets[0]!, { mimeType: "image/gif", fileName: "animation.gif" })
    const result = await xPostAdapter.prepareDraft(input)
    expect(mock.attach.mock.calls[0]![0].files).toHaveLength(4)
    expect(input.getAssetData.mock.calls.map(([asset]) => asset.id)).not.toContain("image-1")
    expect(input.uploadProgress.skip).toHaveBeenCalledWith(input.task.assets[0])
    expect(result.warnings[0]).toContain("已跳过 1 张")
  })

  test("deduplicates concurrent requests", async () => {
    const input = context()
    await Promise.all([xPostAdapter.prepareDraft(input), xPostAdapter.prepareDraft(input)])
    expect(mock.attach).toHaveBeenCalledTimes(1)
  })

  test("binds checkpoints to the original account and content", async () => {
    const input = context()
    await xPostAdapter.prepareDraft(input)
    document.querySelector("span")!.textContent = "@another_account"
    await expect(xPostAdapter.retry(input)).rejects.toThrow("账号不同")
    document.querySelector("span")!.textContent = "@test_user"
    input.task.article.markdown = "修改后的内容"
    await expect(xPostAdapter.retry(input)).rejects.toThrow("内容已改变")
    expect(mock.attach).toHaveBeenCalledTimes(1)
  })

  test("stops if the account changes while image files are being read", async () => {
    const input = context(1)
    input.getAssetData.mockImplementationOnce(async () => {
      document.querySelector("span")!.textContent = "@switched_account"
      return "data:image/png;base64,iVBORw0KGgo="
    })
    await expect(xPostAdapter.prepareDraft(input)).rejects.toThrow("当前账号已改变")
    expect(mock.attach).not.toHaveBeenCalled()
  })
})
