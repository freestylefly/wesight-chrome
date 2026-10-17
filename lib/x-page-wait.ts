/**
 * Wait budget for X's single-page app. Time only counts while the tab is
 * visible: when several platforms open at once the X tab sits in the
 * background, where X may not render its Post window until it is shown.
 */
export function visibleWaitBudget(visibleMs: number, onHidden?: () => void, maxMs = 30 * 60_000): () => boolean {
  const start = Date.now()
  let last = start, used = 0, notified = false
  return () => {
    const now = Date.now()
    if (document.visibilityState === "hidden") {
      if (!notified) { notified = true; onHidden?.() }
    } else used += now - last
    last = now
    return used < visibleMs && now - start < maxMs
  }
}
