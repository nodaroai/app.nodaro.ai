/**
 * AI Avatar (HeyGen) credit parity test.
 *
 * Guards the 503 trap: every id in AI_AVATAR_RESERVE_IDS MUST exist as a key
 * in STATIC_CREDIT_COSTS. A missing entry causes getModelCreditBaseCost to
 * throw PriceNotConfiguredError → HTTP 503 "price_not_configured" for any
 * legal creditGuard input.
 *
 * Also asserts:
 * - CREDIT_COSTS["ai-avatar"] is defined (node-type resolver for workflow estimation).
 * - The hold is ≥ the metered actual at the default configured pricing factor (refund-only guarantee).
 * - All 30 ids are present (2 engines × 3 resolutions × 5 buckets).
 */

import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS, CREDIT_COSTS } from "../credits.js"
import {
  AI_AVATAR_RESERVE_IDS,
  AI_AVATAR_DURATION_BUCKETS,
  AI_AVATAR_RATE_USD_PER_SEC,
  aiAvatarHoldCredits,
  aiAvatarUsdCost,
  type AiAvatarEngine,
  type AiAvatarResolution,
} from "@nodaro/shared"

describe("AI_AVATAR_RESERVE_IDS parity with STATIC_CREDIT_COSTS", () => {
  it("all 42 reserve ids exist in STATIC_CREDIT_COSTS with a positive hold value", () => {
    expect(AI_AVATAR_RESERVE_IDS).toHaveLength(42)

    const missing: string[] = []
    const wrongValue: string[] = []

    for (const id of AI_AVATAR_RESERVE_IDS) {
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

describe("CREDIT_COSTS[ai-avatar]", () => {
  it("is defined (required for workflow estimation by node type)", () => {
    expect(CREDIT_COSTS["ai-avatar"]).toBeDefined()
    expect(typeof CREDIT_COSTS["ai-avatar"]).toBe("function")
  })
})

describe("hold >= metered actual at default configured pricing factor (refund-only guarantee)", () => {
  it.each(
    (Object.keys(AI_AVATAR_RATE_USD_PER_SEC) as AiAvatarEngine[]).flatMap((engine) =>
      (Object.keys(AI_AVATAR_RATE_USD_PER_SEC[engine]) as AiAvatarResolution[]).flatMap(
        (resolution) =>
          AI_AVATAR_DURATION_BUCKETS.map((bucketSec) => ({ engine, resolution, bucketSec })),
      ),
    ),
  )("$engine:$resolution:${bucketSec}s — hold >= metered actual @25%", ({ engine, resolution, bucketSec }) => {
    const hold = aiAvatarHoldCredits(engine, resolution, bucketSec)
    const providerUsd = aiAvatarUsdCost(engine, resolution, bucketSec)
    // Simulate commitJobCredits/computeActualCredits at default configured pricing factor:
    // base = ceil(usd/0.02); actual = ceil(base * 1.25)
    const baseCredits = Math.ceil(providerUsd / 0.02)
    const actualAtDefaultMarkup = Math.ceil(baseCredits * 1.25)
    expect(
      hold,
      `hold ${hold} < actual ${actualAtDefaultMarkup} for ${engine}:${resolution}:${bucketSec}s — commit_credits can ONLY refund, never charge more`,
    ).toBeGreaterThanOrEqual(actualAtDefaultMarkup)
  })
})

describe("STATIC_CREDIT_COSTS hold values match aiAvatarHoldCredits formula", () => {
  it.each(
    (Object.keys(AI_AVATAR_RATE_USD_PER_SEC) as AiAvatarEngine[]).flatMap((engine) =>
      (Object.keys(AI_AVATAR_RATE_USD_PER_SEC[engine]) as AiAvatarResolution[]).flatMap(
        (resolution) =>
          AI_AVATAR_DURATION_BUCKETS.map((bucketSec) => ({ engine, resolution, bucketSec })),
      ),
    ),
  )("$engine:$resolution:${bucketSec}s — static value matches formula", ({ engine, resolution, bucketSec }) => {
    const id = `heygen-${engine}:${resolution}:${bucketSec}s`
    const expectedHold = aiAvatarHoldCredits(engine, resolution, bucketSec)
    expect(
      STATIC_CREDIT_COSTS[id],
      `STATIC_CREDIT_COSTS["${id}"] = ${STATIC_CREDIT_COSTS[id]}, expected ${expectedHold}`,
    ).toBe(expectedHold)
  })
})
