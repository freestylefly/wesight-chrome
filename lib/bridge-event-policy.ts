import type { BridgeTaskAccess } from "~lib/storage"
import type { PlatformId } from "~types/protocol"

/** An older bridge task cannot accept destinations added in the browser. */
export function shouldMirrorBridgeEvent(bridge: BridgeTaskAccess, platformId: PlatformId): boolean {
  // Older stored records do not identify the authorized destinations. Keep their
  // local publishing resumable, and resume mirroring after the next handoff.
  return bridge.targets?.includes(platformId) === true
}
