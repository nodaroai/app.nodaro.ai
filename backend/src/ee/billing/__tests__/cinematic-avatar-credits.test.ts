/**
 * Cinematic Avatar (HeyGen) credit parity test.
 *
 * Guards the 503 trap: every id in CINEMATIC_RESERVE_IDS MUST exist as a key
 * in STATIC_CREDIT_COSTS. A missing entry causes getModelCreditBaseCost to
 * throw PriceNotConfiguredError → HTTP 503 "price_not_configured" for any
 * legal creditGuard input.
 *
 * Also asserts:
 * - CREDIT_COSTS["cinematic-avatar"] is defined (node-type resolver for workflow estimation).
 * - The RESERVED amount (markup applied to the stored hold at reserve) is >= the
 *   metered actual (refund-only guarantee). The stored hold is the at-cost 0%-base
 *   value; getModelCreditCostFromDB applies the admin markup to it at reserve time,
 *   so the comparison must mark up BOTH sides.
 * - All 24 ids are present (2 resolutions × 12 durations 4..15s).
 */

import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS, CREDIT_COSTS } from "../credits.js"
import {
  CINEMATIC_RESERVE_IDS,
  CINEMATIC_RATE_USD_PER_SEC,
  CINEMATIC_MIN_DURATION_SEC,
  CINEMATIC_MAX_DURATION_SEC,
  cinematicHoldCredits,
  cinematicUsdCost,
  resolveCinematicCreditId,
  type CinematicResolution,
} from "@nodaro/shared"

const CREDIT_BASE_USD = 0.02
// Runtime reserve: getModelCreditCostFromDB applies the admin markup to the stored hold.
function reservedFromHold(hold: number, markupPct: number): number {
  return markupPct > 0 ? Math.ceil(hold * (1 + markupPct / 100)) : hold
}
// Runtime commit: computeActualCredits(usd) = ceil(ceil(usd/0.02) * markup).
function meteredActual(usd: number, markupPct: number): number {
  const base = Math.ceil(usd / CREDIT_BASE_USD)
  return markupPct > 0 ? Math.ceil(base * (1 + markupPct / 100)) : base
}

describe("CINEMATIC_RESERVE_IDS parity with STATIC_CREDIT_COSTS", () => {
  it("all 24 reserve ids exist in STATIC_CREDIT_COSTS with a positive hold value", () => {
    expect(CINEMATIC_RESERVE_IDS).toHaveLength(24)

    const missing: string[] = []
    const wrongValue: string[] = []

    for (const id of CINEMATIC_RESERVE_IDS) {
      if (STATIC_CREDIT_COSTS[id] === undefined) {
        missing.push(id)
      } else if (STATIC_CREDIT_COSTS[id] <= 0) {
        wrongValue.push(`${id} (value=${STATIC_CREDIT_COSTS[id]})`)
      }
    }

    expect(missing, `Missing from STATIC_CREDIT_COSTS (503 trap): ${missing.join(", ")}`).toHaveLength(0)
    expect(wrongValue, `Non-positive hold values: ${wrongValue.join(", ")}`).toHaveLength(0)
  })
})

describe("CREDIT_COSTS[cinematic-avatar]", () => {
  it("is defined (required for workflow estimation by node type)", () => {
    expect(CREDIT_COSTS["cinematic-avatar"]).toBeDefined()
    expect(typeof CREDIT_COSTS["cinematic-avatar"]).toBe("function")
  })
})

