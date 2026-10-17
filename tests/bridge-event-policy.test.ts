import { shouldMirrorBridgeEvent } from "~lib/bridge-event-policy"
import type { BridgeTaskAccess } from "~lib/storage"

const access: BridgeTaskAccess = { taskId: "obsidian", taskToken: "token", baseUrl: "http://127.0.0.1:1234", targets: ["xiaohongshu", "weibo-post", "jike-post"] }

describe("publish center progress mirroring", () => {
  test("keeps original Obsidian destinations and skips an X destination added in the browser", () => {
    expect(shouldMirrorBridgeEvent(access, "xiaohongshu")).toBe(true)
    expect(shouldMirrorBridgeEvent(access, "jike-post")).toBe(true)
    expect(shouldMirrorBridgeEvent(access, "x-post")).toBe(false)
    expect(shouldMirrorBridgeEvent(access, "csdn")).toBe(false)
  })
  test("does not send unrecognized destinations from an older resumable bridge record", () => {
    const { targets: _targets, ...older } = access
    expect(shouldMirrorBridgeEvent(older, "x-post")).toBe(false)
    expect(shouldMirrorBridgeEvent(older, "weibo-post")).toBe(false)
  })
  test("allows X events when the original bridge task explicitly contains X", () => {
    expect(shouldMirrorBridgeEvent({ ...access, targets: ["x-post"] }, "x-post")).toBe(true)
  })
})
