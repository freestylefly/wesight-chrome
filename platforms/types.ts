import type { PlatformId, PublishAssetV1, PublishTaskV1 } from "~types/protocol"
import type { XPostComposerInput, XPostComposerResult } from "~lib/x-post-composer"

export interface AccountDetection {
  loggedIn: boolean
  name?: string
  avatar?: string
  message?: string
}

export interface PrepareDraftContext {
  task: PublishTaskV1
  getAssetData: (asset: PublishAssetV1) => Promise<string>
  getAssetBlob?: (asset: PublishAssetV1) => Promise<Blob>
  reportProgress?: (message: string) => void
  uploadProgress?: {
    complete: (asset: PublishAssetV1) => void
    skip?: (asset: PublishAssetV1) => void
    fail: (asset: PublishAssetV1) => void
  }
  pageBridge?: {
    fillEditor: (input: {
      platformId: PlatformId
      title: string
      html: string
      markdown: string
    }) => Promise<void>
    uploadAsset: (platformId: PlatformId, asset: PublishAssetV1) => Promise<string>
    prepareXPost?: (input: XPostComposerInput) => Promise<XPostComposerResult>
  }
}

export interface PrepareDraftResult {
  draftUrl: string
  warnings: string[]
  editorPending?: boolean
}

export interface PlatformAdapter {
  id: PlatformId
  title: string
  editorUrl: string
  titleLimit: number
  detectAccount(): Promise<AccountDetection>
  prepareDraft(context: PrepareDraftContext): Promise<PrepareDraftResult>
  retry(context: PrepareDraftContext): Promise<PrepareDraftResult>
  dispose(): void
}

export class PlatformPageChangedError extends Error {
  constructor(platform: string, control: string) {
    super(`${platform} 页面结构可能已更新，未找到${control}`)
    this.name = "PlatformPageChangedError"
  }
}
