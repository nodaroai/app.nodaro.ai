/**
 * What a source video's shape means for a Speaker View render:
 *  - D18 (decided 2026-10-11): a source already at or narrower than the target
 *    aspect has no extra width to follow a speaker across, so the run is
 *    refused before any charge. A PURE rule the route and both engines call.
 *  - D10 (decided 2026-10-11): a low-resolution source still renders at the
 *    fixed canvas size (SV7), with a warning that names the upscale.
 */
import { describe, it, expect } from "vitest"
import {
  SPEAKER_VIEW_BOX_UPSCALE_WARN,
  SPEAKER_VIEW_SOURCE_UPSCALE_WARN,
  speakerViewCanvas,
  speakerViewSourceAspectRefusal,
  speakerViewSourceUpscale,
} from "@nodaro/render-rules"

describe("speakerViewCanvas (SV7: size is fixed per aspect and quality)", () => {
  it("is the canvas a Final and a Preview are drawn at", () => {
    expect(speakerViewCanvas("9:16")).toEqual({ width: 1080, height: 1920 })
    expect(speakerViewCanvas("9:16", "final")).toEqual({ width: 1080, height: 1920 })
    expect(speakerViewCanvas("9:16", "proxy")).toEqual({ width: 720, height: 1280 })
    expect(speakerViewCanvas("16:9")).toEqual({ width: 1920, height: 1080 })
    expect(speakerViewCanvas("1:1")).toEqual({ width: 1080, height: 1080 })
    expect(speakerViewCanvas("4:5", "proxy")).toEqual({ width: 720, height: 900 })
  })

  it("hands out a copy, so a caller cannot change the table", () => {
    const c = speakerViewCanvas("9:16") as { width: number }
    c.width = 1
    expect(speakerViewCanvas("9:16").width).toBe(1080)
  })
})

