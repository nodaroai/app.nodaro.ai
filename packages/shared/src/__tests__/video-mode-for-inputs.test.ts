import { describe, expect, it } from "vitest"
import {
  VIDEO_MODE_ALIASES,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  resolveVideoModeForInputs,
  resolveVideoProviderForMode,
} from "../model-constants.js"

/**
 * #861 — reference images wired to Grok Imagine 1 without a start frame were
 * silently dropped: the run resolved to text-to-video, the t2v twin (`grok`)
 * has no image parameter, and nothing said so. The mode must follow what the
 * model can CARRY, derived from the catalog's reference caps — not a name.
 */
const I2V = "image-to-video"
const T2V = "text-to-video"

describe("resolveVideoModeForInputs", () => {
  it("a start frame is image-to-video for every provider", () => {
    for (const id of ["grok-i2v", "grok", "seedance-2", "kling", "veo3", "wan-i2v", undefined]) {
      expect(resolveVideoModeForInputs(id, { hasStartFrame: true, hasImageRefs: false })).toBe(I2V)
      expect(resolveVideoModeForInputs(id, { hasStartFrame: true, hasImageRefs: true })).toBe(I2V)
    }
  })

  it("nothing wired is text-to-video", () => {
    expect(resolveVideoModeForInputs("grok-i2v", { hasStartFrame: false, hasImageRefs: false })).toBe(T2V)
    expect(resolveVideoModeForInputs(undefined, { hasStartFrame: false, hasImageRefs: true })).toBe(T2V)
  })

  it("refs alone route Grok Imagine 1 to its i2v twin — the only one that can carry them (#861)", () => {
    // Whichever member id the node stored (base/i2v/t2v all appear in old workflows).
    for (const id of ["grok-i2v", "grok"]) {
      expect(resolveVideoModeForInputs(id, { hasStartFrame: false, hasImageRefs: true })).toBe(I2V)
    }
    // The premise, pinned: i2v carries refs, t2v does not.
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["grok-i2v"]?.images).toBeGreaterThan(0)
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["grok"]).toBeUndefined()
  })

  it("single-id models are untouched: the same id serves both modes, so there is nothing to re-route", () => {
    // seedance-2 / gemini-omni-video / veo forward refs on their t2v path
    // (generate-video.md mode table). kling-3-omni is i2v-only and keeps its
    // documented orchestrator behavior (image_required on the t2v path) —
    // whether refs alone should satisfy it is a separate question from #861.
    for (const id of ["seedance-2", "gemini-omni-video", "veo3.1", "kling-3-omni"]) {
      expect(resolveVideoModeForInputs(id, { hasStartFrame: false, hasImageRefs: true })).toBe(T2V)
    }
  })

  it("a split-id model with no ref support on either twin is unaffected (wan, happyhorse)", () => {
    for (const id of ["wan-i2v", "wan-2.7-i2v", "happyhorse-i2v"]) {
      expect(resolveVideoModeForInputs(id, { hasStartFrame: false, hasImageRefs: true })).toBe(T2V)
    }
  })

  it("every alias group is classified — a new split-id model lands in one of the two pinned outcomes", () => {
    // Explicit per-group expectations (not a re-derivation of the formula):
    // grok is the one group whose twins differ on ref support today.
    const expectedByBase: Record<string, "image-to-video" | "text-to-video"> = {
      "grok-i2v": I2V,
      "wan-i2v": T2V,
      "wan-2.7-i2v": T2V,
      "happyhorse-i2v": T2V,
    }
    expect(VIDEO_MODE_ALIASES.map((g) => g.base).sort()).toEqual(Object.keys(expectedByBase).sort())
    for (const g of VIDEO_MODE_ALIASES) {
      const expected = expectedByBase[g.base]!
      expect(resolveVideoModeForInputs(g.base, { hasStartFrame: false, hasImageRefs: true }), g.base).toBe(expected)
      // The mode it picks resolves to the twin that can actually run it.
      if (expected === I2V) expect(resolveVideoProviderForMode(g.base, expected)).toBe(g.i2v)
    }
  })
})
