import type { PlatformId, PlatformTaskState } from "~types/protocol"

export const STORAGE_KEYS = {
  pairing: "wesight_pairing_v1",
  currentTask: "wesight_current_task_v1",
  accountStates: "wesight_account_states_v1",
  logs: "wesight_diagnostic_logs_v1"
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
  groupId?: number
  bridge: {
    baseUrl: string
  }
  platforms: Record<PlatformId, PlatformTaskState>
}

export interface TaskAccessRecord {
  taskId: string
  taskToken: string
  baseUrl: string
}

export type AccountState = "unknown" | "logged_in" | "login_required"

export type AccountStateMap = Record<PlatformId, {
  state: AccountState
  checkedAt?: string
}>

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