describe("reserved >= metered actual at default configured pricing factor (refund-only guarantee)", () => {
  it.each(
    (Object.keys(CINEMATIC_RATE_USD_PER_SEC) as CinematicResolution[]).flatMap((resolution) =>
      Array.from(
        { length: CINEMATIC_MAX_DURATION_SEC - CINEMATIC_MIN_DURATION_SEC + 1 },
        (_, i) => ({ resolution, durationSec: CINEMATIC_MIN_DURATION_SEC + i }),
      ),
    ),
  )("$resolution:${durationSec}s — reserved >= metered actual @25%", ({ resolution, durationSec }) => {
    const reserved = reservedFromHold(cinematicHoldCredits(resolution, durationSec), 25)
    const providerUsd = cinematicUsdCost(resolution, durationSec)
    const actual = meteredActual(providerUsd, 25)
    expect(
      reserved,
      `reserved ${reserved} < actual ${actual} for ${resolution}:${durationSec}s — commit_credits can ONLY refund, never charge more`,
    ).toBeGreaterThanOrEqual(actual)
    // Exact-duration → reserved EQUALS actual (minimal-safe, no over-reserve).
    expect(reserved).toBe(actual)
  })
})

describe("autoDuration reserve preserves the refund-only guarantee", () => {
  // When autoDuration is on, the provider drops `duration` and HeyGen picks the
  // clip length — which can be longer than the requested/default 10s. The metered
  // true-up (commit_credits) can ONLY refund a surplus, never charge more, so the
  // reserve MUST be the ceiling (15s) hold. Assert that the 15s actual at the
  // default configured pricing factor never exceeds the autoDuration reserve hold.
  it.each(Object.keys(CINEMATIC_RATE_USD_PER_SEC) as CinematicResolution[])(
    "%s — autoDuration reserves at the 15s ceiling; max 15s actual <= reserved hold",
    (resolution) => {
      const reserveId = resolveCinematicCreditId({ resolution, autoDuration: true })
      expect(reserveId).toBe(`cinematic-avatar:${resolution}:${CINEMATIC_MAX_DURATION_SEC}s`)

      const reservedHold = STATIC_CREDIT_COSTS[reserveId]
      expect(reservedHold).toBe(cinematicHoldCredits(resolution, CINEMATIC_MAX_DURATION_SEC))

      // Worst-case actual = HeyGen returns the max 15s clip. Mark up BOTH the
      // stored hold (reserve-time) and the worst-case usd (commit-time).
      const reserved = reservedFromHold(reservedHold, 25)
      const worstUsd = cinematicUsdCost(resolution, CINEMATIC_MAX_DURATION_SEC)
      const actual = meteredActual(worstUsd, 25)
      expect(
        reserved,
        `autoDuration reserved ${reserved} < worst-case 15s actual ${actual} for ${resolution}`,
      ).toBeGreaterThanOrEqual(actual)
    },
  )

  it("does NOT shrink the hold to the default-10s reserve when a stale short duration lingers", () => {
    // Regression guard for the billing leak: a 720p:10s hold (113) would NOT
    // cover a 13s+ auto clip (123+). The autoDuration reserve must be 15s (142).
    const stale = { resolution: "720p" as const, duration: 4, autoDuration: true }
    expect(resolveCinematicCreditId(stale)).toBe("cinematic-avatar:720p:15s")
    expect(STATIC_CREDIT_COSTS["cinematic-avatar:720p:15s"]).toBeGreaterThan(
      STATIC_CREDIT_COSTS["cinematic-avatar:720p:10s"],
    )
  })
})

describe("STATIC_CREDIT_COSTS hold values match cinematicHoldCredits formula", () => {
  it.each(
    (Object.keys(CINEMATIC_RATE_USD_PER_SEC) as CinematicResolution[]).flatMap((resolution) =>
      Array.from(
        { length: CINEMATIC_MAX_DURATION_SEC - CINEMATIC_MIN_DURATION_SEC + 1 },
        (_, i) => ({ resolution, durationSec: CINEMATIC_MIN_DURATION_SEC + i }),
      ),
    ),
  )("$resolution:${durationSec}s — static value matches formula", ({ resolution, durationSec }) => {
    const id = `cinematic-avatar:${resolution}:${durationSec}s`
    const expectedHold = cinematicHoldCredits(resolution, durationSec)
    expect(
      STATIC_CREDIT_COSTS[id],
      `STATIC_CREDIT_COSTS["${id}"] = ${STATIC_CREDIT_COSTS[id]}, expected ${expectedHold}`,
    ).toBe(expectedHold)
  })
})
