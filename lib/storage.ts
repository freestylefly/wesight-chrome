import type { WeSightUser } from "~types/auth"
import type { PlatformId, PlatformTaskState } from "~types/protocol"

export const STORAGE_KEYS = {
  pairing: "wesight_pairing_v1",
  currentTask: "wesight_current_task_v1",
  accountStates: "wesight_account_states_v1",
  logs: "wesight_diagnostic_logs_v1",
  access: "wesight_access_v1",
  draftRevision: "wesight_draft_revision_v1",
  dynamicDraftRevision: "wesight_dynamic_draft_revision_v1",
  publishMode: "wesight_publish_mode_v1",
  publishPreferences: "wesight_publish_preferences_v1",
  auth: "wesight_auth_v1",
  refreshToken: "wesight_refresh_token_v1",
  signedOut: "wesight_signed_out_v1"
} as const

export const SESSION_KEYS = {
  platformLogins: "wesight_platform_logins_v1",
  taskAccess: "wesight_task_access_v1",
  composeBridge: "wesight_compose_bridge_v1",
  dynamicComposeBridge: "wesight_dynamic_compose_bridge_v1",
  cloudSession: "wesight_cloud_session_v1",
  loginTransaction: "wesight_login_transaction_v1"
} as const

export interface PairingRecord {
  clientId: string
  secret: string
  baseUrl: string
  pairedAt: string
}

export interface TaskSummary {
  taskId: string
  title: string
  startedAt: string
  updatedAt: string
  targets?: PlatformId[]
  groupId?: number
  origin?: "bridge" | "compose"
  draftId?: string
  contentKind?: "article" | "dynamic"
  bridge: {
    baseUrl: string
  }
  platforms: Record<PlatformId, PlatformTaskState>
}

export interface BridgeTaskAccess {
  taskId: string
  taskToken: string
  baseUrl: string
  /** Original Obsidian targets; local composers may add other destinations. */
  targets?: PlatformId[]
}

// Bridge tasks read content from Obsidian; local tasks read the publish-center
// draft from IndexedDB and optionally mirror status back to Obsidian.
export type TaskAccessRecord =
  | ({ kind?: "bridge" } & BridgeTaskAccess)
  | { kind: "local"; taskId: string; bridge?: BridgeTaskAccess }

export interface ComposeBridgeRecord extends BridgeTaskAccess {
  draftId: string
}

export type AccountState = "unknown" | "logged_in" | "login_required"

export interface AccountRecord {
  state: AccountState
  checkedAt?: string
  name?: string
  avatar?: string
}

export type AccountStateMap = Record<PlatformId, AccountRecord>

export type AccessState = "login-required" | "single-platform" | "multi-platform"

export interface AccessRecord {
  user?: WeSightUser | null
  state: AccessState
  maxTargets: number | null
  checkedAt: string
  /** Membership checkout page from the WeSight billing summary. */
  checkoutUrl?: string
  billing?: MembershipSummary
}

export interface MembershipSummary {
  active: boolean
  credits: number
  planName: string | null
  expiresAt: string | null
}

export function parseMembershipSummary(value: unknown): MembershipSummary | undefined {
  if (!value || typeof value !== "object") return undefined
  const raw = value as Record<string, unknown>
  const membership = (raw.membership && typeof raw.membership === "object" ? raw.membership : raw) as Record<string, unknown>
  const credits = Number(raw.totalCreditsRemaining ?? raw.credits)
  if (typeof membership.active !== "boolean" || !Number.isFinite(credits)) return undefined
  return {
    active: membership.active,
    credits,
    planName: typeof membership.planName === "string" ? membership.planName : null,
    expiresAt: typeof membership.expiresAt === "string" ? membership.expiresAt : null
  }
}

export interface PublishPreferences {
  selected: PlatformId[]
  keepImages: boolean
  xSkipExcessImages?: boolean
}

export async function getLocal<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.local.get(key)
  return (result[key] as T | undefined) ?? null
}

export async function setLocal<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

export async function removeLocal(key: string): Promise<void> {
  await chrome.storage.local.remove(key)
}

export async function getSession<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.session.get(key)
  return (result[key] as T | undefined) ?? null
}

export async function setSession<T>(key: string, value: T): Promise<void> {
  await chrome.storage.session.set({ [key]: value })
}

export async function removeSession(key: string): Promise<void> {
  await chrome.storage.session.remove(key)
}