describe("speakerViewSourceAspectRefusal (D18)", () => {
  it("lets a wider source through: 640x360 into 9:16, 1080x1080 into 9:16, 1920x1080 into 1:1 and 4:5", () => {
    expect(speakerViewSourceAspectRefusal({ width: 640, height: 360 }, "9:16")).toBeNull()
    expect(speakerViewSourceAspectRefusal({ width: 1080, height: 1080 }, "9:16")).toBeNull()
    expect(speakerViewSourceAspectRefusal({ width: 1920, height: 1080 }, "1:1")).toBeNull()
    expect(speakerViewSourceAspectRefusal({ width: 1920, height: 1080 }, "4:5")).toBeNull()
    expect(speakerViewSourceAspectRefusal({ width: 2560, height: 1080 }, "16:9")).toBeNull()
  })

  it("refuses a source exactly at the target aspect", () => {
    for (const [w, h, a] of [[1080, 1920, "9:16"], [1920, 1080, "16:9"], [1080, 1080, "1:1"], [1080, 1350, "4:5"], [720, 1280, "9:16"]] as const) {
      expect(speakerViewSourceAspectRefusal({ width: w, height: h }, a), `${w}x${h} into ${a}`).not.toBeNull()
    }
  })

  it("refuses a narrower source: 9:16 into 1:1, 4:5 into 1:1, 4:3 into 16:9", () => {
    expect(speakerViewSourceAspectRefusal({ width: 1080, height: 1920 }, "1:1")).not.toBeNull()
    expect(speakerViewSourceAspectRefusal({ width: 1080, height: 1350 }, "1:1")).not.toBeNull()
    expect(speakerViewSourceAspectRefusal({ width: 1440, height: 1080 }, "16:9")).not.toBeNull()
  })

  it("treats an even-pixel rounding of the target aspect as 'at' it, but not a visibly wider picture", () => {
    expect(speakerViewSourceAspectRefusal({ width: 1080, height: 1918 }, "9:16")).not.toBeNull()
    expect(speakerViewSourceAspectRefusal({ width: 1080, height: 1880 }, "9:16")).toBeNull()
  })

  it("keeps the 1 % tolerance at its edge (decided 2026-10-12)", () => {
    // 9:16 at 1920 high is 1080 wide; 1 % wider is 1090.8. 1090 is still "at" the aspect, 1091 has width to spare.
    expect(speakerViewSourceAspectRefusal({ width: 1090, height: 1920 }, "9:16")).not.toBeNull()
    expect(speakerViewSourceAspectRefusal({ width: 1091, height: 1920 }, "9:16")).toBeNull()
  })

  it("answers in plain words, naming the picture and the aspect, and says it is a refusal code a route can map", () => {
    const r = speakerViewSourceAspectRefusal({ width: 1080, height: 1920 }, "9:16")!
    expect(r.code).toBe("source-not-wider")
    expect(r.message).toContain("1080×1920")
    expect(r.message).toContain("9:16")
    expect(r.message).not.toMatch(/\bD\d+\b|decided|spec/i)
  })

  it("only offers a way out that exists: never a narrower target than 9:16, which is the narrowest", () => {
    const r = speakerViewSourceAspectRefusal({ width: 1080, height: 1920 }, "9:16")!
    expect(r.message).not.toMatch(/narrower target/i)
    expect(r.message).toMatch(/wider video/i)
  })

  it("names only targets this very picture would be accepted for", () => {
    // 4:3 into 16:9: it is wider than 1:1, 4:5 and 9:16, and not than 16:9 itself.
    const r = speakerViewSourceAspectRefusal({ width: 1440, height: 1080 }, "16:9")!
    expect(r.message).toContain("1:1, 4:5 or 9:16")
    for (const a of ["1:1", "4:5", "9:16"] as const) {
      expect(speakerViewSourceAspectRefusal({ width: 1440, height: 1080 }, a), a).toBeNull()
    }
  })

  it("names a single alternative without a list, and none when no target is narrower", () => {
    // 1080x1350 (4:5) into 4:5 is refused; 9:16 is the only target it is wider than.
    const four5 = speakerViewSourceAspectRefusal({ width: 1080, height: 1350 }, "4:5")!
    expect(four5.message).toContain("choose 9:16")
    // a 1:1 picture into 1:1 may still be cut for 4:5 and 9:16
    const sq = speakerViewSourceAspectRefusal({ width: 1080, height: 1080 }, "1:1")!
    expect(sq.message).toContain("4:5 or 9:16")
    // a 9:16 picture into 1:1: nothing narrower than 9:16 exists
    expect(speakerViewSourceAspectRefusal({ width: 1080, height: 1920 }, "1:1")!.message).not.toMatch(/choose/i)
  })

  it("cannot judge a source whose size is unknown, so it does not refuse", () => {
    for (const bad of [{ width: 0, height: 360 }, { width: 640, height: 0 }, { width: Number.NaN, height: 360 }, { width: -1, height: -1 }, { width: Infinity, height: 360 }]) {
      expect(speakerViewSourceAspectRefusal(bad, "9:16")).toBeNull()
    }
  })

  it("does not judge an aspect it does not draw", () => {
    expect(speakerViewSourceAspectRefusal({ width: 640, height: 360 }, "21:9" as never)).toBeNull()
  })
})

