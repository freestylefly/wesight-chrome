import { assertBridgeSender, BRIDGE_HEARTBEAT_ALARM, BridgeConnectionMonitor } from "~lib/bridge-connection"
import type { PairingRecord } from "~lib/storage"

const mocks = vi.hoisted(() => ({ getPairing: vi.fn(), pingBridge: vi.fn() }))
vi.mock("~lib/bridge-client", async importOriginal => {
  const original = await importOriginal<typeof import("~lib/bridge-client")>()
  return { ...original, ...mocks }
})

const pairing: PairingRecord = {
  clientId: "a".repeat(32), secret: "b".repeat(64),
  baseUrl: "http://127.0.0.1:34567", pairedAt: "2026-10-15T00:00:00Z"
}
const create = vi.fn(), clear = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getPairing.mockResolvedValue(pairing)
  mocks.pingBridge.mockResolvedValue(true)
  vi.stubGlobal("chrome", { alarms: { create, clear } })
})
afterEach(() => vi.unstubAllGlobals())

describe("local bridge connection", () => {
  test("accepts a connection only from its loopback bridge page", () => {
    expect(() => assertBridgeSender(pairing.baseUrl, { url: `${pairing.baseUrl}/wesight-bridge?connect=1` }, true)).not.toThrow()
    for (const url of [
      "https://example.com/wesight-bridge?connect=1",
      "http://127.0.0.1:34568/wesight-bridge?connect=1",
      `${pairing.baseUrl}/other?connect=1`,
      `${pairing.baseUrl}/wesight-bridge?taskId=task`,
      undefined
    ]) expect(() => assertBridgeSender(pairing.baseUrl, { url }, true)).toThrow("来源无效")
  })

  test("still accepts signed task handoffs from the matching bridge origin", () => {
    expect(() => assertBridgeSender(pairing.baseUrl, { url: `${pairing.baseUrl}/wesight-bridge?taskId=one` })).not.toThrow()
    expect(() => assertBridgeSender("https://example.com", { url: "https://example.com/wesight-bridge" })).toThrow("地址无效")
  })

  test("restores pairing after worker startup and schedules a one-minute heartbeat", async () => {
    await new BridgeConnectionMonitor().resume()
    expect(mocks.pingBridge).toHaveBeenCalledWith(pairing)
    expect(create).toHaveBeenCalledWith(BRIDGE_HEARTBEAT_ALARM, { delayInMinutes: 1, periodInMinutes: 1 })
  })

  test("backs off while Obsidian is closed, retaining pairing for automatic recovery", async () => {
    mocks.pingBridge.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const monitor = new BridgeConnectionMonitor()
    expect(await monitor.refresh()).toBe(false)
    expect(create).toHaveBeenLastCalledWith(BRIDGE_HEARTBEAT_ALARM, { delayInMinutes: 5, periodInMinutes: 5 })
    expect(await monitor.refresh()).toBe(true)
    expect(create).toHaveBeenLastCalledWith(BRIDGE_HEARTBEAT_ALARM, { delayInMinutes: 1, periodInMinutes: 1 })
  })

  test("clears heartbeat when no pairing has been saved", async () => {
    mocks.getPairing.mockResolvedValue(null)
    expect(await new BridgeConnectionMonitor().refresh()).toBe(false)
    expect(mocks.pingBridge).not.toHaveBeenCalled()
    expect(clear).toHaveBeenCalledWith(BRIDGE_HEARTBEAT_ALARM)
    expect(create).not.toHaveBeenCalled()
  })

  test("a newly confirmed pairing is checked after an old in-flight heartbeat", async () => {
    let finish!: (value: boolean) => void
    mocks.pingBridge.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve }))
    const monitor = new BridgeConnectionMonitor()
    const pending = monitor.refresh(pairing)
    const replacement = { ...pairing, baseUrl: "http://127.0.0.1:34568", secret: "c".repeat(64) }
    const connected = monitor.refresh(replacement)
    finish(false)
    await expect(pending).resolves.toBe(false)
    await expect(connected).resolves.toBe(true)
    expect(mocks.pingBridge).toHaveBeenLastCalledWith(replacement)
    expect(create).toHaveBeenLastCalledWith(BRIDGE_HEARTBEAT_ALARM, { delayInMinutes: 1, periodInMinutes: 1 })
  })
})
