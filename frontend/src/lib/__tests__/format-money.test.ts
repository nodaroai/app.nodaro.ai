import { describe, it, expect } from "vitest"
import { formatMoney } from "../format-money"

describe("formatMoney", () => {
  it("formats USD with the currency symbol", () => {
    expect(formatMoney({ amount: 12.5, currency: "USD" }, "en-US")).toBe("$12.50")
  })

  it("formats ILS with its symbol via Intl (RTL-safe placement)", () => {
    const out = formatMoney({ amount: 20, currency: "ILS" }, "en-US")
    expect(out).toContain("20")
    expect(out).toMatch(/₪|ILS/)
  })

  it("falls back to 'amount CURRENCY' when the code is unknown (never blanks)", () => {
    expect(formatMoney({ amount: 5, currency: "X××" }, "en-US")).toBe("5.00 X××")
  })
})
