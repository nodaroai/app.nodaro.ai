import { describe, it, expect } from "vitest"
import { SCRAPER_CREDIT_COSTS } from "@nodaro/shared/social"
import { TIER_MAX_PIPELINE_COST_CREDITS } from "@nodaro/shared/pipeline"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { TIER_CREDITS } from "../stripe-config.js"

/**
 * `@nodaro/shared` carries copies of prices whose authority lives in
 * `STATIC_CREDIT_COSTS` / `model_pricing`. Their comments say "must stay in
 * sync" — which is not a mechanism, and they duly fell out of sync through the
 * 2026-07-30 ×10 re-denomination: every scraper SKU in shared read a tenth of
 * the real price, and shipped to npm that way.
 *
 * These are the mechanism.
 */
describe("shared credit tables track their backend authority", () => {
  it("SCRAPER_CREDIT_COSTS equals STATIC_CREDIT_COSTS for every SKU", () => {
    let compared = 0
    for (const [id, credits] of Object.entries(SCRAPER_CREDIT_COSTS)) {
      expect(
        STATIC_CREDIT_COSTS[id],
        `SCRAPER_CREDIT_COSTS["${id}"] = ${credits} but STATIC_CREDIT_COSTS says ${STATIC_CREDIT_COSTS[id]} — ` +
          `copy the backend value, do not scale the old one.`,
      ).toBe(credits)
      compared++
    }
    // A sync check that compares nothing passes forever. Fail loudly instead.
    expect(compared, "no scraper SKUs compared — the table emptied").toBeGreaterThan(0)
  })

  it("pipeline cost caps stay a sane fraction of the tier grant they cap", () => {
    // The caps are a share of the monthly grant, so they have to move WITH
    // `TIER_CREDITS`. Pinning the ratio (rather than the number) is what makes
    // a future re-denomination of one but not the other fail here: at the old
    // values against the new grants, basic's cap was 6% of the plan.
    let compared = 0
    for (const [tier, cap] of Object.entries(TIER_MAX_PIPELINE_COST_CREDITS)) {
      const grant = TIER_CREDITS[tier]
      if (grant === undefined || grant === 0 || cap === 0) continue
      const share = cap / grant
      expect(
        share,
        `${tier}: pipeline cap ${cap} is ${(share * 100).toFixed(1)}% of the ${grant}-credit grant — ` +
          `expected roughly half to all of it. One of the two tables missed a re-denomination.`,
      ).toBeGreaterThan(0.25)
      compared++
    }
    expect(compared, "no tiers compared — one of the tables emptied").toBeGreaterThan(0)
  })
})
