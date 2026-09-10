import type { AccountStateMap, PairingRecord, TaskSummary } from "~lib/storage"
import type { BridgeHandoff, PlatformId, PublishAssetV1, PublishTaskV1 } from "~types/protocol"

export type ExtensionRequest =
  | { type: "BRIDGE_HANDOFF"; handoff: BridgeHandoff }
  | { type: "GET_POPUP_STATE" }
  | { type: "RETRY_PLATFORM"; taskId: string; platformId: PlatformId }
  | { type: "OPEN_TASK_TABS"; taskId: string }
  | { type: "PLATFORM_PAGE_READY"; platformId: PlatformId; url: string }
  | { type: "PLATFORM_RESULT"; taskId: string; platformId: PlatformId; warnings: string[]; draftUrl?: string }
  | { type: "PLATFORM_LOGIN_REQUIRED"; taskId: string; platformId: PlatformId; message: string }
  | { type: "PLATFORM_FAILED"; taskId: string; platformId: PlatformId; message: string }
  | { type: "XIAOHONGSHU_UPLOAD_PROGRESS"; taskId: string; completed: number; total: number }
  | { type: "GET_ASSET_DATA"; taskId: string; asset: PublishAssetV1 }
  | { type: "FILL_PLATFORM_EDITOR"; platformId: PlatformId; title: string; html: string; markdown: string }
  | { type: "UPLOAD_PLATFORM_ASSET"; taskId: string; platformId: PlatformId; asset: PublishAssetV1 }

export type ContentRequest =
  | { type: "PREPARE_DRAFT"; task: PublishTaskV1 }
  | { type: "SHOW_READY"; warnings: string[] }
  | { type: "CHECK_ACCOUNT" }

export interface PopupState {
  pairing: PairingRecord | null
  connected: boolean
  currentTask: TaskSummary | null
  accounts: AccountStateMap
}

export interface ExtensionResponse<T = unknown> {
  ok: boolean
  value?: T
  error?: string
}
