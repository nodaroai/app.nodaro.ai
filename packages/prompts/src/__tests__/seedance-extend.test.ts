import { describe, it, expect } from "vitest"
import { PROVIDER_CAPABILITIES } from "../index.js"
import { EXTEND_VIDEO_PROVIDERS, SEEDANCE_2_EXTEND_STITCH } from "@nodaro/shared/models"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"

/**
 * Seedance Extend Video: extend ANY video by URL — bare-template continuation
 * generation + trim-stitch (spike-validated). One provider per model:
 * `seedance-2-5-extend` (Seedance 2.5) and `seedance-2-0-extend` (Seedance 2.0).
 */
describe("Seedance extend shared wiring", () => {
  it("both Seedance models are registered extend providers", () => {
    expect(EXTEND_VIDEO_PROVIDERS).toContain("seedance-2-5-extend")
    expect(EXTEND_VIDEO_PROVIDERS).toContain("seedance-2-0-extend")
  })

  it("catalog entries drive the levers (extend mode, each model's window, three resolutions)", () => {
    const windows: Record<string, number[]> = {
      "seedance-2-5-extend": [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      "seedance-2-0-extend": [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    }
    for (const [id, durations] of Object.entries(windows)) {
      const m = MODEL_CATALOG[id]!
      expect(m.modes).toEqual(["extend"])
      expect(m.family).toBe("Bytedance")
      expect(m.durations).toEqual(durations)
      expect(m.resolutions).toEqual(["480p", "720p", "1080p"])
    }
  })

  it("stitch constants match the spike-validated recipe (4 tail / 3 head / 0.15s fades / 2s ref tail)", () => {
    expect(SEEDANCE_2_EXTEND_STITCH).toEqual({
      trimTailFrames: 4,
      trimHeadFrames: 3,
      audioFadeSec: 0.15,
      referenceTailSeconds: 2,
    })
  })

  it("is advertised to the wizard's extend-video capabilities, once per model", () => {
    const extend = PROVIDER_CAPABILITIES["extend-video"]!
    expect(extend["seedance-2-5-extend"]).toMatch(/ANY video.*Seedance 2\.5/i)
    expect(extend["seedance-2-0-extend"]).toMatch(/ANY video.*Seedance 2\.0/i)
    expect(extend["seedance-2-extend"]).toBeUndefined()
  })
})

describe("Kling 4 extend shared wiring", () => {
  it("is a registered extend provider with its own window and resolutions", () => {
    expect(EXTEND_VIDEO_PROVIDERS).toContain("kling-4-extend")
    const m = MODEL_CATALOG["kling-4-extend"]!
    expect(m.modes).toEqual(["extend"])
    expect(m.family).toBe("Kuaishou")
    expect(m.durations).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
    expect(m.resolutions).toEqual(["720p", "1080p"])
  })

  it("is advertised to the wizard's extend-video capabilities", () => {
    expect(PROVIDER_CAPABILITIES["extend-video"]!["kling-4-extend"]).toMatch(/ANY video.*Kling 4/i)
  })
})

describe("PixVerse V6 extend shared wiring", () => {
  it("is a registered extend provider with its own window and qualities", () => {
    expect(EXTEND_VIDEO_PROVIDERS).toContain("pixverse-v6-extend")
    const m = MODEL_CATALOG["pixverse-v6-extend"]!
    expect(m.modes).toEqual(["extend"])
    expect(m.family).toBe("PixVerse")
    expect(m.durations).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(m.resolutions).toEqual(["360p", "540p", "720p", "1080p"])
  })

  it("is advertised to the wizard's extend-video capabilities", () => {
    expect(PROVIDER_CAPABILITIES["extend-video"]!["pixverse-v6-extend"]).toMatch(/ANY video.*PixVerse V6/i)
  })
})
