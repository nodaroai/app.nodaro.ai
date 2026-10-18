import { describe, it, expect } from "vitest"
import {
  resolveStoredTier,
  resolveEffectiveTier,
  isPaygRetentionActive,
  PAYG_RETENTION_DAYS,
} from "../effective-tier.js"

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date("2026-08-12T12:00:00Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS)

describe("resolveStoredTier", () => {
  it("prefers tier, falls back to subscription_tier, then free", () => {
    expect(resolveStoredTier({ tier: "pro", subscription_tier: "basic" })).toBe("pro")
    expect(resolveStoredTier({ tier: null, subscription_tier: "basic" })).toBe("basic")
    expect(resolveStoredTier({ tier: null, subscription_tier: null })).toBe("free")
  })
})

describe("resolveEffectiveTier — the payg derivation matrix (design §9)", () => {
  it("never-paid free user stays free", () => {
    // NET lifetime 0 is also what a refunded-to-zero user and the #489
    // pre-subscribe carryover (a topup balance with NO purchase) have, so
    // this one case pins all three: none of them may derive payg.
    expect(
      resolveEffectiveTier({ tier: "free", subscription_tier: null, lifetime_topup_credits: 0 })
    ).toBe("free")
  })

  it("free user with NET lifetime > 0 derives payg — even at zero current balance", () => {
    expect(
      resolveEffectiveTier({ tier: "free", subscription_tier: null, lifetime_topup_credits: 3300 })
    ).toBe("payg")
  })

  it("every stored paid tier passes through untouched, regardless of lifetime", () => {
    for (const t of ["basic", "standard", "pro", "business"]) {
      expect(
        resolveEffectiveTier({ tier: t, subscription_tier: null, lifetime_topup_credits: 9999 })
      ).toBe(t)
    }
  })

  it("subscription_tier-only legacy rows resolve through the stored fallback", () => {
    expect(
      resolveEffectiveTier({ tier: null, subscription_tier: "standard", lifetime_topup_credits: 500 })
    ).toBe("standard")
  })

  it("null-tier never-paid rows resolve free; with lifetime they derive payg", () => {
    expect(
      resolveEffectiveTier({ tier: null, subscription_tier: null, lifetime_topup_credits: 0 })
    ).toBe("free")
    expect(
      resolveEffectiveTier({ tier: null, subscription_tier: null, lifetime_topup_credits: 100 })
    ).toBe("payg")
  })
})

describe("isPaygRetentionActive — 90-day activity window boundaries", () => {
  it("exports the 90-day constant", () => {
    expect(PAYG_RETENTION_DAYS).toBe(90)
  })

  it("purchase activity: 89d active, 90d active (inclusive), 91d inactive", () => {
    const base = { lifetimeTopupCredits: 100, lastSpendAt: null }
    expect(isPaygRetentionActive({ ...base, lastTopupAt: daysAgo(89) }, NOW)).toBe(true)
    expect(isPaygRetentionActive({ ...base, lastTopupAt: daysAgo(90) }, NOW)).toBe(true)
    expect(isPaygRetentionActive({ ...base, lastTopupAt: daysAgo(91) }, NOW)).toBe(false)
  })

  it("spend activity counts on its own (usage_logs MAX, not balance polls)", () => {
    const base = { lifetimeTopupCredits: 100, lastTopupAt: daysAgo(200) }
    expect(isPaygRetentionActive({ ...base, lastSpendAt: daysAgo(10) }, NOW)).toBe(true)
    expect(isPaygRetentionActive({ ...base, lastSpendAt: daysAgo(91) }, NOW)).toBe(false)
  })

  it("either source alone is sufficient; the most recent wins", () => {
    expect(
      isPaygRetentionActive(
        { lifetimeTopupCredits: 100, lastTopupAt: daysAgo(120), lastSpendAt: daysAgo(5) },
        NOW
      )
    ).toBe(true)
  })

  it("string timestamps (supabase rows) are accepted", () => {
    expect(
      isPaygRetentionActive(
        { lifetimeTopupCredits: 100, lastTopupAt: daysAgo(5).toISOString(), lastSpendAt: null },
        NOW
      )
    ).toBe(true)
  })

  it("all-null activity is inactive; never-paid users are never retention-active", () => {
    expect(
      isPaygRetentionActive({ lifetimeTopupCredits: 100, lastTopupAt: null, lastSpendAt: null }, NOW)
    ).toBe(false)
    expect(
      isPaygRetentionActive({ lifetimeTopupCredits: 0, lastTopupAt: daysAgo(1), lastSpendAt: null }, NOW)
    ).toBe(false)
  })
})
