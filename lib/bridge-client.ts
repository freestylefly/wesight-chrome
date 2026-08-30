import { hmacSha256, randomHex, secureEqual, sha256 } from "~lib/crypto"
import { getLocal, setLocal, STORAGE_KEYS, type PairingRecord } from "~lib/storage"
import {
  isPublishTaskV1,
  type PlatformTaskEventV1,
  type PublishAssetV1,
  type PublishTaskV1
} from "~types/protocol"

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
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ clientId: pairing.clientId, secret: pairing.secret })
  })
  if (!response.ok) throw new Error(`配对失败（HTTP ${response.status}）`)
  await setLocal(STORAGE_KEYS.pairing, pairing)
  return pairing
}

export async function pingBridge(pairing: PairingRecord): Promise<boolean> {
  try {
    const response = await fetch(endpoint(pairing.baseUrl, "/health"), {
      headers: { "X-WeSight-Client": pairing.clientId }
    })
    return response.ok
  } catch {
    return false
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
      "X-WeSight-Client": pairing.clientId
    }
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`读取任务失败（HTTP ${response.status}）`)
  const expectedSignature = await hmacSha256(pairing.secret, body)
  const signature = response.headers.get("X-WeSight-Signature") ?? ""
  if (!secureEqual(signature, expectedSignature)) throw new Error("任务签名校验失败")
  const parsed: unknown = JSON.parse(body)
  if (!isPublishTaskV1(parsed)) throw new Error("任务协议无效或已经过期")
  return parsed
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
        "X-WeSight-Client": pairing.clientId
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
      "X-WeSight-Client": pairing.clientId,
      "X-WeSight-Signature": signature
    },
    body
  })
  if (!response.ok) throw new Error(`回传任务状态失败（HTTP ${response.status}）`)
}
