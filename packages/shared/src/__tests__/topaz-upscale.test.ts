import { describe, it, expect } from "vitest"
import { resolveTopazUpscale, buildCreditModelIdentifier } from "../index.js"

describe("resolveTopazUpscale", () => {
  it("defaults to the provider's own default factor when nothing is set", () => {
    const r = resolveTopazUpscale({})
    expect(r.upscaleFactor).toBe("2")
    expect(r.creditTier).toBeUndefined()
    expect(r.adjustments).toEqual([])
  })

  it("takes an explicit factor as the lever and prices it", () => {
    expect(resolveTopazUpscale({ upscaleFactor: "1" })).toMatchObject({ upscaleFactor: "1", creditTier: undefined })
    expect(resolveTopazUpscale({ upscaleFactor: "2" })).toMatchObject({ upscaleFactor: "2", creditTier: undefined })
    expect(resolveTopazUpscale({ upscaleFactor: "4" })).toMatchObject({ upscaleFactor: "4", creditTier: "4K" })
  })

  it("an explicit factor wins over a legacy targetResolution (the factor is what we send)", () => {
    const r = resolveTopazUpscale({ upscaleFactor: "2", targetResolution: "4K" })
    expect(r.upscaleFactor).toBe("2")
    expect(r.creditTier).toBeUndefined()
  })

  it("maps a legacy targetResolution forward when no factor is set", () => {
    expect(resolveTopazUpscale({ targetResolution: "2K" })).toMatchObject({ upscaleFactor: "2", creditTier: undefined })
    expect(resolveTopazUpscale({ targetResolution: "4K" })).toMatchObject({ upscaleFactor: "4", creditTier: "4K" })
  })

  it("caps a legacy 8K request at the 4x the provider actually offers, and says so", () => {
    const r = resolveTopazUpscale({ targetResolution: "8K" })
    expect(r.upscaleFactor).toBe("4")
    expect(r.creditTier).toBe("4K")
    expect(r.adjustments).toHaveLength(1)
    expect(r.adjustments[0]).toMatchObject({ field: "targetResolution", from: "8K", to: "4" })
  })

  it("coerces an out-of-enum factor and records the adjustment", () => {
    const r = resolveTopazUpscale({ upscaleFactor: "8" })
    expect(r.upscaleFactor).toBe("2")
    expect(r.adjustments[0]).toMatchObject({ field: "upscaleFactor", from: "8", to: "2" })
  })

  it("every resolution it can return prices through the existing composites", () => {
    for (const input of [
      {}, { upscaleFactor: "1" }, { upscaleFactor: "2" }, { upscaleFactor: "4" },
      { targetResolution: "2K" }, { targetResolution: "4K" }, { targetResolution: "8K" },
    ]) {
      const { creditTier } = resolveTopazUpscale(input)
      const id = buildCreditModelIdentifier("topaz-image-upscale", undefined, undefined, undefined, creditTier)
      expect(["topaz-image-upscale", "topaz-image-upscale:4K"]).toContain(id)
    }
  })

  // --- Fix round 1 (2026-09-02 review): factor resolved before adjustments
  // are built, `to` always pinned to the resolved factor, `from` always the
  // raw untransformed input, and a valid factor's override of a stored
  // targetResolution is disclosed rather than silently dropped. ---

  it("an invalid factor still lets a legacy tier win, and reports the REAL resolved factor", () => {
    const r = resolveTopazUpscale({ upscaleFactor: "8", targetResolution: "4K" })
    expect(r.upscaleFactor).toBe("4")
    expect(r.creditTier).toBe("4K")
    const factorAdj = r.adjustments.find((a) => a.field === "upscaleFactor")
    expect(factorAdj).toMatchObject({ field: "upscaleFactor", from: "8", to: "4" })
  })

  it("a valid factor overriding a disagreeing legacy tier discloses the override", () => {
    const r = resolveTopazUpscale({ upscaleFactor: "2", targetResolution: "8K" })
    expect(r.upscaleFactor).toBe("2")
    const tierAdj = r.adjustments.find((a) => a.field === "targetResolution")
    expect(tierAdj).toBeDefined()
    expect(tierAdj).toMatchObject({ field: "targetResolution", from: "8K", to: undefined })
  })

  it("a valid factor that agrees with the legacy tier's factor discloses nothing", () => {
    const r = resolveTopazUpscale({ upscaleFactor: "4", targetResolution: "4K" })
    expect(r.upscaleFactor).toBe("4")
    expect(r.adjustments).toEqual([])
  })

  it("an unknown legacy tier alone falls back to the default and reports the raw token", () => {
    const r = resolveTopazUpscale({ targetResolution: "1080p" })
    expect(r.upscaleFactor).toBe("2")
    expect(r.creditTier).toBeUndefined()
    expect(r.adjustments).toHaveLength(1)
    expect(r.adjustments[0]).toMatchObject({ field: "targetResolution", from: "1080p", to: "2" })
  })

  const FACTOR_INPUTS: Array<string | undefined> = [undefined, "2", "4", "8", "foo", " 4 ", "4k"]
  const TIER_INPUTS: Array<string | null | undefined> = [undefined, "2K", "4K", "8K", "4k", "1080p", null]

  describe("factor x targetResolution table", () => {
    for (const upscaleFactor of FACTOR_INPUTS) {
      for (const targetResolution of TIER_INPUTS) {
        const label = `upscaleFactor=${JSON.stringify(upscaleFactor)} targetResolution=${JSON.stringify(targetResolution)}`
        it(`${label} — adjustments never disclose a factor other than the resolved one`, () => {
          const result = resolveTopazUpscale({ upscaleFactor, targetResolution })

          // Every field:"upscaleFactor" adjustment must announce the factor
          // that was ACTUALLY resolved — never an intermediate guess.
          expect(
            result.adjustments.every((a) => a.field !== "upscaleFactor" || a.to === result.upscaleFactor),
          ).toBe(true)

          // `from` is always the raw, untransformed input — never trimmed or
          // case-normalized — for both adjustment kinds.
          for (const adj of result.adjustments) {
            if (adj.field === "upscaleFactor") {
              expect(adj.from).toBe(upscaleFactor)
            } else {
              expect(adj.from).toBe(targetResolution)
            }
          }

          // The resolved factor and credit tier are always internally consistent.
          expect(result.creditTier).toBe(result.upscaleFactor === "4" ? "4K" : undefined)

          // Every resolution this function can produce must still price
          // through an existing composite identifier.
          const id = buildCreditModelIdentifier(
            "topaz-image-upscale",
            undefined,
            undefined,
            undefined,
            result.creditTier,
          )
          expect(["topaz-image-upscale", "topaz-image-upscale:4K"]).toContain(id)
        })
      }
    }
  })
})
