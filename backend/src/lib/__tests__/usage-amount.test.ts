// @test-watches supabase/tests/fixtures/usage-charge-cases.json
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { settledCharge, usageAmount } from "../usage-amount.js"

/**
 * The case table is shared with the SQL mirror (`public.usage_log_charge`,
 * proved in `supabase/tests/usage-charge.behavior.sql`), so the two readers
 * cannot drift apart: a case added here is a case the database must answer too.
 */
interface ChargeCase {
  label: string
  status: string
  credits_used: number | null
  credits_charged: number | null
  amount: number | null
  settled: number | null
}
const CASES = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../supabase/tests/fixtures/usage-charge-cases.json", import.meta.url)),
    "utf8",
  ),
) as ChargeCase[]

describe("usage amounts", () => {
  it("has cases to check", () => expect(CASES.length).toBeGreaterThan(4))

  for (const c of CASES) {
    it(`usageAmount: ${c.label}`, () => expect(usageAmount(c)).toBe(c.amount))
    it(`settledCharge: ${c.label}`, () => expect(settledCharge(c)).toBe(c.settled))
  }

  it("keeps an unavailable figure unknown, never 0", () => {
    expect(usageAmount({ status: "committed", credits_used: null })).toBeNull()
    expect(settledCharge({ status: "committed", credits_used: null })).toBeNull()
  })

  it("never reports a settled charge for a row with no status", () => {
    expect(settledCharge({ credits_used: 10 })).toBeNull()
  })
})
