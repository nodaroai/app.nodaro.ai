import { describe, it, expect } from "vitest"
import { OVERLAY_PLATFORMS, overlayPlatformById } from "@nodaro/shared"
import { overlayCompositionKey, overlayPlatformPatch, overlayResultMatches, type OverlayComposition } from "../image-overlay-platform"

describe("overlayPlatformPatch", () => {
  it("sets the canvas to the platform size, keeps the colour and the user's fit", () => {
    const patch = overlayPlatformPatch("instagram-story", { canvas: { width: 10, height: 10, backgroundColor: "#123456" }, baseFit: "contain" })
    expect(patch).toEqual({ platform: "instagram-story", canvas: { width: 1080, height: 1920, backgroundColor: "#123456" }, baseFit: "contain" })
  })
  it("defaults to cover and black when nothing was set", () => {
    expect(overlayPlatformPatch("youtube-banner", {})).toMatchObject({ canvas: { width: 2560, height: 1440, backgroundColor: "#000000" }, baseFit: "cover" })
  })
  it("'none' / unknown only forgets the platform", () => {
    expect(overlayPlatformPatch("none", { canvas: { width: 5, height: 5, backgroundColor: "#000000" } })).toEqual({ platform: undefined })
    expect(overlayPlatformPatch(undefined, {})).toEqual({ platform: undefined })
  })
})

describe("platform zones", () => {
  it("every zone lies inside its canvas, and the primary safe area is one of them when zones exist", () => {
    for (const p of OVERLAY_PLATFORMS) {
      for (const z of p.zones ?? []) {
        expect(z.x).toBeGreaterThanOrEqual(0)
        expect(z.y).toBeGreaterThanOrEqual(0)
        expect(z.x + z.w).toBeLessThanOrEqual(1 + 1e-9)
        expect(z.y + z.h).toBeLessThanOrEqual(1 + 1e-9)
      }
      if (p.zones?.length) {
        expect(p.safe).toBeDefined()
        expect(p.zones.some((z) => z.x === p.safe!.x && z.y === p.safe!.y && z.w === p.safe!.w && z.h === p.safe!.h)).toBe(true)
      }
    }
    expect(overlayPlatformById("youtube-banner")?.zones?.map((z) => z.id)).toEqual(["tv", "desktop", "all"])
  })
})

describe("overlayResultMatches — composition stamp", () => {
  it("a stamped result is fresh only while the composition is unchanged (a moved layer counts, the size does not help it)", () => {
    const data: OverlayComposition = { layers: [{ anchor: "center", x: 0, y: 0, width: 25, opacity: 1, rotation: 0, blend: "over", fit: "contain" }], canvas: { width: 1080, height: 1080, backgroundColor: "#000000" } }
    const stamped = { width: 1080, height: 1080, overlayComposition: overlayCompositionKey(data) }
    expect(overlayResultMatches(data, undefined, stamped)).toBe(true)
    const moved: OverlayComposition = { ...data, layers: [{ ...data.layers![0], x: 10 }] }
    expect(overlayResultMatches(moved, undefined, stamped)).toBe(false)
  })
})

describe("overlayResultMatches", () => {
  it("a result of the canvas size is fresh; another size is stale; unknown sizes count as fresh", () => {
    const canvas = { canvas: { width: 1080, height: 1920, backgroundColor: "#000000" } }
    expect(overlayResultMatches(canvas, undefined, { width: 1080, height: 1920 })).toBe(true)
    expect(overlayResultMatches(canvas, undefined, { width: 2048, height: 1152 })).toBe(false)
    expect(overlayResultMatches(canvas, undefined, {})).toBe(true)
    expect(overlayResultMatches({}, { w: 2048, h: 1152 }, { width: 2048, height: 1152 })).toBe(true)
    expect(overlayResultMatches({}, { w: 2048, h: 1152 }, { width: 1080, height: 1920 })).toBe(false)
    expect(overlayResultMatches({}, undefined, { width: 1, height: 1 })).toBe(true)
  })
})
