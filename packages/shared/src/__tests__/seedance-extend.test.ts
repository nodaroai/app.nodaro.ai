import { describe, it, expect } from "vitest"
import {
  EXTEND_VIDEO_PROVIDERS,
  MODEL_CATALOG,
  PROVIDER_CAPABILITIES,
  SEEDANCE_2_EXTEND_STITCH,
  buildVideoCreditModelIdentifier,
} from "../index.js"

/**
 * seedance-2-extend: extend ANY video by URL — bare-template continuation
 ***REDACTED-OSS-SCRUB***
 ***REDACTED-OSS-SCRUB***
 */
describe("seedance-2-extend shared wiring", () => {
  it("is a registered extend provider", () => {
    expect(EXTEND_VIDEO_PROVIDERS).toContain("seedance-2-extend")
  })

  it("catalog entry drives the levers (extend mode, 4-15s, three resolutions)", () => {
    const m = MODEL_CATALOG["seedance-2-extend"]!
    expect(m.modes).toEqual(["extend"])
    expect(m.family).toBe("Bytedance")
    expect(m.durations).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(m.resolutions).toEqual(["480p", "720p", "1080p"])
    expect(m.pricing.length).toBeGreaterThanOrEqual(4)
    expect(m.pricing[0]!.identifier).toBe("seedance-2-extend")
  })

  it("stitch constants match the spike-validated recipe (4 tail / 3 head / 0.15s fades)", () => {
    expect(SEEDANCE_2_EXTEND_STITCH).toEqual({
      trimTailFrames: 4,
      trimHeadFrames: 3,
      audioFadeSec: 0.15,
    })
  })

  it("is advertised to the wizard's extend-video capabilities", () => {
    expect(PROVIDER_CAPABILITIES["extend-video"]!["seedance-2-extend"]).toMatch(/ANY video/i)
  })

  it("credit identifiers snap to duration tiers with a :res suffix (no -ref dimension)", () => {
    expect(buildVideoCreditModelIdentifier("seedance-2-extend", 6, undefined, undefined, undefined, "480p"))
      .toBe("seedance-2-extend:8s:480p") // 6s snaps into the 8s tier
    expect(buildVideoCreditModelIdentifier("seedance-2-extend", 4, undefined, undefined, undefined, "720p"))
      .toBe("seedance-2-extend:4s:720p")
    expect(buildVideoCreditModelIdentifier("seedance-2-extend", 15, undefined, undefined, undefined, "1080p"))
      .toBe("seedance-2-extend:15s:1080p")
  })
})
