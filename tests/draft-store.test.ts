import "fake-indexeddb/auto"

import {
  getCurrentDraft,
  getLocalTask,
  getStoredAsset,
  pruneAssets,
  saveCurrentDraft,
  saveLocalTask,
  type ComposeDraft
} from "~lib/draft-store"
import type { PublishTaskV1 } from "~types/protocol"

function asset(id: string) {
  return { id, fileName: `${id}.png`, mimeType: "image/png", size: 1, sha256: id }
}

function draft(id: string, assetIds: string[]): ComposeDraft {
  return {
    id,
    source: { kind: "file", fileName: "a.md" },
    title: "标题",
    digest: "",
    markdown: "正文",
    html: "<p>正文</p>",
    coverAssetId: null,
    tags: [],
    assets: assetIds.map(asset),
    warnings: [],
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

function stored(id: string) {
  return { id, mimeType: "image/png", bytes: new Uint8Array([1]).buffer }
}

describe("publish center draft store", () => {
  test("keeps image bytes referenced by the current draft or latest task", async () => {
    await saveCurrentDraft(draft("first", ["a", "b"]), [stored("a"), stored("b")])
    expect((await getCurrentDraft())?.id).toBe("first")

    const task = {
      taskId: "task-1",
      assets: [asset("b")]
    } as unknown as PublishTaskV1
    await saveLocalTask(task)
    expect((await getLocalTask("task-1"))?.assets).toHaveLength(1)

    await saveCurrentDraft(draft("second", ["c"]), [stored("c")])
    await pruneAssets()
    expect(await getStoredAsset("a")).toBeNull()
    expect(await getStoredAsset("b")).not.toBeNull()
    expect(await getStoredAsset("c")).not.toBeNull()

    await saveLocalTask({ taskId: "task-2", assets: [] } as unknown as PublishTaskV1)
    expect(await getLocalTask("task-1")).toBeNull()
    await pruneAssets()
    expect(await getStoredAsset("b")).toBeNull()
    expect((await getCurrentDraft())?.id).toBe("second")
  })
})
