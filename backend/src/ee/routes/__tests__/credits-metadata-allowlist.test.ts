/**
 * The transaction metadata allowlist can never gain an economics key.
 *
 * The behavioural tests in credits-balance.test.ts prove TODAY's keys are
 * stripped. This proves the RULE: the response projection is allowlist-shaped,
 * and no key whose name is cost/USD/margin-flavoured may enter it. That is the
 * durable half -- a future contributor adding `display_cost` "because the UI
 * needs it" goes red here with the reason attached, instead of re-opening the
 * leak silently.
 *
 * Sibling in spirit to tools/check-pricing-leaks.mjs, which polices the same
 * distinction in packages/../src and docs/: credit prices are the sanctioned
 * public output; $-rate and margin-shaped figures are the leak.
 */
import { describe, it, expect } from "vitest"
import { ALLOWED_TRANSACTION_METADATA_KEYS } from "../credits-balance.js"

const ECONOMICS = /(cost|usd|margin|markup|price|dollar|revenue|profit)/i

describe("GET /v1/credits/transactions metadata allowlist", () => {
  it("contains no economics-shaped key", () => {
    expect(ALLOWED_TRANSACTION_METADATA_KEYS.filter((k) => ECONOMICS.test(k))).toEqual([])
  })

  it("names both spellings of the leaked key as absent (documented, not incidental)", () => {
    expect(ALLOWED_TRANSACTION_METADATA_KEYS).not.toContain("display_cost")
    expect(ALLOWED_TRANSACTION_METADATA_KEYS).not.toContain("display_cost_usd")
  })

  it("is non-empty (the route still returns useful billing mechanics)", () => {
    expect(ALLOWED_TRANSACTION_METADATA_KEYS.length).toBeGreaterThan(0)
    expect(ALLOWED_TRANSACTION_METADATA_KEYS).toContain("from_sub")
  })
})
