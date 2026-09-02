import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, normalizeVideoRequestParams } from "../index.js"
import {
  normalizeMinimaxH3Resolution,
  normalizeWan3Resolution,
  VIDEO_GEN_PROVIDERS,
} from "../model-constants.js"

/**
 * Most video providers RENDER whatever band they are handed, so an off-list
 * request is best snapped to the nearest supported one. A few instead COLLAPSE
 * anything unrecognised to a fixed default, and for those the nearest band is
 * wrong in the most expensive direction: MiniMax H3 renders 2K for every value
 * that isn't "768p", so snapping a stale Seedance "720p" to the pixel-nearest
 * 768P would bill the CHEAP tier against a 2K render — and `commit_credits`
 * (migration 176) only refunds a surplus, never collects a shortfall.
 *
 * `ModelCatalogEntry.unlistedResolutionRendersAs` is how a model declares that
 * behaviour. These tests pin every declaration to what the provider's OWN
 * normalizer returns, so a change to one without the other fails the build
 * rather than silently repricing live runs.
 */
describe("unlistedResolutionRendersAs matches the provider's own collapse rule", () => {
  // Real off-list VALUES only. A blank/absent resolution is a different case —
  // it never reaches the snap (there is nothing to snap), and the identifier
  // already prices it through the provider's own collapse rule, so price and
  // render agree on it without this field.
  const OFF_LIST = ["720p", "480p", "1080p", "4k", "nonsense"]

  it("minimax-h3 declares what normalizeMinimaxH3Resolution collapses to", () => {
    const declared = MODEL_CATALOG["minimax-h3"]!.unlistedResolutionRendersAs
    expect(declared).toBeDefined()
    for (const off of OFF_LIST) {
      if ((MODEL_CATALOG["minimax-h3"]!.resolutions as readonly string[]).includes(off)) continue
      expect(normalizeMinimaxH3Resolution(off), `H3 renders ${off} as`).toBe(declared)
      expect(normalizeVideoRequestParams("minimax-h3", { resolution: off }).resolution).toBe(declared)
    }
  })

  it("the wan-3 family declares what normalizeWan3Resolution collapses to", () => {
    for (const id of ["wan-3", "wan-3-prime"]) {
      const declared = MODEL_CATALOG[id]!.unlistedResolutionRendersAs
      expect(declared, id).toBeDefined()
      for (const off of ["4k", "2k", "nonsense"]) {
        // The catalog spells bands lowercase; the KIE wire form is uppercase.
        expect(normalizeWan3Resolution(off).toLowerCase(), `${id} renders ${off} as`).toBe(declared)
        expect(normalizeVideoRequestParams(id, { resolution: off }).resolution).toBe(declared)
      }
    }
  })

  it("a declared collapse target is always one of the model's own bands", () => {
    for (const provider of VIDEO_GEN_PROVIDERS) {
      const entry = MODEL_CATALOG[provider]
      const declared = entry?.unlistedResolutionRendersAs
      if (declared === undefined) continue
      expect(entry!.resolutions, `${provider} declares a collapse target but no resolutions`).toBeDefined()
      expect(entry!.resolutions, `${provider}: "${declared}" is not one of its bands`).toContain(declared)
    }
  })

  it("does not change a listed value — the collapse rule only governs OFF-list requests", () => {
    expect(normalizeVideoRequestParams("minimax-h3", { resolution: "768P" }).resolution).toBe("768P")
    expect(normalizeVideoRequestParams("minimax-h3", { resolution: "2K" }).resolution).toBe("2K")
    expect(normalizeVideoRequestParams("wan-3", { resolution: "480p" }).resolution).toBe("480p")
    expect(normalizeVideoRequestParams("wan-3", { resolution: "1080p" }).resolution).toBe("1080p")
  })

  it("every other video model still snaps to the NEAREST band", () => {
    // The collapse rule is an opt-in exception, not the default: a 4k request on
    // a 1080p-max model must still render 1080p, never the cheapest tier (R7).
    expect(MODEL_CATALOG["seedance-2-5"]!.unlistedResolutionRendersAs).toBeUndefined()
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: "4k" }).resolution).toBe("1080p")
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: "360p" }).resolution).toBe("480p")
  })
})
