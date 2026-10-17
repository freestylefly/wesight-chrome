import { isWeSightUser } from "~types/auth"
import { hmacSha256, randomHex, secureEqual, sha256 } from "~lib/crypto"
import { getLocal, parseMembershipSummary, setLocal, STORAGE_KEYS, type AccessRecord, type AccessState, type PairingRecord } from "~lib/storage"
import {
  getPublishTaskValidationError,
  BRIDGE_CAPABILITIES,
  PLATFORM_IDS,
  type PlatformTaskEventV1,
  type PublishAssetV1,
  type PublishTaskV1
} from "~types/protocol"

function extensionHeaders(pairing: PairingRecord): Record<string, string> {
  return {
    "X-WeSight-Client": pairing.clientId,
    "X-WeSight-Platforms": PLATFORM_IDS.join(","),
    "X-WeSight-Version": chrome.runtime.getManifest().version,
    "X-WeSight-Capabilities": BRIDGE_CAPABILITIES.join(",")
  }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`
}

export function normalizeBridgeBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("本地通道地址无效")
  }
  return url.origin
}

export async function getPairing(): Promise<PairingRecord | null> {
  return getLocal<PairingRecord>(STORAGE_KEYS.pairing)
}

export async function pairWithBridge(baseUrl: string, pairToken: string): Promise<PairingRecord> {
  baseUrl = normalizeBridgeBaseUrl(baseUrl)
  const pairing: PairingRecord = {
    clientId: chrome.runtime.id,
    secret: randomHex(32),
    baseUrl,
    pairedAt: new Date().toISOString()
  }
  const response = await fetch(endpoint(baseUrl, "/v1/pair"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${pairToken}`,
      "Content-Type": "application/json",
      ...extensionHeaders(pairing)
    },
    body: JSON.stringify({ clientId: pairing.clientId, secret: pairing.secret })
  })
  if (!response.ok) throw new Error(`配对失败（HTTP ${response.status}）`)
  await setLocal(STORAGE_KEYS.pairing, pairing)
  return pairing
}

export async function pingBridge(pairing: PairingRecord): Promise<boolean> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 4_000)
  try {
    const response = await fetch(endpoint(pairing.baseUrl, "/health"), {
      headers: extensionHeaders(pairing),
      signal: controller.signal
    })
    if (!response.ok) return false
    const health = await response.json() as { protocolVersion?: unknown; paired?: unknown }
    return health.protocolVersion === 1 && health.paired === true
  } catch {
    return false
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function fetchTask(
  baseUrl: string,
  taskId: string,
  taskToken: string,
  pairing: PairingRecord
): Promise<PublishTaskV1> {
  baseUrl = normalizeBridgeBaseUrl(baseUrl)
  const response = await fetch(endpoint(baseUrl, `/v1/tasks/${encodeURIComponent(taskId)}`), {
    headers: {
      "Authorization": `Bearer ${taskToken}`,
      ...extensionHeaders(pairing)
    }
  })
  const body = await response.text()
  if (!response.ok) {
    let message = `读取任务失败（HTTP ${response.status}）`
    try {
      const parsed = JSON.parse(body) as { error?: unknown }
      if (typeof parsed.error === "string" && parsed.error.trim()) message = parsed.error.trim()
    } catch {
      // Keep the HTTP fallback when the bridge did not return JSON.
    }
    throw new Error(message)
  }
  const expectedSignature = await hmacSha256(pairing.secret, body)
  const signature = response.headers.get("X-WeSight-Signature") ?? ""
  if (!secureEqual(signature, expectedSignature)) throw new Error("任务签名校验失败")
  const parsed: unknown = JSON.parse(body)
  const validationError = getPublishTaskValidationError(parsed)
  if (validationError) throw new Error(validationError)
  return parsed as PublishTaskV1
}

export async function fetchAsset(
  baseUrl: string,
  taskId: string,
  taskToken: string,
  pairing: PairingRecord,
  asset: PublishAssetV1
): Promise<Blob> {
  baseUrl = normalizeBridgeBaseUrl(baseUrl)
  const response = await fetch(
    endpoint(baseUrl, `/v1/tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(asset.id)}`),
    {
      headers: {
        "Authorization": `Bearer ${taskToken}`,
        ...extensionHeaders(pairing)
      }
    }
  )
  if (!response.ok) throw new Error(`读取图片失败（HTTP ${response.status}）`)
  const body = await response.arrayBuffer()
  if ((await sha256(body)) !== asset.sha256) throw new Error(`图片 ${asset.fileName} 校验失败`)
  return new Blob([body], { type: asset.mimeType })
}

export async function postTaskEvent(
  baseUrl: string,
  taskToken: string,
  pairing: PairingRecord,
  event: PlatformTaskEventV1
): Promise<void> {
  baseUrl = normalizeBridgeBaseUrl(baseUrl)
  const body = JSON.stringify(event)
  const signature = await hmacSha256(pairing.secret, body)
  const response = await fetch(endpoint(baseUrl, `/v1/tasks/${encodeURIComponent(event.taskId)}/events`), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${taskToken}`,
      "Content-Type": "application/json",
      ...extensionHeaders(pairing),
      "X-WeSight-Signature": signature
    },
    body
  })
  if (!response.ok) throw new Error(`回传任务状态失败（HTTP ${response.status}）`)
}

const ACCESS_STATES: AccessState[] = ["login-required", "single-platform", "multi-platform"]

/** Reads the WeSight membership limit from Obsidian. Returns null when Obsidian is unreachable. */
export async function fetchAccess(pairing: PairingRecord): Promise<AccessRecord | null> {
  let response: Response
  try {
    response = await fetch(endpoint(pairing.baseUrl, "/v1/access"), { headers: extensionHeaders(pairing) })
  } catch {
    return null
  }
  if (!response.ok) return null
  const body = await response.text()
  const expectedSignature = await hmacSha256(pairing.secret, body)
  if (!secureEqual(response.headers.get("X-WeSight-Signature") ?? "", expectedSignature)) return null
  const parsed = JSON.parse(body) as { state?: unknown; maxTargets?: unknown; user?: unknown; billing?: unknown }
  if (!ACCESS_STATES.includes(parsed.state as AccessState)) return null
  const maxTargets = parsed.maxTargets === null ? null : Number(parsed.maxTargets)
  const billing = parseMembershipSummary(parsed.billing)
  if (maxTargets !== null && (!Number.isInteger(maxTargets) || maxTargets < 0)) return null
  return { state: parsed.state as AccessState, maxTargets, checkedAt: new Date().toISOString(), user: isWeSightUser(parsed.user) ? parsed.user : null, ...(billing ? { billing } : {}) }
}
