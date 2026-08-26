/**
 * Admin-tunable caps and default tier — the two invariants the resolver holds
 * so a bad admin value cannot reach the loop: everything clamped, and the hard
 * timeout DERIVED above the wall clock rather than entered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => state.settings }))

const { mergeTierCaps, resolveEffectiveTierCaps, resolveDefaultTier } = await import("../tier-settings.js")
const { COPILOT_TIERS, DEFAULT_COPILOT_TIER } = await import("../constants.js")

beforeEach(() => {
  state.settings = {}
})

describe("mergeTierCaps", () => {
  const d = COPILOT_TIERS.standard.caps

  it("falls back to the compiled default field-by-field", () => {
    expect(mergeTierCaps(d, undefined)).toEqual(d)
    expect(mergeTierCaps(d, { maxIterations: 30 })).toMatchObject({
      maxIterations: 30,
      maxToolCalls: d.maxToolCalls,
    })
  })

  it("DERIVES the hard timeout as wall + 1 minute — never entered, never invertible", () => {
    const caps = mergeTierCaps(d, { wallClockMinutes: 10 })
    expect(caps.wallClockMs).toBe(10 * 60_000)
    expect(caps.hardTimeoutMs).toBe(11 * 60_000)
    expect(caps.hardTimeoutMs).toBeGreaterThan(caps.wallClockMs)
  })

  it("clamps a zero to the minimum — a turn cap of 0 would wedge every message", () => {
    expect(mergeTierCaps(d, { maxIterations: 0 }).maxIterations).toBe(1)
  })

  it("clamps an enormous value to the maximum", () => {
    expect(mergeTierCaps(d, { maxToolCalls: 99999 }).maxToolCalls).toBe(400)
    expect(mergeTierCaps(d, { wallClockMinutes: 99999 }).wallClockMs).toBe(30 * 60_000)
  })

  it("ignores a non-number", () => {
    expect(mergeTierCaps(d, { maxIterations: "lots" as unknown as number }).maxIterations).toBe(d.maxIterations)
  })
})

describe("resolveEffectiveTierCaps", () => {
  it("returns the compiled defaults when nothing is stored", async () => {
    const caps = await resolveEffectiveTierCaps()
    expect(caps.standard).toEqual(COPILOT_TIERS.standard.caps)
  })

  it("applies the admin override, clamped and derived", async () => {
    state.settings = { copilot_tier_caps: { premium: { maxIterations: 40, wallClockMinutes: 20 } } }
    const caps = await resolveEffectiveTierCaps()
    expect(caps.premium.maxIterations).toBe(40)
    expect(caps.premium.wallClockMs).toBe(20 * 60_000)
    expect(caps.premium.hardTimeoutMs).toBe(21 * 60_000)
    // Untouched tiers keep their defaults.
    expect(caps.economy).toEqual(COPILOT_TIERS.economy.caps)
  })
})

describe("resolveDefaultTier", () => {
  it("is the compiled default when nothing is stored", async () => {
    expect(await resolveDefaultTier()).toBe(DEFAULT_COPILOT_TIER)
  })
  it("is the admin's choice when set", async () => {
    state.settings = { copilot_default_tier: "premium" }
    expect(await resolveDefaultTier()).toBe("premium")
  })
  it("falls back on a junk value rather than trusting it", async () => {
    state.settings = { copilot_default_tier: "ultra" }
    expect(await resolveDefaultTier()).toBe(DEFAULT_COPILOT_TIER)
  })
})
