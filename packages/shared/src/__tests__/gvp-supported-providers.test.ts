import { describe, it, expect } from "vitest"
import { GVP_SUPPORTED_PROVIDERS, isGvpSupportedProvider, isSeedance2Provider } from "../model-constants.js"

/**
 * Generate/Edit Video Pro provider-selection guard (2026-07-21): the pro
 * nodes offer ONLY these SKUs. The list is intentionally narrower than the
 * SEEDANCE_2_PROVIDERS capability family (mini is a Seedance-2 variant for
 * capability gating but is NOT offered by the pro engine). If a new SKU is
 * blessed for the pro nodes, update this pin together with the docs pages
 * (docs/nodes/ai-video/generate-video-pro.md, edit-video-pro.md).
 */
describe("GVP_SUPPORTED_PROVIDERS", () => {
  it("is exactly the blessed pro SKUs", () => {
    expect([...GVP_SUPPORTED_PROVIDERS]).toEqual(["seedance-2", "seedance-2-fast"])
  })

  it("is a strict subset of the Seedance-2 capability family", () => {
    for (const p of GVP_SUPPORTED_PROVIDERS) {
      expect(isSeedance2Provider(p)).toBe(true)
    }
    // mini stays in the family (capabilities) but out of pro selection
    expect(isSeedance2Provider("seedance-2-mini")).toBe(true)
    expect(isGvpSupportedProvider("seedance-2-mini")).toBe(false)
  })

  it("predicate matches the list and rejects outsiders", () => {
    for (const p of GVP_SUPPORTED_PROVIDERS) expect(isGvpSupportedProvider(p)).toBe(true)
    expect(isGvpSupportedProvider("veo3")).toBe(false)
    expect(isGvpSupportedProvider(undefined)).toBe(false)
  })
})
