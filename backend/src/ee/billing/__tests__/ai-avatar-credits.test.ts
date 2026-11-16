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
 * - The RESERVED amount (markup applied to the stored hold at reserve) is >= the
 *   metered actual at the bucket ceiling (refund-only guarantee). The stored hold
 *   is the base value; getModelCreditCostFromDB applies the admin
 *   markup to it at reserve time, so the comparison must mark up BOTH sides.
 * - All 60 ids are present (2 engines × 3 resolutions × 10 buckets).
 */

import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS, CREDIT_COSTS, CreditsService, getNodeModelIdentifier } from "../credits.js"
import { AI_AVATAR_RESERVE_IDS, AI_AVATAR_DURATION_BUCKETS, type AiAvatarEngine, type AiAvatarResolution } from "@nodaro/shared/credits"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { AI_AVATAR_RATE_USD_PER_SEC, aiAvatarHoldCredits, aiAvatarUsdCost } from "../../../lib/pricing/ai-avatar-cost.js"


// Runtime reserve: getModelCreditCostFromDB applies the admin markup to the
// STORED hold value (the base aiAvatarHoldCredits).
function reservedFromHold(hold: number, markupPct: number): number {
  return markupPct > 0 ? Math.ceil(hold * (1 + markupPct / 100)) : hold
}
// Runtime commit: computeActualCredits(usd) = ceil(ceil(usd/0.02) * markup).
function meteredActual(usd: number, markupPct: number): number {
  const base = Math.ceil(usd / CREDIT_BASE_USD)
  return markupPct > 0 ? Math.ceil(base * (1 + markupPct / 100)) : base
}

describe("AI_AVATAR_RESERVE_IDS parity with STATIC_CREDIT_COSTS", () => {
  it("all 60 reserve ids exist in STATIC_CREDIT_COSTS with a positive hold value", () => {
    expect(AI_AVATAR_RESERVE_IDS).toHaveLength(60)

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

  it("is the id the server's run estimate prices the node on: the bucket its run holds, never the bare node type (priced nowhere: 0)", () => {
    const prices = { base: (id: string) => STATIC_CREDIT_COSTS[id], charge: (_id: string, base: number) => base }
    const lineOf = (data: Record<string, unknown>) => {
      let line: number | undefined
      CreditsService.estimateWorkflowCreditsAt(prices as never, [{ id: "c", type: "ai-avatar", data }], [], undefined, (id, credits) => { if (id === "c") line = credits })
      return line
    }
    for (const data of [
      { speechMode: "audio", engine: "avatar-iv", resolution: "720p" },
      { speechMode: "audio", engine: "avatar-v", resolution: "1080p" },
      { speechMode: "text", script: "x".repeat(600), engine: "avatar-iv", resolution: "720p" },
      {},
    ]) {
      expect(getNodeModelIdentifier({ type: "ai-avatar", data })).toBe(CREDIT_COSTS["ai-avatar"]!(data))
      expect(lineOf(data)).toBe(STATIC_CREDIT_COSTS[CREDIT_COSTS["ai-avatar"]!(data)])
      expect(lineOf(data)).toBeGreaterThan(0)
    }
    // Audio mode, nothing measured before the run: the 120-second hold.
    expect(getNodeModelIdentifier({ type: "ai-avatar", data: { speechMode: "audio" } })).toBe("heygen-avatar-iv:720p:120s")
  })
})

describe("reserved >= metered actual at the bucket ceiling (refund-only guarantee)", () => {
  it.each(
    (Object.keys(AI_AVATAR_RATE_USD_PER_SEC) as AiAvatarEngine[]).flatMap((engine) =>
      (Object.keys(AI_AVATAR_RATE_USD_PER_SEC[engine]) as AiAvatarResolution[]).flatMap(
        (resolution) =>
          AI_AVATAR_DURATION_BUCKETS.map((bucketSec) => ({ engine, resolution, bucketSec })),
      ),
    ),
  )("$engine:$resolution:${bucketSec}s — reserved >= metered actual @25%", ({ engine, resolution, bucketSec }) => {
    const hold = aiAvatarHoldCredits(engine, resolution, bucketSec)
    const reserved = reservedFromHold(hold, 25)
    const usdAtCeiling = aiAvatarUsdCost(engine, resolution, bucketSec)
    const actual = meteredActual(usdAtCeiling, 25)
    expect(
      reserved,
      `reserved ${reserved} < actual ${actual} for ${engine}:${resolution}:${bucketSec}s — commit_credits can ONLY refund, never charge more`,
    ).toBeGreaterThanOrEqual(actual)
    // At the ceiling the bases coincide, so reserved must EQUAL actual (minimal-safe, no over-reserve).
    expect(reserved).toBe(actual)
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
