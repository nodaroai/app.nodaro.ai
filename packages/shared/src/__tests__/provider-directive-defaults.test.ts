import { describe, it, expect } from "vitest"
import { mapShotIntentToProviderDirectives } from "../provider-directive-defaults.js"

const baseIntent = {
  needs_multishot_reference: false,
  is_loopable: false,
  needs_music_suppression: true,
  is_match_cut: false,
}

describe("mapShotIntentToProviderDirectives", () => {
  it("seedance-2 with default intent gets disable_internal_music + allow_sfx", () => {
    const dirs = mapShotIntentToProviderDirectives("seedance-2", baseIntent)
    expect(dirs.disable_internal_music).toBe(true)
    expect(dirs.allow_sfx).toBe(true)
  })

  it("seedance-2 with multishot intent adds multishot: true", () => {
    const dirs = mapShotIntentToProviderDirectives("seedance-2", {
      ...baseIntent,
      needs_multishot_reference: true,
    })
    expect(dirs.multishot).toBe(true)
  })

  it("veo3.1 with loopable intent adds loop_seed: stable", () => {
    const dirs = mapShotIntentToProviderDirectives("veo3.1", {
      ...baseIntent,
      is_loopable: true,
    })
    expect(dirs.loop_seed).toBe("stable")
  })

  it("hailuo with multishot intent doesn't add multishot (provider doesn't support it)", () => {
    const dirs = mapShotIntentToProviderDirectives("hailuo-2.3-pro", {
      ...baseIntent,
      needs_multishot_reference: true,
    })
    expect(dirs.multishot).toBeUndefined()
  })

  it("unknown provider returns an empty object", () => {
    const dirs = mapShotIntentToProviderDirectives("made-up-model", baseIntent)
    expect(dirs).toEqual({})
  })
})
