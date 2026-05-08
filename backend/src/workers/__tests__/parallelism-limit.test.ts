/**
 * L2#5 — Tier parallelism cap.
 *
 * `getParallelismLimit(tier)` in `orchestrator-worker.ts` is the single
 * choke point that decides "how many node jobs can this user's workflow
 * fan out concurrently within one execution level". The contract:
 *
 *   - Cloud edition (`hasCredits()` true): `min(TIER_PARALLELISM[tier], env ceiling)`
 *   - Self-hosted (`hasCredits()` false): env ceiling, ignoring tier
 *   - Unknown tier: falls back to "free" tier's limit
 *
 * Drift here causes resource over-fanout (overload Redis/BullMQ) or
 * starvation (paying users get free-tier parallelism).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock supabase + admin-check (transitive imports of orchestrator-worker)
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))
// Hoisted mocks must be declared upfront — but we want to switch isCloud /
// isCommunity per test, so use vi.hoisted() to hold a settable state.
const editionState = vi.hoisted(() => ({ hasCredits: true }))
vi.mock("@/lib/config.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config.js")>("@/lib/config.js")
  return {
    ...actual,
    hasCredits: () => editionState.hasCredits,
  }
})

import { getParallelismLimit } from "../orchestrator-worker.js"
import { TIER_PARALLELISM } from "../../ee/billing/stripe-config.js"
import { config } from "../../lib/config.js"

const ENV_CEILING = config.MAX_CONCURRENT_NODES_PER_EXECUTION

beforeEach(() => {
  editionState.hasCredits = true
})

// ---------------------------------------------------------------------------
// Test 1 — TIER_PARALLELISM shape and monotonicity invariants.
// ---------------------------------------------------------------------------

describe("TIER_PARALLELISM constants", () => {
  it("includes all five known tiers", () => {
    expect(TIER_PARALLELISM.free).toBeDefined()
    expect(TIER_PARALLELISM.basic).toBeDefined()
    expect(TIER_PARALLELISM.standard).toBeDefined()
    expect(TIER_PARALLELISM.pro).toBeDefined()
    expect(TIER_PARALLELISM.business).toBeDefined()
  })

  it("each tier limit is a positive integer", () => {
    for (const [tier, limit] of Object.entries(TIER_PARALLELISM)) {
      expect(limit, `${tier} parallelism must be ≥ 1`).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(limit), `${tier} parallelism must be an integer`).toBe(true)
    }
  })

  it("higher tiers grant ≥ parallelism than lower tiers (monotonic)", () => {
    expect(TIER_PARALLELISM.basic).toBeGreaterThanOrEqual(TIER_PARALLELISM.free)
    expect(TIER_PARALLELISM.standard).toBeGreaterThanOrEqual(TIER_PARALLELISM.basic)
    expect(TIER_PARALLELISM.pro).toBeGreaterThanOrEqual(TIER_PARALLELISM.standard)
    expect(TIER_PARALLELISM.business).toBeGreaterThanOrEqual(TIER_PARALLELISM.pro)
  })
})

// ---------------------------------------------------------------------------
// Test 2 — Cloud edition: limit = min(tier, ceiling).
// ---------------------------------------------------------------------------

describe("getParallelismLimit — cloud edition", () => {
  it.each(Object.keys(TIER_PARALLELISM))(
    'tier "%s" returns min(TIER_PARALLELISM, ENV_CEILING)',
    (tier) => {
      const expected = Math.min(TIER_PARALLELISM[tier], ENV_CEILING)
      expect(getParallelismLimit(tier)).toBe(expected)
    },
  )

  it("unknown tier defaults to free", () => {
    const expected = Math.min(TIER_PARALLELISM.free, ENV_CEILING)
    expect(getParallelismLimit("ULTRA_PREMIUM_DOES_NOT_EXIST")).toBe(expected)
  })

  it("undefined tier defaults to free", () => {
    const expected = Math.min(TIER_PARALLELISM.free, ENV_CEILING)
    expect(getParallelismLimit(undefined)).toBe(expected)
  })

  it("never exceeds the env ceiling for any tier (even hypothetical Infinity)", () => {
    for (const tier of Object.keys(TIER_PARALLELISM)) {
      expect(getParallelismLimit(tier)).toBeLessThanOrEqual(ENV_CEILING)
    }
  })
})

// ---------------------------------------------------------------------------
// Test 3 — Self-hosted: limit = env ceiling, tier ignored entirely.
// ---------------------------------------------------------------------------

describe("getParallelismLimit — self-hosted edition", () => {
  beforeEach(() => {
    editionState.hasCredits = false
  })

  it("returns the env ceiling regardless of tier", () => {
    expect(getParallelismLimit("free")).toBe(ENV_CEILING)
    expect(getParallelismLimit("business")).toBe(ENV_CEILING)
    expect(getParallelismLimit(undefined)).toBe(ENV_CEILING)
    expect(getParallelismLimit("nonexistent-tier")).toBe(ENV_CEILING)
  })
})
