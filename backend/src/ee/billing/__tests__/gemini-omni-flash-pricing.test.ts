import { describe, it, expect } from "vitest"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * Gemini Omni Flash (KIE google/gemini-omni-flash-1-1) — the cheaper sibling of
 * gemini-omni-video. Same request shape, same 4/6/8/10s ladder, same lowercase
 * "4k" band and flat ":vref" rate when a source video is supplied.
 *
 * Nodaro credits = ceil(KIE cr × 2.5 / 10) × 10. Note :10 = 320, not 315 —
 * 126 × 2.5 = 315 and the conversion rounds UP to the next 10, exactly as every
 * other row in the family does (157.5→160, 262.5→270, 367.5→370, 472.5→480,
 * 525→530).
 *
 * The identifier-coupling block below is the one that matters most: the family
 * branch in @nodaro/shared credit-identifiers.ts used to be a literal
 * `=== "gemini-omni-video"`. A regression to that literal makes EVERY flash run
 * resolve the bare id (270) regardless of duration, 4K or vref — silently
 * under-charging with no error and nothing else red.
 */

const KIE_CREDITS: Record<string, number> = {
  "gemini-omni-flash:4": 63,
  "gemini-omni-flash:6": 84,
  "gemini-omni-flash:8": 105,
  "gemini-omni-flash:10": 126,
  "gemini-omni-flash:4k:4": 147,
  "gemini-omni-flash:4k:6": 168,
  "gemini-omni-flash:4k:8": 189,
  "gemini-omni-flash:4k:10": 210,
  "gemini-omni-flash:vref": 168,
  "gemini-omni-flash:4k:vref": 252,
}

describe("gemini-omni-flash static credits — literal table", () => {
  const expected: Record<string, number> = {
    "gemini-omni-flash": 270,
    "gemini-omni-flash:4": 160,
    "gemini-omni-flash:6": 210,
    "gemini-omni-flash:8": 270,
    "gemini-omni-flash:10": 320,
    "gemini-omni-flash:4k:4": 370,
    "gemini-omni-flash:4k:6": 420,
    "gemini-omni-flash:4k:8": 480,
    "gemini-omni-flash:4k:10": 530,
    "gemini-omni-flash:vref": 420,
    "gemini-omni-flash:4k:vref": 630,
  }
  for (const [id, credits] of Object.entries(expected)) {
    it(`${id} = ${credits}`, () => { expect(STATIC_CREDIT_COSTS[id]).toBe(credits) })
  }

  it("seeds exactly 10 composites plus the bare id", () => {
    const keys = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k.startsWith("gemini-omni-flash"))
    expect(keys.length).toBe(11)
  })
})

describe("gemini-omni-flash — every row derives from the SAME ceil formula", () => {
  for (const [id, kie] of Object.entries(KIE_CREDITS)) {
    it(`${id} = ceil(${kie} × 2.5 / 10) × 10`, () => {
      expect(STATIC_CREDIT_COSTS[id]).toBe(Math.ceil((kie * 2.5) / 10) * 10)
    })
  }

  it("the bare id is the 8s default render (the credit builder's duration fallback)", () => {
    expect(STATIC_CREDIT_COSTS["gemini-omni-flash"]).toBe(STATIC_CREDIT_COSTS["gemini-omni-flash:8"])
  })
})

describe("gemini-omni-flash — identifier coupling (the family branch actually fires)", () => {
  const build = (duration?: number, resolution?: string, hasVideoRef?: boolean) =>
    buildVideoCreditModelIdentifier("gemini-omni-flash", duration, undefined, "image-to-video", undefined, resolution, hasVideoRef)

  it("maps each on-menu duration to its own tier", () => {
    for (const d of [4, 6, 8, 10]) expect(build(d)).toBe(`gemini-omni-flash:${d}`)
  })

  it("snaps an off-menu duration to the NEAREST tier (ties to the lower)", () => {
    expect(build(5)).toBe("gemini-omni-flash:4")
    expect(build(7)).toBe("gemini-omni-flash:6")
    expect(build(9)).toBe("gemini-omni-flash:8")
    expect(build(30)).toBe("gemini-omni-flash:10")
    expect(build(1)).toBe("gemini-omni-flash:4")
  })

  it("defaults an unset duration to the 8s tier", () => {
    expect(build(undefined)).toBe("gemini-omni-flash:8")
  })

  it("prefixes the 4K band and leaves every other band on the base row", () => {
    expect(build(6, "4k")).toBe("gemini-omni-flash:4k:6")
    expect(build(6, "1080p")).toBe("gemini-omni-flash:6")
    expect(build(6, "720p")).toBe("gemini-omni-flash:6")
  })

  it("prices a source-video (V2V) run flat, at both bands", () => {
    expect(build(8, "720p", true)).toBe("gemini-omni-flash:vref")
    expect(build(8, "4k", true)).toBe("gemini-omni-flash:4k:vref")
  })

  it("text-to-video resolves identically (no T2V_CREDIT_OVERRIDES entry)", () => {
    expect(
      buildVideoCreditModelIdentifier("gemini-omni-flash", 6, undefined, "text-to-video", undefined, "4k", undefined),
    ).toBe("gemini-omni-flash:4k:6")
  })

  it("every identifier the builder can emit is seeded", () => {
    for (const d of [undefined, 1, 4, 5, 6, 7, 8, 9, 10, 12, 30]) {
      for (const res of [undefined, "360p", "720p", "1080p", "4k"]) {
        for (const ref of [undefined, true, false]) {
          const id = build(d, res, ref)
          expect(STATIC_CREDIT_COSTS[id], id).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe("gemini-omni-flash is cheaper than gemini-omni-video at every matching tier", () => {
  const suffixes = ["", ":4", ":6", ":8", ":10", ":4k:4", ":4k:6", ":4k:8", ":4k:10", ":vref", ":4k:vref"]
  for (const suffix of suffixes) {
    it(`gemini-omni-flash${suffix} < gemini-omni-video${suffix}`, () => {
      const flash = STATIC_CREDIT_COSTS[`gemini-omni-flash${suffix}`]
      const pro = STATIC_CREDIT_COSTS[`gemini-omni-video${suffix}`]
      expect(flash).toBeGreaterThan(0)
      expect(pro).toBeGreaterThan(0)
      expect(flash!).toBeLessThan(pro!)
    })
  }
})

describe("gemini-omni-flash — phantom identifiers stay unpriced", () => {
  for (const id of [
    "gemini-omni-flash:5",
    "gemini-omni-flash:360p:4",
    "gemini-omni-flash:4k",
    "gemini-omni-flash:8s",
    "gemini-omni-flash:1080p:8",
    "gemini-omni-flash:4k:8-ref",
  ]) {
    it(`${id} is NOT seeded`, () => { expect(STATIC_CREDIT_COSTS[id]).toBeUndefined() })
  }
})
