import { describe, it, expect, afterEach, vi } from "vitest"
import {
  seedanceExtendGenerationModel,
  seedanceExtendDurationWindow,
  buildSeedanceExtendCreditIdentifier,
} from "@/lib/seedance-extend-model.js"

// ---------------------------------------------------------------------------
// SEEDANCE_EXTEND_GENERATION_MODEL — which generation model the
// `seedance-2-extend` provider actually dispatches through.
//
// Three things move together and must never drift apart:
//   the model the worker calls, the duration window it snaps into, and the
//   credit identifier the reservation prices. This module is the single place
//   all three are derived, precisely so the route, the workflow payload
//   builder and the workflow estimate cannot disagree.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("seedanceExtendGenerationModel", () => {
  it("unset ⇒ seedance-2 (today's path)", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", undefined as unknown as string)
    expect(seedanceExtendGenerationModel()).toBe("seedance-2")
  })

  it('"seedance-2-5" ⇒ seedance-2-5', () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
    expect(seedanceExtendGenerationModel()).toBe("seedance-2-5")
  })

  it("anything else ⇒ seedance-2 (fail closed onto today)", () => {
    for (const junk of ["seedance-2-fast", "seedance-2.5", "2.5", "true", ""]) {
      vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", junk)
      expect(seedanceExtendGenerationModel()).toBe("seedance-2")
    }
  })

  it("is read at CALL time, not at module load", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2")
    expect(seedanceExtendGenerationModel()).toBe("seedance-2")
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
    expect(seedanceExtendGenerationModel()).toBe("seedance-2-5")
  })
})

describe("seedanceExtendDurationWindow", () => {
  it("2.0 is 4–15s, 2.5 is 4–30s (each model's native window)", () => {
    expect(seedanceExtendDurationWindow("seedance-2")).toEqual({ min: 4, max: 15 })
    expect(seedanceExtendDurationWindow("seedance-2-5")).toEqual({ min: 4, max: 30 })
  })
})

describe("buildSeedanceExtendCreditIdentifier", () => {
  it("lever unset ⇒ today's seedance-2-extend composite, exactly", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", undefined as unknown as string)
    expect(buildSeedanceExtendCreditIdentifier(8, "720p")).toBe("seedance-2-extend:8s:720p")
    expect(buildSeedanceExtendCreditIdentifier(12, "1080p")).toBe("seedance-2-extend:12s:1080p")
    expect(buildSeedanceExtendCreditIdentifier(6, "480p")).toBe("seedance-2-extend:8s:480p")
    // Defaults mirror the worker's own (8s) and the route's (720p).
    expect(buildSeedanceExtendCreditIdentifier(undefined, undefined)).toBe("seedance-2-extend:8s:720p")
  })

  it("lever on ⇒ prices the model actually dispatched, at the requested resolution", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
    // -ref because the extend transport ALWAYS carries a reference video
    // (the tail, or the previous extension's raw mov).
    expect(buildSeedanceExtendCreditIdentifier(8, "720p")).toBe("seedance-2-5:8s:720p-ref")
    expect(buildSeedanceExtendCreditIdentifier(12, "1080p")).toBe("seedance-2-5:12s:1080p-ref")
    expect(buildSeedanceExtendCreditIdentifier(undefined, undefined)).toBe("seedance-2-5:8s:720p-ref")
  })

  it("lever on ⇒ 2.5 is priced per SECOND, not snapped to the 2.0 tier ladder", () => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
    expect(buildSeedanceExtendCreditIdentifier(6, "480p")).toBe("seedance-2-5:6s:480p-ref")
    expect(buildSeedanceExtendCreditIdentifier(20, "720p")).toBe("seedance-2-5:20s:720p-ref")
  })

  it("2.5 costs strictly MORE than the 2.0 extend composite it replaces", async () => {
    const { STATIC_CREDIT_COSTS } = await import("@/ee/billing/credits.js")
    for (const [d, res] of [[8, "720p"], [12, "480p"], [4, "1080p"]] as const) {
      vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", undefined as unknown as string)
      const before = STATIC_CREDIT_COSTS[buildSeedanceExtendCreditIdentifier(d, res)]
      vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
      const after = STATIC_CREDIT_COSTS[buildSeedanceExtendCreditIdentifier(d, res)]
      // Both must be SEEDED — the credit guard hard-fails an unpriced id.
      expect(before, `2.0 ${d}s ${res}`).toBeTypeOf("number")
      expect(after, `2.5 ${d}s ${res}`).toBeTypeOf("number")
      expect(after!).toBeGreaterThan(before!)
    }
  })

  it("every identifier the lever can emit is seeded (the guard hard-fails otherwise)", async () => {
    const { STATIC_CREDIT_COSTS } = await import("@/ee/billing/credits.js")
    for (const model of ["seedance-2", "seedance-2-5"]) {
      vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", model)
      // The route's wire schema allows duration 1–20 and three resolutions.
      for (let d = 1; d <= 20; d++) {
        for (const res of ["480p", "720p", "1080p"]) {
          const id = buildSeedanceExtendCreditIdentifier(d, res)
          expect(STATIC_CREDIT_COSTS[id], `${model} ${d}s ${res} → ${id}`).toBeTypeOf("number")
        }
      }
    }
  })
})
