import type { WeSightAuthState } from "~types/auth"
import type { AccessRecord, AccountStateMap, PairingRecord, TaskSummary } from "~lib/storage"
import type { BridgeHandoff, PlatformId, PublishAssetV1, PublishTaskV1 } from "~types/protocol"

export type ExtensionRequest =
  | { type: "CONNECT_BRIDGE"; baseUrl: string; pairToken: string }
  | { type: "BRIDGE_HANDOFF"; handoff: BridgeHandoff }
  | { type: "GET_POPUP_STATE" }
  | { type: "WESIGHT_LOGIN" }
  | { type: "WESIGHT_LOGOUT" }
  | { type: "GET_PUBLISH_STATE"; refreshAccess?: boolean }
  | { type: "REFRESH_ACCOUNTS" }
  | { type: "OPEN_PLATFORM_LOGIN"; platformId: PlatformId }
  | { type: "START_COMPOSE_SYNC"; targets: PlatformId[]; keepImages: boolean; xSkipExcessImages?: boolean }
  | { type: "START_DYNAMIC_SYNC"; targets: import("~types/protocol").DynamicPlatformId[] }
  | { type: "OPEN_PLATFORM_TAB"; taskId: string; platformId: PlatformId }
  | { type: "OPEN_PUBLISH_CENTER" }
  | { type: "RETRY_PLATFORM"; taskId: string; platformId: PlatformId }
  | { type: "OPEN_TASK_TABS"; taskId: string }
  | { type: "PLATFORM_PAGE_READY"; platformId: PlatformId; url: string }
  | { type: "PLATFORM_RESULT"; taskId: string; platformId: PlatformId; warnings: string[]; draftUrl?: string; editorPending?: boolean }
  | { type: "PLATFORM_LOGIN_REQUIRED"; taskId: string; platformId: PlatformId; message: string }
  | { type: "PLATFORM_FAILED"; taskId: string; platformId: PlatformId; message: string }
  | { type: "XIAOHONGSHU_UPLOAD_PROGRESS"; taskId: string; completed: number; total: number }
  | { type: "GET_X_PUBLIC_SCRIPT"; url: string }
  | { type: "PLATFORM_PROGRESS"; taskId: string; platformId: PlatformId; message: string }
  | { type: "GET_ASSET_DATA"; taskId: string; asset: PublishAssetV1 }
  | { type: "GET_ASSET_CHUNK"; taskId: string; assetId: string; offset: number }
  | { type: "FILL_PLATFORM_EDITOR"; platformId: PlatformId; title: string; html: string; markdown: string }
  | { type: "UPLOAD_PLATFORM_ASSET"; taskId: string; platformId: PlatformId; asset: PublishAssetV1 }

export type ContentRequest =
  | { type: "PREPARE_DRAFT"; task: PublishTaskV1; platformId?: PlatformId }
  | { type: "SHOW_READY"; warnings: string[] }
  | { type: "CHECK_ACCOUNT" }

export interface PopupState {
  auth: WeSightAuthState
  pairing: PairingRecord | null
  connected: boolean
  currentTask: TaskSummary | null
  accounts: AccountStateMap
}

export interface PublishCenterState {
  auth: WeSightAuthState
  paired: boolean
  connected: boolean
  access: AccessRecord | null
  accounts: AccountStateMap
  currentTask: TaskSummary | null
}

export interface ExtensionResponse<T = unknown> {
  ok: boolean
  value?: T
  error?: string
}
