import { visibleWaitBudget } from "~lib/x-page-wait"

let visibility: DocumentVisibilityState = "visible"
beforeEach(() => {
  vi.useFakeTimers()
  visibility = "visible"
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test("background time does not use up the wait, and the hidden notice fires once", () => {
  const onHidden = vi.fn()
  const waiting = visibleWaitBudget(20_000, onHidden)
  visibility = "hidden"
  for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(60_000); expect(waiting()).toBe(true) }
  expect(onHidden).toHaveBeenCalledTimes(1)
  visibility = "visible"
  vi.advanceTimersByTime(19_000); expect(waiting()).toBe(true)
  vi.advanceTimersByTime(2_000); expect(waiting()).toBe(false)
})

test("a tab left in the background still stops after the overall cap", () => {
  const waiting = visibleWaitBudget(20_000, undefined, 30 * 60_000)
  visibility = "hidden"
  vi.advanceTimersByTime(29 * 60_000); expect(waiting()).toBe(true)
  vi.advanceTimersByTime(2 * 60_000); expect(waiting()).toBe(false)
})
