import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import {
  TIER_PARALLELISM,
  TIER_STORAGE_LIMITS,
  TIER_CREDITS,
  PRICE_TO_PLAN,
  STRIPE_PRODUCTS,
  TOP_UPS,
} from "../stripe-config.js"
import { TIER_ORDER } from "../model-availability.js"
import {
  TIER_PIPELINE_PARALLELISM,
  TIER_MAX_PIPELINE_COST_CREDITS,
} from "@nodaro/shared"

// The payg map split (design 2026-07-05 §4.3): ENTITLEMENT maps gain a payg
// key; BILLING maps must NEVER gain one — payg is derived-only, no Stripe
// product, no monthly grant, no admin-assignable value. A payg key leaking
// into a billing map means someone stored the tier, which breaks the whole
// derivation model (multi-writer drift was the rejected alternative).

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8")

describe("payg entitlement maps", () => {
  it("TIER_PARALLELISM.payg = 4 (= basic)", () => {
    expect(TIER_PARALLELISM.payg).toBe(4)
    expect(TIER_PARALLELISM.payg).toBe(TIER_PARALLELISM.basic)
  })

  it("TIER_STORAGE_LIMITS.payg = 10 GB (= basic)", () => {
    expect(TIER_STORAGE_LIMITS.payg).toBe(10 * 1024 * 1024 * 1024)
    expect(TIER_STORAGE_LIMITS.payg).toBe(TIER_STORAGE_LIMITS.basic)
  })

  it("pipeline maps carry payg at basic's values", () => {
    expect(TIER_PIPELINE_PARALLELISM.payg).toBe(TIER_PIPELINE_PARALLELISM.basic)
    expect(TIER_PIPELINE_PARALLELISM.payg).toBe(1)
    expect(TIER_MAX_PIPELINE_COST_CREDITS.payg).toBe(TIER_MAX_PIPELINE_COST_CREDITS.basic)
    expect(TIER_MAX_PIPELINE_COST_CREDITS.payg).toBe(3000)
  })

  it("TIER_ORDER slots payg between free and basic", () => {
    expect(TIER_ORDER).toEqual(["free", "payg", "basic", "standard", "pro", "business"])
  })
})

describe("billing maps must NOT know payg", () => {
  it("TIER_CREDITS has no payg key (no monthly grant exists)", () => {
    expect("payg" in TIER_CREDITS).toBe(false)
  })

  it("PRICE_TO_PLAN / STRIPE_PRODUCTS have no payg entries", () => {
    expect(Object.values(PRICE_TO_PLAN).some((v) => v.plan === "payg")).toBe(false)
    expect("payg" in STRIPE_PRODUCTS).toBe(false)
  })

  it("TOP_UPS maps price ids to grants only — no tier semantics to leak", () => {
    for (const v of Object.values(TOP_UPS)) expect(typeof v).toBe("number")
  })

  it("admin tier enum excludes payg (derived-only; admins set lifetime instead)", () => {
    const adminCredits = read("../../routes/admin-credits.ts")
    expect(adminCredits).toMatch(
      /tier: z\.enum\(\["free", "basic", "standard", "pro", "business"\]\)/
    )
    expect(adminCredits).not.toMatch(/z\.enum\(\[[^\]]*"payg"/)
  })
})

describe("pre-existing map asymmetries stay pinned (audit F9e)", () => {
  it("TIER_STORAGE_LIMITS carries enterprise; TIER_PARALLELISM and TIER_ORDER do not", () => {
    expect("enterprise" in TIER_STORAGE_LIMITS).toBe(true)
    expect("enterprise" in TIER_PARALLELISM).toBe(false)
    expect(TIER_ORDER as readonly string[]).not.toContain("enterprise")
  })

  it("TIER_LLM_LIMITS is deleted (was a dead constant — zero imports)", () => {
    expect(read("../stripe-config.ts")).not.toContain("TIER_LLM_LIMITS")
  })
})
