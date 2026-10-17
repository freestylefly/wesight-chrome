import { runXPostComposerInPage, type XPostComposerInput } from "~lib/x-post-composer"

function input(): XPostComposerInput {
  return { taskId: "native-compose-1", account: "fixture_user", text: "准备同步的图文\n第二段", draftId: "1234567890", images: [
    { uploadId: "101", fileName: "one.png", mimeType: "image/png" },
    { uploadId: "102", fileName: "two.webp", mimeType: "image/webp" }
  ] }
}

function setup(options: { existing?: string; newClient?: boolean; mediaFailure?: boolean } = {}) {
  history.replaceState(null, "", "/compose/post")
  document.body.innerHTML = '<div id="react-root"><div data-testid="SideNav_AccountSwitcher_Button"><span>@fixture_user</span></div><div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true" role="textbox"></div><div data-testid="attachments"></div><button id="publish">Post</button></div></div>'
  if (options.newClient) {
    const script = document.createElement("script")
    script.src = "https://abs.twimg.com/x-web/x-web/entry-client-logged-in-current.js"
    document.body.append(script)
  }
  const text = options.existing ?? ""
  const state: any = { tweetComposer: { modal: { composerData: [{ text, mediaIds: [] }], isSending: false, isAutoSaving: false, sentTweetsCount: 0 } }, mediaUpload: [] }
  document.querySelector('[data-testid="tweetTextarea_0"]')!.textContent = text
  const render = () => {
    const composition = state.tweetComposer.modal.composerData[0]
    document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]')!.textContent = composition.text
    document.querySelector('[role="dialog"] [data-testid="attachments"]')!.innerHTML = composition.mediaIds.map((id: number) => `<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/${id}.png"></div>`).join("")
  }
  const store = { getState: vi.fn(() => state), dispatch: vi.fn((action: any): any => {
    if (typeof action === "function") return action(store.dispatch, store.getState)
    if (action.type === "ADD_MEDIA") state.mediaUpload.push(action.record)
    else if (action.type === "LOAD_DRAFT") { state.tweetComposer.modal.composerData = [action.data]; render() }
    else if (action.type === "REMOVE_MEDIA") state.mediaUpload = state.mediaUpload.filter((record: any) => !action.ids.includes(record.id))
    else throw new Error("Unexpected native action")
    return action
  }) }
  const wl = vi.fn<(uploadId: string) => (dispatch: typeof store.dispatch) => Promise<any[]>>((uploadId: string) => async (dispatch: typeof store.dispatch) => {
    if (options.mediaFailure) throw new Error("Metadata unavailable")
    const record = { id: state.mediaUpload.length + 1, uploadId, isPreUploaded: true, externalMediaDetails: { mediaCategory: "tweet_image", mediaType: "image/png" }, uploadProgress: 1 }
    dispatch({ type: "ADD_MEDIA", record })
    return [record]
  })
  const e1 = vi.fn(({ data, parentKey }: any) => (dispatch: typeof store.dispatch) => {
    expect(parentKey).toBe("modal")
    dispatch({ type: "LOAD_DRAFT", data: { text: data.text, draftTweetId: data.tweetId, mediaIds: data.mediaIds, editorStateRaw: { blocks: [{ text: data.text }], entityMap: {} } } })
  })
  const j5 = vi.fn(({ data, parentKey }: any) => (dispatch: typeof store.dispatch) => {
    expect(parentKey).toBe("modal")
    dispatch({ type: "LOAD_DRAFT", data })
  })
  const remove = vi.fn((ids: number[]) => ({ type: "REMOVE_MEDIA", ids }))
  const require: any = vi.fn((id: number) => id === 772177 ? { e1, j5, I0: () => state.tweetComposer.modal.composerData } : id === 422068 ? { wl, m9: remove } : undefined)
  require.m = { 772177: () => {}, 422068: () => {} }
  const chunks: any[] = []
  chunks.push = vi.fn((entry: any) => { entry[2](require); return 1 })
  Object.assign(document.getElementById("react-root")!, { __reactContainer$fixture: { stateNode: { current: { child: { memoizedProps: { value: { store } } } } } } })
  ;(window as any).webpackChunk_twitter_responsive_web = chunks
  const click = vi.spyOn(HTMLElement.prototype, "click"), event = vi.spyOn(HTMLElement.prototype, "dispatchEvent")
  const network = vi.fn(() => { throw new Error("The bridge must not make its own request") })
  vi.stubGlobal("fetch", network)
  return { state, store, wl, e1, j5, remove, require, chunks, click, event, network, render }
}

