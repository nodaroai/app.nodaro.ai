import { describe, it, expect } from "vitest"
import { VIDEO_OVERLAY_PRESETS } from "../video-overlay.js"
import { resolveVideoOverlayGeometry, videoOverlayCanvas } from "../video-overlay-geometry.js"

describe("resolveVideoOverlayGeometry (§3.4 — shared by the preview and the worker)", () => {
  it("the card preset on 1080×1920 (the spec's worked example)", () => {
    expect(resolveVideoOverlayGeometry({ w: 1080, h: 1920 }, VIDEO_OVERLAY_PRESETS.card, 1080 / 2160)).toEqual({
      box: { left: 119, top: 307, width: 842, height: 1152 },
      drawn: { left: 252, top: 307, width: 576, height: 1152 },
    })
  })
  it("full-frame on a 9:16 canvas is the whole canvas — no edge shrink", () => {
    expect(resolveVideoOverlayGeometry({ w: 1080, h: 1920 }, VIDEO_OVERLAY_PRESETS["full-frame"], 16 / 9).drawn).toEqual({ left: 0, top: 0, width: 1080, height: 1920 })
  })
  it("a corner badge on 16:9", () => {
    expect(resolveVideoOverlayGeometry({ w: 1920, h: 1080 }, VIDEO_OVERLAY_PRESETS["corner-badge"]["bottom-right"], 1).drawn).toEqual({ left: 1497, top: 691, width: 346, height: 346 })
  })
  it("an odd drawn size is rounded DOWN to even (libx264 yuv420p)", () => {
    expect(resolveVideoOverlayGeometry({ w: 1000, h: 1000 }, { anchor: "top-left", x: 0, y: 0, width: 25, fit: "contain" }, 3).drawn).toEqual({ left: 1, top: 0, width: 248, height: 82 })
  })
  it("a very tall image at width 60 % with no height is fitted inside the canvas (the clamp): 192 × 1920", () => {
    expect(resolveVideoOverlayGeometry({ w: 1080, h: 1920 }, { anchor: "center", x: 0, y: 0, width: 60, fit: "contain" }, 400 / 4000)).toEqual({
      box: { left: 444, top: 0, width: 192, height: 1920 },
      drawn: { left: 444, top: 0, width: 192, height: 1920 },
    })
  })
  it("…and with height 60 % set: box 648 × 1152, contain → 114 × 1152, no clamp", () => {
    const g = resolveVideoOverlayGeometry({ w: 1080, h: 1920 }, { anchor: "center", x: 0, y: 0, width: 60, height: 60, fit: "contain" }, 400 / 4000)
    expect(g.box).toEqual({ left: 216, top: 384, width: 648, height: 1152 })
    expect(g.drawn).toEqual({ left: 483, top: 384, width: 114, height: 1152 })
  })
  it("a drawn size that would round below 2 px is floored at 2 × 2 (Review Focus 4)", () => {
    expect(resolveVideoOverlayGeometry({ w: 100, h: 100 }, { anchor: "top-left", x: 0, y: 0, width: 1, fit: "contain" }, 1).drawn).toMatchObject({ width: 2, height: 2 })
  })
  it("property: drawn is even, ≥ 2 and never larger than the canvas", () => {
    const canvases = [{ w: 1080, h: 1920 }, { w: 1920, h: 1080 }, { w: 100, h: 100 }, { w: 640, h: 360 }]
    for (const canvas of canvases) {
      for (let width = 1; width <= 100; width += 7) {
        for (const height of [undefined, 1, 14, 60, 100]) {
          for (const aspect of [0.05, 0.5, 1, 2, 20]) {
            for (const fit of ["contain", "cover"] as const) {
              const { drawn } = resolveVideoOverlayGeometry(canvas, { anchor: "center", x: 0, y: 0, width, height, fit }, aspect)
              expect(drawn.width % 2).toBe(0)
              expect(drawn.height % 2).toBe(0)
              expect(drawn.width).toBeGreaterThanOrEqual(2)
              expect(drawn.width).toBeLessThanOrEqual(canvas.w)
              expect(drawn.height).toBeLessThanOrEqual(canvas.h)
            }
          }
        }
      }
    }
  })
})

describe("videoOverlayCanvas", () => {
  it("is the display size: SAR resolved, even-rounded", () => {
    expect(videoOverlayCanvas({ width: 540, height: 1920, sar: 2 })).toEqual({ w: 1080, h: 1920 })
    expect(videoOverlayCanvas({ width: 1079, height: 1919 })).toEqual({ w: 1078, h: 1918 })
  })
  it("a target aspect wins", () => {
    expect(videoOverlayCanvas({ width: 1920, height: 1080 }, "9:16")).toEqual({ w: 1080, h: 1920 })
    expect(videoOverlayCanvas(null, "4:5")).toEqual({ w: 1080, h: 1350 })
  })
  it("unknown size and no aspect → null", () => {
    expect(videoOverlayCanvas(null)).toBeNull()
  })
})
