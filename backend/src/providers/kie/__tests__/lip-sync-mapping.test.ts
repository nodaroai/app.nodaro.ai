import { describe, it, expect } from "vitest"
import { buildLipSyncInput } from "../video.js"
import { KIE_LIP_SYNC_MODELS } from "../models.js"

// OmniHuman 1.5 has distinct KIE param names vs the other avatars:
// output_resolution ("720"|"1080") + pe_fast_mode + seed. The generic
// buildLipSyncInput must map them from config, and must NOT leak those onto
// providers (kling-avatar) that don't declare the mapping fields.
describe("buildLipSyncInput — omnihuman-1-5 param mapping", () => {
  const omni = KIE_LIP_SYNC_MODELS["omnihuman-1-5"]
  const kling = KIE_LIP_SYNC_MODELS["kling-avatar"]

  it("maps 1080p → output_resolution '1080' and emits no bare resolution", () => {
    const input = buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", resolution: "1080p" })
    expect(input.output_resolution).toBe("1080")
    expect(input.resolution).toBeUndefined()
  })

  it("maps 720p and 480p both → '720'", () => {
    expect(buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", resolution: "720p" }).output_resolution).toBe("720")
    expect(buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", resolution: "480p" }).output_resolution).toBe("720")
  })

  it("defaults to '1080' when no resolution is supplied", () => {
    expect(buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a" }).output_resolution).toBe("1080")
  })

  it("emits pe_fast_mode + seed from options", () => {
    const input = buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", options: { fastMode: true, seed: 42 } })
    expect(input.pe_fast_mode).toBe(true)
    expect(input.seed).toBe(42)
  })

  it("omits seed when negative (random)", () => {
    const input = buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", options: { seed: -1 } })
    expect(input.seed).toBeUndefined()
  })

  it("always sets a prompt (default or provided)", () => {
    expect(buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a" }).prompt).toBe("A person speaking naturally")
    expect(buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", prompt: "sing confidently" }).prompt).toBe("sing confidently")
  })

  it("leaves kling-avatar untouched — bare resolution, no output_resolution/pe_fast_mode/seed", () => {
    const input = buildLipSyncInput(kling, {
      imageUrl: "i",
      audioUrl: "a",
      resolution: "720p",
      options: { fastMode: true, seed: 1 },
    })
    expect(input.resolution).toBe("720p")
    expect(input.output_resolution).toBeUndefined()
    expect(input.pe_fast_mode).toBeUndefined()
    expect(input.seed).toBeUndefined()
  })
})
