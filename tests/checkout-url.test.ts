import { membershipCheckoutUrl, safeCheckoutUrl } from "~lib/cloud-auth"

describe("membership checkout url", () => {
  test("uses the billing summary page on wesight.ai and tags the source", () => {
    const url = new URL(membershipCheckoutUrl({ state: "single-platform", maxTargets: 1, checkedAt: "", checkoutUrl: "https://pay.wesight.ai/billing?plan=month" }))
    expect(url.origin).toBe("https://pay.wesight.ai")
    expect(url.searchParams.get("plan")).toBe("month")
    expect(url.searchParams.get("source")).toBe("chrome-extension")
  })
  test("falls back to the default billing page for missing or foreign urls", () => {
    expect(membershipCheckoutUrl(null)).toBe("https://pay.wesight.ai/billing?source=chrome-extension")
    expect(safeCheckoutUrl("https://evil.example.com/pay")).toBeUndefined()
    expect(safeCheckoutUrl("http://pay.wesight.ai/billing")).toBeUndefined()
    expect(safeCheckoutUrl("https://evilwesight.ai/")).toBeUndefined()
  })
})
