/**
 * Pins the canvas placement math to the SAME numbers the backend suite pins
 * (backend/src/providers/image/__tests__/overlay-geometry.test.ts). The live
 * preview draws with this copy and the worker renders with the server copy —
 * a drift between them means the preview shows one thing and the file is
 * another.
 */
import { describe, it, expect } from "vitest"
import { resolveOverlayGeometry, overlayRenderOrder, clampOverlayEdit, normalizeOverlayLayer } from "../image-overlay-geometry"
import type { OverlayLayerConfig } from "@/types/nodes"

const BASE = { w: 2000, h: 1000 }
function layer(over: Partial<OverlayLayerConfig> = {}): OverlayLayerConfig {
  return { anchor: "center", x: 0, y: 0, width: 25, opacity: 1, rotation: 0, blend: "over", fit: "contain", ...over }
}

describe("resolveOverlayGeometry (canvas twin)", () => {
  it("width is a percentage of the BASE width and height follows the layer aspect", () => {
    const g = resolveOverlayGeometry(BASE, layer({ width: 25 }), 2)
    expect(g.width).toBe(500)
    expect(g.height).toBe(250)
  })
  it("an explicit height overrides the aspect", () => {
    expect(resolveOverlayGeometry(BASE, layer({ width: 25, height: 50 }), 2).height).toBe(500)
  })
  it("center anchor centres the box", () => {
    const g = resolveOverlayGeometry(BASE, layer({ width: 10 }), 1)
    expect([g.left, g.top]).toEqual([900, 400])
  })
  it("bottom-right anchor with a NEGATIVE offset moves inward (the watermark case)", () => {
    const g = resolveOverlayGeometry(BASE, layer({ anchor: "bottom-right", width: 10, x: -4, y: -6 }), 1)
    expect([g.left, g.top]).toEqual([1720, 740])
  })
  it("edge anchors centre along the other axis", () => {
    expect(resolveOverlayGeometry(BASE, layer({ anchor: "right", width: 10 }), 1)).toMatchObject({ left: 1800, top: 400 })
    expect(resolveOverlayGeometry(BASE, layer({ anchor: "top", width: 10 }), 1)).toMatchObject({ left: 900, top: 0 })
  })
  it("a very tall layer is shrunk proportionally to the raster cap, exactly like the backend", () => {
    const g = resolveOverlayGeometry(BASE, layer({ width: 25 }), 0.02)
    expect(g.height).toBe(8192)
    expect(g.width).toBe(Math.round(500 * (8192 / 25000)))
  })

  it("scales with the base — the same layer on a 4× base lands 4× away", () => {
    const s = resolveOverlayGeometry({ w: 1000, h: 500 }, layer({ width: 10, anchor: "bottom-right", x: -5, y: -10 }), 1)
    const b = resolveOverlayGeometry({ w: 4000, h: 2000 }, layer({ width: 10, anchor: "bottom-right", x: -5, y: -10 }), 1)
    expect([b.left, b.top, b.width]).toEqual([s.left * 4, s.top * 4, s.width * 4])
  })
})

describe("overlayRenderOrder", () => {
  it("keeps handle order without zIndex and lets an explicit zIndex reorder", () => {
    expect(overlayRenderOrder([{}, {}, {}])).toEqual([0, 1, 2])
    expect(overlayRenderOrder([{ zIndex: 5 }, {}, { zIndex: 0 }])).toEqual([2, 1, 0])
  })
})

describe("normalizeOverlayLayer (canvas twin of resolveLayer)", () => {
  it("clamps out-of-range workflow JSON into the route's bounds instead of previewing it verbatim", () => {
    const l = normalizeOverlayLayer({ width: 500, opacity: 7, rotation: 720, x: -900, anchor: "nowhere" as never } as never)
    expect([l.width, l.opacity, l.rotation, l.x, l.anchor, l.blend, l.fit]).toEqual([100, 1, 180, -100, "center", "over", "contain"])
  })
})

describe("clampOverlayEdit", () => {
  it("keeps a drag inside the route's bounds and wraps rotation", () => {
    expect(clampOverlayEdit({ x: 140, y: -140, width: 0, rotation: 270 })).toEqual({ x: 100, y: -100, width: 1, rotation: -90 })
  })
})
