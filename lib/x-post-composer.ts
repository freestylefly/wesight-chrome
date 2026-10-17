export interface XPostComposerInput {
  taskId: string
  account: string
  text: string
  draftId: string
  /** Fill responsive-web's native composer without a server draft mutation. */
  direct?: boolean
  images: Array<{ uploadId: string; fileName: string; mimeType: string }>
  /** Read account, native capability and existing composition before uploading. */
  probe?: boolean
}

export interface XPostComposerResult {
  kind: "ready" | "native_navigation" | "error"
  message?: string
  mode?: "native" | "draft"
}

/**
 * Serialized by chrome.scripting.executeScript into X's MAIN world. Keep every
 * runtime dependency inside this function. The bridge uses X's own draft/media
 * actions; it never types, clicks, pastes, dispatches DOM events or publishes.
 */
export async function runXPostComposerInPage(input: XPostComposerInput): Promise<XPostComposerResult> {
  const failed = (message: string): XPostComposerResult => ({ kind: "error", message })
  const changed = "X 编辑器已更新，请更新扩展后重试"
  const occupied = "X 编辑器已有未发布内容，请先保存或关闭当前内容，再重新同步"
  const page = window as any
  const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
  const account = () => Array.from(document.querySelectorAll('[data-testid="SideNav_AccountSwitcher_Button"] span'))
    .map(node => node.textContent?.trim()).find(value => /^@[A-Za-z0-9_]+$/.test(value ?? ""))?.slice(1).toLowerCase()
  const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp"])
  let url: URL
  try { url = new URL(location.href) } catch { return failed("X 页面地址无效，请重新发起同步") }
  if (url.protocol !== "https:" || !["x.com", "twitter.com"].includes(url.hostname) || url.port || url.username || url.password
    || url.pathname !== "/compose/post") return failed("请在 X 原生 Post 编辑页重新同步")
  if (["in_reply_to", "in_reply_to_status_id", "quoted_status_id", "quote_tweet_id", "scheduled_tweet_id"].some(key => url.searchParams.has(key))) return failed(occupied)
  if (!input || typeof input.taskId !== "string" || !input.taskId || input.taskId.length > 200
    || !/^[A-Za-z0-9_]{1,30}$/.test(input.account) || typeof input.text !== "string"
    || input.text.length > 20_000 || !Array.isArray(input.images) || input.images.length > 4
    || (!input.probe && (input.direct ? input.draftId !== "" : !/^\d{1,30}$/.test(input.draftId)))
    || input.images.some(image => !image || !/^\d{1,30}$/.test(image.uploadId) || !mimeTypes.has(image.mimeType)
      || typeof image.fileName !== "string" || image.fileName.length > 1024)
    || new Set(input.images.map(image => image.uploadId)).size !== input.images.length) return failed("X 动态编辑数据无效，请重新发起同步")
  const expectedAccount = input.account.toLowerCase()
  if (account() !== expectedAccount) return failed("X 当前账号与同步账号不同，请切回原账号后重试")
  if (url.searchParams.has("draft_tweet_id") && url.searchParams.get("draft_tweet_id") !== input.draftId) return failed(occupied)
  const taskMarker = "wesight_x_post_task"
  if (url.searchParams.has(taskMarker) && url.searchParams.get(taskMarker) !== input.taskId) return failed(occupied)

  const dialog = () => document.querySelector('[role="dialog"]')
  const editor = () => dialog()?.querySelector<HTMLElement>('[data-testid="tweetTextarea_0"] [contenteditable="true"], [data-testid="tweetTextarea_0"][contenteditable="true"], [data-testid="tweetTextarea_0"] textarea, textarea[placeholder], [contenteditable="true"][role="textbox"]')
  const editorText = (element: HTMLElement) => element instanceof HTMLTextAreaElement ? element.value : element.innerText ?? element.textContent ?? ""
  const normalize = (value: string) => value.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[\u200b\ufeff]/g, "")
  const mediaCount = () => {
    const attachments = dialog()?.querySelector('[data-testid="attachments"]')
    if (attachments) {
      const previews = attachments.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="mediaPreview"]')
      return previews.length || attachments.querySelectorAll("img").length
    }
    return dialog()?.querySelectorAll('img[src^="https://pbs.twimg.com/media/"]').length ?? 0
  }
  const nativeUiReady = async () => {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (account() !== expectedAccount) return false
      const element = editor()
      const visibleText = element ? normalize(editorText(element)).replace(/\n+/g, "\n").trim() : null
      if (element && visibleText === normalize(input.text).replace(/\n+/g, "\n").trim() && mediaCount() >= input.images.length) return true
      await pause(100)
    }
    return false
  }

  // The newer X client restores its own saved draft directly from this query.
  // Its module/runtime implementation is intentionally kept separate from the
  // verified responsive-web Redux actions below.
  const newClient = Array.from(document.scripts).some(script => {
    try { const source = new URL(script.src); return source.origin === "https://abs.twimg.com" && /^\/x-web\/x-web\/entry-client-[\w-]+\.js$/.test(source.pathname) }
    catch { return false }
  })
  if (newClient) {
    const ownDraft = input.draftId && url.searchParams.get("draft_tweet_id") === input.draftId
    if (input.probe) {
      const element = editor()
      if (!ownDraft && ((element && editorText(element)) || mediaCount())) return failed(occupied)
      return { kind: "ready", mode: "draft" }
    }
    if (input.direct) return failed(changed)
    if (!ownDraft) {
      const element = editor()
      if ((element && editorText(element)) || mediaCount()) return failed(occupied)
      return { kind: "native_navigation" }
    }
    const handedOff = page.__wesightXPostNativeDraftV1
    if (handedOff?.taskId === input.taskId && handedOff?.draftId === input.draftId && handedOff?.account === expectedAccount && editor()) {
      return { kind: "ready", message: "已保留你在 X 编辑器中的内容，请手动确认发布" }
    }
    if (await nativeUiReady()) {
      page.__wesightXPostNativeDraftV1 = { taskId: input.taskId, draftId: input.draftId, account: expectedAccount }
      return { kind: "ready" }
    }
    return failed("X 草稿尚未完整装入编辑器，请检查 X 页面后重试；插件不会覆盖当前内容")
  }

  type NativeStore = { getState: () => any; dispatch: (action: any) => any }
  const getStore = (): NativeStore | undefined => {
    const storeFrom = (fiber: any): NativeStore | undefined => {
      for (const candidate of [fiber?.memoizedProps?.value?.store, fiber?.memoizedProps?.store]) {
        if (candidate && typeof candidate.getState === "function" && typeof candidate.dispatch === "function") {
          try { if (candidate.getState()?.tweetComposer && Array.isArray(candidate.getState()?.mediaUpload)) return candidate }
          catch { /* Ignore unrelated providers. */ }
        }
      }
    }
    // X can nest account-specific stores under an outer Redux provider. Start
    // at the actual Post editor so actions use its account and middleware.
    let element: HTMLElement | null | undefined = editor()
    while (element) {
      const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"))
      if (key) {
        let fiber = (element as any)[key]
        for (let depth = 0; fiber && depth < 250; depth++, fiber = fiber.return) {
          const candidate = storeFrom(fiber)
          if (candidate) return candidate
        }
      }
      element = element.parentElement
    }
    const root = document.getElementById("react-root") as any
    if (!root) return
    const roots = Object.keys(root).filter(key => key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$"))
      .flatMap(key => [root[key]?.stateNode?.current, root[key]])
    const queue = roots.filter(Boolean), seen = new Set<any>()
    for (let index = 0; index < queue.length && index < 15_000; index++) {
      const fiber = queue[index]
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      const candidate = storeFrom(fiber)
      if (candidate) return candidate
      if (fiber.child) queue.push(fiber.child)
      if (fiber.sibling) queue.push(fiber.sibling)
    }
  }
  let store = getStore()
  const hydratedBy = Date.now() + 10_000
  while ((!store || !editor() || !Array.isArray(store.getState()?.tweetComposer?.modal?.composerData)) && Date.now() < hydratedBy) {
    if (account() !== expectedAccount) return failed("X 当前账号已改变，请切回原账号后重试")
    await pause(100)
    store = getStore()
  }
  if (!store) return failed(changed)
  const getModal = () => store.getState()?.tweetComposer?.modal
  const getComposition = () => getModal()?.composerData
  const hasContent = (item: any) => !item || typeof item.text !== "string" || Boolean(item.text || item.mediaIds?.length || item.cardUrl
    || item.draftTweetId || item.scheduledTweetId || item.scheduledFor || item.pollActive || item.pollChoices?.some((choice: any) => Boolean(choice))
    || item.mediaTags?.length || item.cashtagAttachments?.length || item.taggedLocation || item.gifMetadata || item.contentDisclosure
    || item.editorStateRaw?.blocks?.some((block: any) => Boolean(block?.text)) || Object.keys(item.editorStateRaw?.entityMap ?? {}).length)
  const pristine = () => {
    const modal = getModal(), composition = getComposition(), element = editor()
    return modal && !modal.isSending && !modal.isAutoSaving && !modal.sentTweetsCount
      && Array.isArray(composition) && composition.length === 1 && !hasContent(composition[0])
      && (!element || !normalize(editorText(element)).trim()) && mediaCount() === 0
  }
  const matches = () => {
    const composition = getComposition()
    if (!Array.isArray(composition) || composition.length !== 1) return false
    const item = composition[0], media = store.getState()?.mediaUpload
    if ((input.direct ? Boolean(item?.draftTweetId) : item?.draftTweetId !== input.draftId) || item.text !== input.text || !Array.isArray(item.mediaIds)
      || item.mediaIds.length !== input.images.length || !Array.isArray(media)) return false
    return item.mediaIds.every((id: unknown, index: number) => media.some(record => record.id === id && record.uploadId === input.images[index]?.uploadId && record.isPreUploaded === true))
  }

  const namespace = "__wesightXPostComposerV1"
  let session = page[namespace]
  if (!session || session.version !== 1) {
    session = { version: 1 }
    Object.defineProperty(page, namespace, { value: session, configurable: true })
  }
  const active = session.active
  if (active?.pending && (active.taskId !== input.taskId || active.account !== expectedAccount || active.draftId !== input.draftId)) return failed("X 编辑器正在处理另一项同步，请等待完成后重试")
  if (active && active.taskId === input.taskId && active.account === expectedAccount && active.draftId === input.draftId) {
    if (input.probe) return { kind: "ready", mode: "native" }
    if (active.text !== input.text || active.uploadIds !== input.images.map(image => image.uploadId).join(",")) return failed("此 X 同步任务的内容已改变，请重新发起同步")
    if (active.pending) return active.pending
    // A completed handoff belongs to the user now. Never replace edits made in X.
    if (active.ready && (input.direct ? url.searchParams.get(taskMarker) === input.taskId : getComposition()?.[0]?.draftTweetId === input.draftId)) return { kind: "ready", message: "已保留你在 X 编辑器中的内容，请手动确认发布" }
  }
  if (!pristine() && !matches()) return failed(occupied)

  let requireNative = session.requireNative as any
  if (!requireNative) {
    const chunks = page.webpackChunk_twitter_responsive_web
    if (!Array.isArray(chunks) || typeof chunks.push !== "function") return failed(changed)
    try {
      chunks.push([[`wesight_x_post_composer_${Date.now()}_${Math.random().toString(36).slice(2)}`], {}, (require: any) => { requireNative = require }])
    } catch { return failed(changed) }
    if (typeof requireNative !== "function" || !requireNative.m) return failed(changed)
    session.requireNative = requireNative
  }
  if (!requireNative.m[772177] || !requireNative.m[422068]) return failed(changed)
  let composer: any, media: any
  try { composer = requireNative(772177); media = requireNative(422068) } catch { return failed(changed) }
  if (typeof (input.direct || input.probe ? composer?.j5 : composer?.e1) !== "function" || typeof composer?.I0 !== "function" || typeof media?.wl !== "function" || typeof media?.m9 !== "function") return failed(changed)
  if (input.probe) return { kind: "ready", mode: "native" }
  const markUrl = () => {
    const next = new URL(url.href)
    if (input.direct) next.searchParams.set(taskMarker, input.taskId)
    else next.searchParams.set("draft_tweet_id", input.draftId)
    history.replaceState(history.state, "", next.href)
  }
  if (matches()) {
    if (!await nativeUiReady()) return failed("X 编辑器尚未显示完整内容，请刷新页面后重试")
    markUrl()
    return { kind: "ready" }
  }
  const marker: any = { taskId: input.taskId, account: expectedAccount, draftId: input.draftId, text: input.text, uploadIds: input.images.map(image => image.uploadId).join(","), ready: false }
  session.active = marker
  const run = async (): Promise<XPostComposerResult> => {
    const ownedMediaIds: number[] = []
    let installed = false
    let phase = "读取图片"
    try {
      for (const image of input.images) {
        if (account() !== expectedAccount) return failed("X 当前账号已改变，请切回原账号后重试")
        if (!pristine()) return failed(occupied)
        // X's addUploadedMediaById reads metadata and verifies ownership. Native
        // isPreUploaded records resolve without any INIT/APPEND/FINALIZE upload.
        const records = await store.dispatch(media.wl(image.uploadId))
        if (!Array.isArray(records) || records.length !== 1) return failed(changed)
        const record = records[0]
        if (!Number.isSafeInteger(record?.id) || record.isPreUploaded !== true || record.uploadId !== image.uploadId
          || record.externalMediaDetails?.mediaCategory !== "tweet_image" || !mimeTypes.has(record.externalMediaDetails?.mediaType)) return failed("X 未能读取已上传图片，请更新扩展后重试")
        ownedMediaIds.push(record.id)
      }
      if (account() !== expectedAccount) return failed("X 当前账号已改变，请切回原账号后重试")
      if (!pristine()) return failed(occupied)
      phase = "装入文案"
      // setSingleComposer initializes a fresh native composition. Restoring an
      // unsent server draft needs feature-switch/media context that is unrelated
      // to a new Post; do not use that restoration thunk for a direct handoff.
      const action = input.direct ? composer.j5({ data: {
        text: input.text, mediaIds: ownedMediaIds,
        editorStateRaw: { blocks: input.text.split("\n").map((text, index) => ({ key: `ws${index.toString(36)}`, text, type: "unstyled", depth: 0, inlineStyleRanges: [], entityRanges: [], data: {} })), entityMap: {} }
      }, parentKey: "modal" }) : composer.e1({ data: { tweetId: input.draftId, text: input.text, mediaIds: ownedMediaIds, thread_tweets: [] }, parentKey: "modal" })
      if (typeof action !== "function") return failed(changed)
      await store.dispatch(action)
      installed = true
      phase = "确认编辑界面"
      if (!matches()) return failed("X 编辑器内容校验失败，请更新扩展后重试")
      if (!await nativeUiReady()) return failed("X 编辑器尚未显示完整内容，请检查 X 页面后重试")
      markUrl()
      marker.ready = true
      return { kind: "ready" }
    } catch (error) {
      const category = error instanceof Error && ["TypeError", "RangeError", "ReferenceError"].includes(error.name) ? error.name : "原生动作异常"
      return failed(`X ${phase}失败（${category}），请重试；当前内容已保留`)
    } finally {
      // Remove only unattached records created by this invocation, through the
      // native media action. Existing user composition/media remain untouched.
      if (!installed && ownedMediaIds.length && account() === expectedAccount) {
        try { store.dispatch(media.m9(ownedMediaIds)) } catch { /* Unattached native records are harmless. */ }
      }
    }
  }
  marker.pending = run()
  const result = await marker.pending
  delete marker.pending
  return result
}
