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
 * - The hold is ≥ the metered actual at the default configured pricing factor (refund-only guarantee).
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

describe("hold >= metered actual at default configured pricing factor (refund-only guarantee)", () => {
  it.each(
    (Object.keys(CINEMATIC_RATE_USD_PER_SEC) as CinematicResolution[]).flatMap((resolution) =>
      Array.from(
        { length: CINEMATIC_MAX_DURATION_SEC - CINEMATIC_MIN_DURATION_SEC + 1 },
        (_, i) => ({ resolution, durationSec: CINEMATIC_MIN_DURATION_SEC + i }),
      ),
    ),
  )("$resolution:${durationSec}s — hold >= metered actual @25%", ({ resolution, durationSec }) => {
    const hold = cinematicHoldCredits(resolution, durationSec)
    const providerUsd = cinematicUsdCost(resolution, durationSec)
    // Simulate commitJobCredits/computeActualCredits at default configured pricing factor:
    // base = ceil(usd/0.02); actual = ceil(base * 1.25)
    const baseCredits = Math.ceil(providerUsd / 0.02)
    const actualAtDefaultMarkup = Math.ceil(baseCredits * 1.25)
    expect(
      hold,
      `hold ${hold} < actual ${actualAtDefaultMarkup} for ${resolution}:${durationSec}s — commit_credits can ONLY refund, never charge more`,
    ).toBeGreaterThanOrEqual(actualAtDefaultMarkup)
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

      // Worst-case actual = HeyGen returns the max 15s clip.
      const worstUsd = cinematicUsdCost(resolution, CINEMATIC_MAX_DURATION_SEC)
      const baseCredits = Math.ceil(worstUsd / 0.02)
      const actualAtDefaultMarkup = Math.ceil(baseCredits * 1.25)
      expect(
        reservedHold,
        `autoDuration hold ${reservedHold} < worst-case 15s actual ${actualAtDefaultMarkup} for ${resolution}`,
      ).toBeGreaterThanOrEqual(actualAtDefaultMarkup)
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
