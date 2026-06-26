/**
 * Beeble SwitchX relight — pricing-seed completeness guard.
 *
 * SwitchX bills via the bespoke composite `beeble-switchx:<tier>f:<res>p`
 * (frame-tier × resolution). Unlike the standard provider+duration video ids,
 * NO walker test asserts these holds exist — so a missing seed would surface
 * only as a runtime PriceNotConfiguredError → HTTP 503 "price_not_configured"
 * for a legal creditGuard input. This test makes the seed (8 block tiers × 2
 * resolutions + the bare worst-case id) CI-enforced:
 *
 * - Every (tier ∈ SWITCHX_FRAME_TIERS) × (res ∈ {720,1080}) composite exists in
 *   STATIC_CREDIT_COSTS with a positive hold value (the 503 trap).
 * - The bare `beeble-switchx` worst-case default equals the 240f/1080p value
 *   (the resolver falls back to the bare id when no frame count is probed; the
 *   240f/1080p ceiling is the worst case, so the bare hold must match it).
 * - CREDIT_COSTS["switchx"] is defined (node-type resolver for workflow
 *   credit estimation).
 *
 * Values are ANCHORED to Beeble's published per-30-frame-block rate (migration
 * 241); this guard intentionally checks presence/positivity + the bare↔240f/1080p
 * invariant, NOT the exact numbers, so a future re-price stays a 1-file change
 * without flipping this test red.
 */

import { describe, it, expect } from "vitest"
import { SWITCHX_FRAME_TIERS } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS, CREDIT_COSTS } from "../credits.js"

const RESOLUTIONS = [720, 1080] as const

describe("SwitchX composite pricing seeds", () => {
  it.each(
    RESOLUTIONS.flatMap((res) =>
      SWITCHX_FRAME_TIERS.map((tier) => ({ tier, res })),
    ),
  )(
    'STATIC_CREDIT_COSTS["beeble-switchx:$tierf:$resp"] is a positive number',
    ({ tier, res }) => {
      const id = `beeble-switchx:${tier}f:${res}p`
      const value = STATIC_CREDIT_COSTS[id]
      expect(
        typeof value,
        `${id} missing from STATIC_CREDIT_COSTS (503 trap)`,
      ).toBe("number")
      expect(
        value,
        `${id} must be a positive hold value, got ${value}`,
      ).toBeGreaterThan(0)
    },
  )

  it("bare `beeble-switchx` equals the 240f/1080p worst-case value", () => {
    const bare = STATIC_CREDIT_COSTS["beeble-switchx"]
    const worstCase = STATIC_CREDIT_COSTS["beeble-switchx:240f:1080p"]
    expect(typeof bare, "bare beeble-switchx missing from STATIC_CREDIT_COSTS").toBe(
      "number",
    )
    expect(bare).toBeGreaterThan(0)
    expect(
      bare,
      `bare beeble-switchx (${bare}) must equal the 240f/1080p ceiling (${worstCase}) — it is the no-frame-count worst-case fallback`,
    ).toBe(worstCase)
  })
})

describe("CREDIT_COSTS[switchx]", () => {
  it("is defined (required for workflow credit estimation by node type)", () => {
    expect(CREDIT_COSTS["switchx"]).toBeDefined()
    expect(typeof CREDIT_COSTS["switchx"]).toBe("function")
  })
})