describe("speakerViewSourceUpscale (D10)", () => {
  it("640x360 into 9:16 Final is the 5.3x of the motivating clip, named in the message", () => {
    const u = speakerViewSourceUpscale({ width: 640, height: 360 }, "9:16")!
    expect(u.factor).toBeCloseTo(1080 / 202.5, 6)
    expect(u.warn).toBe(true)
    expect(u.crop).toEqual({ width: 202, height: 360 })
    expect(u.canvas).toEqual({ width: 1080, height: 1920 })
    expect(u.message).toContain("640×360")
    expect(u.message).toContain("202×360")
    expect(u.message).toContain("1080×1920")
    expect(u.message).toContain("5.3×")
  })

  it("always judges the FINAL canvas, whatever quality is rendered (decided 2026-10-12), so a Preview already warns", () => {
    // A Preview draws 720x1280, where a 640x360 clip would be a 3.6x enlargement; the
    // warning is about the picture that ships, so it states the 5.3x of the 1080x1920 canvas.
    const judge = speakerViewSourceUpscale as (...args: unknown[]) => ReturnType<typeof speakerViewSourceUpscale>
    const preview = judge({ width: 640, height: 360 }, "9:16", "proxy")!
    expect(preview.canvas).toEqual({ width: 1080, height: 1920 })
    expect(preview.factor).toBeCloseTo(1080 / 202.5, 6)
    expect(preview.warn).toBe(true)
    expect(preview).toEqual(speakerViewSourceUpscale({ width: 640, height: 360 }, "9:16"))
    // 720p into 9:16: 2.7x on the final canvas (warns), but only 1.8x on the Preview canvas (would not).
    const hd = judge({ width: 1280, height: 720 }, "9:16", "proxy")!
    expect(hd.warn).toBe(true)
    expect(hd.canvas).toEqual({ width: 1080, height: 1920 })
  })

  it("warns only ABOVE 2.5x (decided 2026-10-12): the whole-clip source line, apart from the region editor's box line", () => {
    expect(SPEAKER_VIEW_SOURCE_UPSCALE_WARN).toBe(2.5)
    // R12: two thresholds. The drawn-box chip's line is its own, lower constant.
    expect(SPEAKER_VIEW_BOX_UPSCALE_WARN).toBe(1.5)
    expect(SPEAKER_VIEW_BOX_UPSCALE_WARN).toBeLessThan(SPEAKER_VIEW_SOURCE_UPSCALE_WARN)
    // A 9:16 cover crop of a 768-high landscape source is 432 wide: 1080 / 432 = 2.5 exactly, not above the line.
    const at = speakerViewSourceUpscale({ width: 1366, height: 768 }, "9:16")!
    expect(at.factor).toBe(2.5)
    expect(at.warn).toBe(false)
    expect(at.message).toBeUndefined()
    const above = speakerViewSourceUpscale({ width: 1364, height: 767 }, "9:16")!
    expect(above.factor).toBeGreaterThan(2.5)
    expect(above.warn).toBe(true)
    expect(above.message).toContain("look soft")
  })

  it("1080p and 1440p into 9:16 are quiet; 720p and below warn (decided 2026-10-12)", () => {
    const fhd = speakerViewSourceUpscale({ width: 1920, height: 1080 }, "9:16")!
    expect(fhd.factor).toBeCloseTo(1080 / 607.5, 6)
    expect(fhd.warn).toBe(false)
    expect(fhd.message).toBeUndefined()
    expect(speakerViewSourceUpscale({ width: 2560, height: 1440 }, "9:16")!.warn).toBe(false)
    const big = speakerViewSourceUpscale({ width: 3840, height: 2160 }, "9:16")!
    expect(big.factor).toBeCloseTo(1080 / 1215, 6)
    expect(big.warn).toBe(false)
    expect(speakerViewSourceUpscale({ width: 1280, height: 720 }, "9:16")!.warn).toBe(true)
    expect(speakerViewSourceUpscale({ width: 854, height: 480 }, "9:16")!.warn).toBe(true)
  })

  it("1080p into the other portrait-ish targets is quiet too", () => {
    expect(speakerViewSourceUpscale({ width: 1920, height: 1080 }, "4:5")!.warn).toBe(false)
    expect(speakerViewSourceUpscale({ width: 1920, height: 1080 }, "1:1")!.warn).toBe(false)
  })

  it("uses the whole frame when the source is narrower than the target (the crop is the frame's width)", () => {
    const u = speakerViewSourceUpscale({ width: 540, height: 960 }, "1:1")!
    expect(u.crop).toEqual({ width: 540, height: 540 })
    expect(u.factor).toBeCloseTo(2, 6)
  })

  it("has no answer for a source whose size is unknown", () => {
    expect(speakerViewSourceUpscale({ width: 0, height: 360 }, "9:16")).toBeUndefined()
    expect(speakerViewSourceUpscale({ width: Number.NaN, height: 360 }, "9:16")).toBeUndefined()
    expect(speakerViewSourceUpscale({ width: 640, height: 360 }, "21:9" as never)).toBeUndefined()
  })
})
