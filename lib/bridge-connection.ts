import { getPairing, normalizeBridgeBaseUrl, pingBridge } from "~lib/bridge-client"
import type { PairingRecord } from "~lib/storage"

export const BRIDGE_HEARTBEAT_ALARM = "wesight-obsidian-bridge-heartbeat"

/** Only the loopback bridge page can initiate a pairing or task handoff. */
export function assertBridgeSender(
  baseUrl: string,
  sender: Pick<chrome.runtime.MessageSender, "url">,
  connection = false
): void {
  let source: URL
  try {
    source = new URL(sender.url ?? "")
  } catch {
    throw new Error("本地连接请求来源无效")
  }
  if (source.origin !== normalizeBridgeBaseUrl(baseUrl)
    || source.pathname !== "/wesight-bridge"
    || (connection && source.searchParams.get("connect") !== "1")) {
    throw new Error("本地连接请求来源无效")
  }
}

/** MV3 alarms survive worker suspension without holding the worker open. */
export class BridgeConnectionMonitor {
  private checking: Promise<boolean> | null = null

  async refresh(pairing?: PairingRecord | null): Promise<boolean> {
    if (this.checking) {
      // A new pairing must be checked after any in-flight request for an old port.
      if (pairing !== undefined) {
        await this.checking
        return this.refresh(pairing)
      }
      return this.checking
    }
    const checking = this.check(pairing)
    this.checking = checking
    try {
      return await checking
    } finally {
      if (this.checking === checking) this.checking = null
    }
  }

  private async check(knownPairing?: PairingRecord | null): Promise<boolean> {
    const pairing = knownPairing === undefined ? await getPairing() : knownPairing
    if (!pairing) {
      await chrome.alarms.clear(BRIDGE_HEARTBEAT_ALARM)
      return false
    }
    const connected = await pingBridge(pairing)
    // Retry quietly while Obsidian is closed. An explicit connection checks immediately.
    const minutes = connected ? 1 : 5
    await chrome.alarms.create(BRIDGE_HEARTBEAT_ALARM, {
      delayInMinutes: minutes,
      periodInMinutes: minutes
    })
    return connected
  }

  async resume(): Promise<void> {
    await this.refresh()
  }
}