beforeEach(() => {
  vi.useRealTimers()
  delete (window as any).__wesightXPostComposerV1
  delete (window as any).__wesightXPostNativeDraftV1
  vi.stubGlobal("location", new URL("https://x.com/compose/post"))
  vi.spyOn(history, "replaceState").mockImplementation((_state, _unused, url) => {
    if (url) vi.stubGlobal("location", new URL(String(url), "https://x.com"))
  })
})
afterEach(() => {
  delete (window as any).__wesightXPostComposerV1
  delete (window as any).__wesightXPostNativeDraftV1
  delete (window as any).webpackChunk_twitter_responsive_web
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("X native Post composer bridge", () => {

  test("uses the Post editor's nearest account store and avoids the server-draft restoration thunk", async () => {
    const fixture = setup()
    fixture.e1.mockImplementation(() => { throw new TypeError("Draft restoration requires unrelated native context") })
    const outerDispatch = vi.fn(() => { throw new Error("Wrong account provider") })
    const root = document.getElementById("react-root") as any
    root.__reactContainer$fixture.stateNode.current.child.memoizedProps.value.store = { getState: fixture.store.getState, dispatch: outerDispatch }
    const element = document.querySelector('[data-testid="tweetTextarea_0"]') as any
    element.__reactFiber$native = { return: { memoizedProps: { value: { store: fixture.store } } } }
    expect(await runXPostComposerInPage({ ...input(), direct: true, draftId: "" })).toEqual({ kind: "ready" })
    expect(fixture.j5).toHaveBeenCalledTimes(1); expect(fixture.e1).not.toHaveBeenCalled(); expect(outerDispatch).not.toHaveBeenCalled()
    expect(fixture.j5.mock.calls[0]![0].data.editorStateRaw.blocks.map((block: any) => block.text).join("\n")).toBe(input().text)
  })


  test("fills the native Post directly with no server draft id and preserves user edits on retry", async () => {
    const fixture = setup(), value = { ...input(), draftId: "", direct: true }
    expect(await runXPostComposerInPage(value)).toEqual({ kind: "ready" })
    expect(fixture.j5.mock.calls[0]![0].data).not.toHaveProperty("draftTweetId")
    expect(fixture.e1).not.toHaveBeenCalled()
    expect(fixture.state.tweetComposer.modal.composerData[0].draftTweetId).toBeUndefined()
    expect(new URL(location.href).searchParams.get("wesight_x_post_task")).toBe(value.taskId)
    expect(new URL(location.href).searchParams.has("draft_tweet_id")).toBe(false)
    expect(document.querySelector('[data-testid="tweetTextarea_0"]')!.textContent).toBe(value.text)
    expect(document.querySelectorAll('[data-testid="tweetPhoto"]')).toHaveLength(2)
    fixture.state.tweetComposer.modal.composerData[0].text = "我在 X 中修改过的文案"
    fixture.render()
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "ready", message: expect.stringContaining("保留") })
    expect(fixture.j5).toHaveBeenCalledTimes(1)
    expect(fixture.network).not.toHaveBeenCalled(); expect(fixture.click).not.toHaveBeenCalled(); expect(fixture.event).not.toHaveBeenCalled()
  })

  test("native direct handoff can restore after refresh and rejects another task marker", async () => {
    const value = { ...input(), draftId: "", direct: true }
    setup()
    await runXPostComposerInPage(value)
    delete (window as any).__wesightXPostComposerV1
    const restored = setup()
    history.replaceState(null, "", `/compose/post?wesight_x_post_task=${value.taskId}`)
    expect(await runXPostComposerInPage(value)).toEqual({ kind: "ready" })
    expect(restored.j5).toHaveBeenCalledTimes(1)
    history.replaceState(null, "", "/compose/post?wesight_x_post_task=another-task")
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "error", message: expect.stringContaining("已有未发布内容") })
    expect(restored.j5).toHaveBeenCalledTimes(1)
  })

  test("does not attempt native direct loading on the newer client", async () => {
    const fixture = setup({ newClient: true })
    expect(await runXPostComposerInPage({ ...input(), draftId: "", direct: true, probe: true })).toEqual({ kind: "ready", mode: "draft" })
    expect(await runXPostComposerInPage({ ...input(), draftId: "", direct: true })).toMatchObject({ kind: "error" })
    expect(fixture.store.dispatch).not.toHaveBeenCalled()
  })

  test("loads X's native draft action using pre-uploaded image records and leaves publication manual", async () => {
    const fixture = setup(), value = input()
    const result = await runXPostComposerInPage(value)
    expect(result).toEqual({ kind: "ready" })
    expect(fixture.wl.mock.calls.map(([id]) => id)).toEqual(["101", "102"])
    expect(fixture.e1).toHaveBeenCalledWith({ data: { tweetId: value.draftId, text: value.text, mediaIds: [1, 2], thread_tweets: [] }, parentKey: "modal" })
    expect(fixture.state.mediaUpload.every((record: any) => record.isPreUploaded && record.uploadProgress === 1)).toBe(true)
    expect(document.querySelector('[data-testid="tweetTextarea_0"]')!.textContent).toBe(value.text)
    expect(document.querySelectorAll('[data-testid="tweetPhoto"]')).toHaveLength(2)
    expect(location.pathname).toBe("/compose/post")
    expect(new URL(location.href).searchParams.get("draft_tweet_id")).toBe(value.draftId)
    expect(fixture.click).not.toHaveBeenCalled(); expect(fixture.event).not.toHaveBeenCalled(); expect(fixture.network).not.toHaveBeenCalled()
    expect(fixture.store.dispatch.mock.calls.filter(([action]) => typeof action !== "function").map(([action]) => action.type)).toEqual(["ADD_MEDIA", "ADD_MEDIA", "LOAD_DRAFT"])
  })

  test("probe validates native capability and protects an existing user's draft without dispatching", async () => {
    const fixture = setup(), value = { ...input(), probe: true, draftId: "", images: [] }
    expect(await runXPostComposerInPage(value)).toEqual({ kind: "ready", mode: "native" })
    expect(fixture.store.dispatch).not.toHaveBeenCalled()
    fixture.state.tweetComposer.modal.composerData[0].text = "我的未完成草稿"
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "error", message: expect.stringContaining("已有未发布内容") })
    expect(fixture.store.dispatch).not.toHaveBeenCalled()
  })
  test("checks only the Post dialog while preserving a separate home editor", async () => {
    const fixture = setup()
    const background = document.createElement("div")
    background.dataset.testid = "tweetTextarea_0"
    background.contentEditable = "true"
    background.textContent = "首页中另一个未发布的内容"
    document.body.prepend(background)
    expect(await runXPostComposerInPage(input())).toMatchObject({ kind: "ready" })
    expect(background.textContent).toBe("首页中另一个未发布的内容")
    expect(fixture.e1).toHaveBeenCalledTimes(1)
  })

  test("rejects an occupied, replying, scheduled, media or partially restored composer", async () => {
    const fixture = setup(), value = input(), item = fixture.state.tweetComposer.modal.composerData[0]
    for (const extras of [{ text: "自己的稿件" }, { mediaIds: [99] }, { scheduledTweetId: "2" }, { draftTweetId: "3" }, { pollActive: true }, { cardUrl: "https://example.com" }, { editorStateRaw: { blocks: [{ text: "恢复中" }] } }]) {
      fixture.state.tweetComposer.modal.composerData = [{ ...item, ...extras }]
      expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "error", message: expect.stringContaining("已有未发布内容") })
    }
    expect(fixture.store.dispatch).not.toHaveBeenCalled()
  })

  test("deduplicates concurrent handoffs and preserves edits after native handoff", async () => {
    const fixture = setup(), value = input()
    expect(await Promise.all([runXPostComposerInPage(value), runXPostComposerInPage(value)])).toEqual([{ kind: "ready" }, { kind: "ready" }])
    expect(fixture.e1).toHaveBeenCalledTimes(1); expect(fixture.wl).toHaveBeenCalledTimes(2)
    fixture.state.tweetComposer.modal.composerData[0].text = "用户在 X 里修改了"
    fixture.render()
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "ready", message: expect.stringContaining("保留") })
    expect(fixture.e1).toHaveBeenCalledTimes(1)
  })

  test("stops when the account changes while native image metadata is loading", async () => {
    const fixture = setup(), value = input()
    fixture.wl.mockImplementationOnce((uploadId: string) => async () => {
      document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] span')!.textContent = "@other_user"
      return [{ id: 1, uploadId, isPreUploaded: true, externalMediaDetails: { mediaCategory: "tweet_image", mediaType: "image/png" } }]
    })
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "error", message: expect.stringContaining("账号已改变") })
    expect(fixture.e1).not.toHaveBeenCalled()
  })

  test("does not overwrite typing that starts during native image metadata loading", async () => {
    const fixture = setup(), value = input()
    fixture.wl.mockImplementationOnce((uploadId: string) => async () => {
      fixture.state.tweetComposer.modal.composerData[0].text = "正在自己编辑"
      return [{ id: 1, uploadId, isPreUploaded: true, externalMediaDetails: { mediaCategory: "tweet_image", mediaType: "image/png" } }]
    })
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "error", message: expect.stringContaining("已有未发布内容") })
    expect(fixture.e1).not.toHaveBeenCalled()
    expect(fixture.remove).toHaveBeenCalledWith([1])
  })

  test("fails closed when native modules change or image metadata cannot be verified", async () => {
    const fixture = setup(), value = input()
    delete fixture.require.m[772177]
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "error", message: expect.stringContaining("更新扩展") })
    expect(fixture.store.dispatch).not.toHaveBeenCalled()
    fixture.require.m[772177] = () => {}
    fixture.wl.mockImplementationOnce((uploadId: string) => async () => [{ id: 1, uploadId, isPreUploaded: false }])
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "error", message: expect.stringContaining("读取已上传图片") })
    expect(fixture.e1).not.toHaveBeenCalled(); expect(fixture.network).not.toHaveBeenCalled()
  })

  test("new X client requests native draft navigation, then only reads the restored editor", async () => {
    const fixture = setup({ newClient: true }), value = input()
    expect(await runXPostComposerInPage(value)).toEqual({ kind: "native_navigation" })
    expect(fixture.chunks.push).not.toHaveBeenCalled(); expect(fixture.store.dispatch).not.toHaveBeenCalled()
    history.replaceState(null, "", `/compose/post?draft_tweet_id=${value.draftId}`)
    fixture.state.tweetComposer.modal.composerData = [{ text: value.text, mediaIds: [1, 2] }]; fixture.render()
    expect(await runXPostComposerInPage(value)).toEqual({ kind: "ready" })
    fixture.state.tweetComposer.modal.composerData[0].text = "在 X 内修改后保留"
    fixture.render()
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "ready", message: expect.stringContaining("保留") })
    expect(fixture.chunks.push).not.toHaveBeenCalled(); expect(fixture.store.dispatch).not.toHaveBeenCalled()
    expect(fixture.click).not.toHaveBeenCalled(); expect(fixture.event).not.toHaveBeenCalled()
  })

  test("new X client waits for every native image preview and never edits an incomplete restoration", async () => {
    const fixture = setup({ newClient: true }), value = input()
    history.replaceState(null, "", `/compose/post?draft_tweet_id=${value.draftId}`)
    fixture.state.tweetComposer.modal.composerData = [{ text: value.text, mediaIds: [1] }]; fixture.render()
    vi.useFakeTimers()
    const pending = runXPostComposerInPage(value)
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ kind: "error", message: expect.stringContaining("尚未完整装入") })
    expect(document.querySelectorAll('[data-testid="tweetPhoto"]')).toHaveLength(1)
    expect(fixture.store.dispatch).not.toHaveBeenCalled(); expect(fixture.click).not.toHaveBeenCalled(); expect(fixture.event).not.toHaveBeenCalled()
  })

  test("new X client preserves user typing before native navigation", async () => {
    const fixture = setup({ newClient: true, existing: "刚刚开始写的文字" })
    expect(await runXPostComposerInPage(input())).toMatchObject({ kind: "error", message: expect.stringContaining("已有未发布内容") })
    expect(location.search).toBe("")
    expect(fixture.store.dispatch).not.toHaveBeenCalled()
  })

  test("rejects wrong accounts, media types and page routes before native access", async () => {
    const fixture = setup(), value = input()
    value.account = "another"
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "error", message: expect.stringContaining("账号不同") })
    value.account = "fixture_user"; value.images[0]!.mimeType = "image/gif"
    expect(await runXPostComposerInPage(value)).toMatchObject({ kind: "error", message: expect.stringContaining("数据无效") })
    history.replaceState(null, "", "/home")
    expect(await runXPostComposerInPage(input())).toMatchObject({ kind: "error", message: expect.stringContaining("原生 Post") })
    expect(fixture.chunks.push).not.toHaveBeenCalled(); expect(fixture.store.dispatch).not.toHaveBeenCalled()
  })

  test("the function remains self contained when serialized into the MAIN world", async () => {
    const fixture = setup()
    const serialized = (0, eval)(`(${runXPostComposerInPage.toString()})`) as typeof runXPostComposerInPage
    expect(await serialized(input())).toEqual({ kind: "ready" })
    expect(fixture.e1).toHaveBeenCalledTimes(1)
  })
})
