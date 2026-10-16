// @test-watches frontend/src/lib/pricing-data.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { TIER_CREDITS } from "../stripe-config.js"

// The welcome popup shows the server's figure (`welcomeOffer.credits`), but the
// login page and the withheld-grant banner still read the frontend's
// FREE_TIER_CREDITS, derived from PRICING_TIERS' free row. A reprice that moves
// one and not the other has the app quote two different signup grants.
describe("frontend free-tier grant mirror", () => {
  it("PRICING_TIERS' free row carries TIER_CREDITS.free", () => {
    const fe = readFileSync(path.resolve(__dirname, "../../../../../frontend/src/lib/pricing-data.ts"), "utf8")
    const freeRow = fe.match(/id:\s*"free",[\s\S]*?credits:\s*([\d_]+)\s*,/)
    expect(freeRow, "PRICING_TIERS has no free row with a credits figure").not.toBeNull()
    expect(Number(freeRow![1]!.replace(/_/g, ""))).toBe(TIER_CREDITS.free)
  })
})
