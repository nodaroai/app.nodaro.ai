import { describe, it, expect } from "vitest"
import {
  DEFAULT_VIDEO_OVERLAY_LAYER,
  VIDEO_OVERLAY_HANDLE_IDS,
  VIDEO_OVERLAY_PRESETS,
  applyVideoOverlayPreset,
  assembleVideoOverlayRequest,
  clearWiredVideoOverlayImageUrls,
  expandVideoOverlayLayer,
  expandVideoOverlayPresets,
  formatVideoOverlayError,
  hasDrawableVideoOverlayBox,
  normalizeVideoOverlayNodes,
  resolveVideoOverlayGeometry,
  toCustomVideoOverlayLayer,
  validateVideoOverlayRequest,
  videoOverlayCanvas,
  VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH,
  VIDEO_OVERLAY_MAX_LAYERS,
  videoOverlayCompositionKey,
  videoOverlayRenderOrder,
  videoOverlaySlotOfHandle,
  videoOverlaySlotSources,
  type VideoOverlayIssue,
  type VideoOverlayLayerInput,
} from "../video-overlay.js"

const IMG = "https://cdn.example/a.png"

describe("constants", () => {
  it("presets are the spec's boxes in the custom vocabulary", () => {
    expect(VIDEO_OVERLAY_PRESETS.card).toEqual({ anchor: "center", x: 0, y: -4, width: 78, height: 60, fit: "contain" })
    expect(VIDEO_OVERLAY_PRESETS["full-frame"]).toEqual({ anchor: "center", x: 0, y: 0, width: 100, height: 100, fit: "cover" })
    expect(VIDEO_OVERLAY_PRESETS["corner-badge"]["bottom-right"]).toEqual({ anchor: "bottom-right", x: -4, y: -4, width: 18, fit: "contain" })
    expect(VIDEO_OVERLAY_PRESETS["corner-badge"]["top-left"]).toEqual({ anchor: "top-left", x: 4, y: 4, width: 18, fit: "contain" })
    expect(VIDEO_OVERLAY_PRESETS["corner-badge"]["top-right"]).toEqual({ anchor: "top-right", x: -4, y: 4, width: 18, fit: "contain" })
    expect(VIDEO_OVERLAY_PRESETS["corner-badge"]["bottom-left"]).toEqual({ anchor: "bottom-left", x: 4, y: -4, width: 18, fit: "contain" })
  })
  it("the default layer is the bottom-right corner badge from 0 to the end (D2)", () => {
    expect(DEFAULT_VIDEO_OVERLAY_LAYER).toEqual({
      start: 0, preset: "corner-badge", corner: "bottom-right",
      anchor: "bottom-right", x: -4, y: -4, width: 18, fit: "contain", opacity: 1, animate: true,
    })
    expect("end" in DEFAULT_VIDEO_OVERLAY_LAYER).toBe(false)
  })
  it("12 canvas handles; slot numbers are 1-based and nothing else is a layer handle", () => {
    expect(VIDEO_OVERLAY_HANDLE_IDS).toHaveLength(12)
    expect(videoOverlaySlotOfHandle("overlay")).toBe(1)
    expect(videoOverlaySlotOfHandle("overlay12")).toBe(12)
    for (const h of ["overlay0", "overlay13", "video", "layerPlan", "", null, undefined]) expect(videoOverlaySlotOfHandle(h)).toBe(0)
  })
})

describe("expandVideoOverlayLayer — the one normaliser (§3.3)", () => {
  it("copies each preset's box in and keeps the tag (all presets, all four corners)", () => {
    expect(expandVideoOverlayLayer({ preset: "card", start: 1 })).toMatchObject({ ...VIDEO_OVERLAY_PRESETS.card, preset: "card", start: 1, opacity: 1, animate: true })
    expect(expandVideoOverlayLayer({ preset: "full-frame", start: 1 })).toMatchObject({ ...VIDEO_OVERLAY_PRESETS["full-frame"], preset: "full-frame" })
    for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      expect(expandVideoOverlayLayer({ preset: "corner-badge", corner, start: 1 })).toMatchObject({ ...VIDEO_OVERLAY_PRESETS["corner-badge"][corner], preset: "corner-badge", corner })
    }
  })
  it("returns a complete layer BY REFERENCE", () => {
    const full = { imageUrl: IMG, start: 1, anchor: "top" as const, x: 1, y: 2, width: 30, fit: "cover" as const, opacity: 0.5, animate: false }
    expect(expandVideoOverlayLayer(full)).toBe(full)
    expect(expandVideoOverlayLayer(DEFAULT_VIDEO_OVERLAY_LAYER)).toBe(DEFAULT_VIDEO_OVERLAY_LAYER)
  })
  it("an explicit box field that DIFFERS from the preset wins and clears the tag", () => {
    const l = expandVideoOverlayLayer({ preset: "card", width: 50, start: 0 })
    expect(l).toMatchObject({ anchor: "center", x: 0, y: -4, width: 50, height: 60, fit: "contain" })
    expect(l.preset).toBeUndefined()
  })
  it("a box field EQUAL to the preset keeps the tag", () => {
    expect(expandVideoOverlayLayer({ preset: "card", width: 78, start: 0 }).preset).toBe("card")
  })
  it("a height on a corner badge counts as differing (the preset sets none)", () => {
    const l = expandVideoOverlayLayer({ preset: "corner-badge", corner: "top-right", height: 30, start: 0 })
    expect(l.preset).toBeUndefined()
    expect(l).toMatchObject({ anchor: "top-right", x: -4, y: 4, width: 18, height: 30 })
  })
  it("is idempotent WITH the tag kept (the second-pass case)", () => {
    const once = expandVideoOverlayLayer({ preset: "card", start: 0 })
    expect(expandVideoOverlayLayer(once)).toBe(once)
    expect(once.preset).toBe("card")
  })
  it("an empty object is the full default, start 0 included (D2 / D8)", () => {
    expect(expandVideoOverlayLayer({})).toEqual(DEFAULT_VIDEO_OVERLAY_LAYER)
  })
  it("no preset + no box keeps the layer's own times, slot and url (D8)", () => {
    const l = expandVideoOverlayLayer({ imageUrl: IMG, start: 3, end: 5, slot: 14 })
    expect(l).toEqual({ ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: IMG, start: 3, end: 5, slot: 14 })
  })
  it("no preset + no box + no start fills start 0 (D8's spread)", () => {
    expect(expandVideoOverlayLayer({ imageUrl: IMG })).toEqual({ ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: IMG })
  })
  it("no preset + no box + its own corner gets THAT corner's badge box, idempotently (D8)", () => {
    const l = expandVideoOverlayLayer({ imageUrl: IMG, start: 2, corner: "top-left" })
    expect(l).toMatchObject({ ...VIDEO_OVERLAY_PRESETS["corner-badge"]["top-left"], preset: "corner-badge", corner: "top-left", start: 2 })
    expect(expandVideoOverlayLayer(l)).toBe(l)
  })
  it("a no-preset PARTIAL box passes through untouched (the validator refuses it)", () => {
    const partial = { start: 0, width: 40 }
    expect(expandVideoOverlayLayer(partial)).toBe(partial)
  })
  it("reads null as absent — null fields and a null layer (Review Focus 1)", () => {
    const l = expandVideoOverlayLayer({ imageUrl: IMG, start: 1, end: null, height: null, preset: null, anchor: "center", width: 30 })
    expect(l).toEqual({ imageUrl: IMG, start: 1, anchor: "center", width: 30, x: 0, y: 0, fit: "contain", opacity: 1, animate: true })
    // The single-layer form reads a null layer as `{}` (the engine assemblies never pass one —
    // they spread `raw ?? {}` — but a caller that does gets the D2 default, not a crash).
    expect(expandVideoOverlayLayer(null)).toEqual(DEFAULT_VIDEO_OVERLAY_LAYER)
    // A null SLOT in stored data is a different thing — it stays null at the write
    // boundary (normalizeVideoOverlayNodes, below).
  })
  it("an unknown preset / corner string is treated as absent", () => {
    const l = expandVideoOverlayLayer({ imageUrl: IMG, start: 0, preset: "banner" as never, corner: "middle" as never })
    expect(l).toMatchObject({ preset: "corner-badge", corner: "bottom-right", anchor: "bottom-right" })
  })
  it("the array form returns the SAME array when nothing changed", () => {
    const arr = [DEFAULT_VIDEO_OVERLAY_LAYER]
    expect(expandVideoOverlayPresets(arr)).toBe(arr)
  })
})

describe("preset click / Custom (the panel's two writers)", () => {
  it("a preset click REPLACES the six box fields — height is dropped going into corner badge", () => {
    const l = applyVideoOverlayPreset({ imageUrl: IMG, start: 2, end: 4, preset: "card", anchor: "center", x: 0, y: -4, width: 78, height: 60, fit: "contain" }, "corner-badge", "top-left")
    expect(l).toMatchObject({ imageUrl: IMG, start: 2, end: 4, preset: "corner-badge", corner: "top-left", ...VIDEO_OVERLAY_PRESETS["corner-badge"]["top-left"] })
    expect(l.height).toBeUndefined()
    expect(expandVideoOverlayLayer(l)).toBe(l)
  })
  it("Custom clears the tag and keeps the box", () => {
    const l = toCustomVideoOverlayLayer({ preset: "card", start: 1 })
    expect(l.preset).toBeUndefined()
    expect(l).toMatchObject(VIDEO_OVERLAY_PRESETS.card)
  })
})

describe("clearWiredVideoOverlayImageUrls (D10)", () => {
  it("clears only the wired slots", () => {
    const layers: VideoOverlayLayerInput[] = [{ imageUrl: IMG, start: 0 }, { imageUrl: IMG, start: 1 }]
    const out = clearWiredVideoOverlayImageUrls(layers, new Set([2]))
    expect(out[0]).toEqual({ imageUrl: IMG, start: 0 })
    expect(out[1]).toEqual({ start: 1 })
  })
  it("an empty set returns the array by reference", () => {
    const layers = [{ imageUrl: IMG, start: 0 }]
    expect(clearWiredVideoOverlayImageUrls(layers, new Set())).toBe(layers)
  })
  it("a non-object entry on a wired slot is skipped, never `in`-probed", () => {
    const layers: unknown[] = ["junk", 7, [IMG]]
    expect(clearWiredVideoOverlayImageUrls(layers as VideoOverlayLayerInput[], new Set([1, 2, 3]))).toBe(layers)
  })
  it("slots 13–20 are never touched (no handle)", () => {
    const layers = Array.from({ length: 14 }, () => ({ imageUrl: IMG, start: 0 }))
    expect(clearWiredVideoOverlayImageUrls(layers, new Set([13, 14]))).toBe(layers)
  })
})

describe("normalizeVideoOverlayNodes (the JSON write-boundary pass)", () => {
  const node = (layers: unknown[]) => ({ id: "vo", type: "video-overlay", data: { label: "Video Overlay", layers } })
  it("expands presets and clears the imageUrl of a slot the written edges wire", () => {
    const [out] = normalizeVideoOverlayNodes([node([{ imageUrl: IMG, start: 0 }, {}, { imageUrl: IMG, preset: "card", start: 1 }])], [{ target: "vo", targetHandle: "overlay3" }])
    const layers = (out!.data as { layers: VideoOverlayLayerInput[] }).layers
    expect(layers[0]).toMatchObject({ imageUrl: IMG, preset: "corner-badge" })
    expect(layers[1]).toEqual(DEFAULT_VIDEO_OVERLAY_LAYER)
    expect(layers[2]).toMatchObject({ ...VIDEO_OVERLAY_PRESETS.card, start: 1 })
    expect(layers[2]!.imageUrl).toBeUndefined()
  })
  it("returns the same array when there is nothing to do, and never touches other node types", () => {
    const nodes = [{ id: "g", type: "generate-image", data: { layers: [{}] } }, node([DEFAULT_VIDEO_OVERLAY_LAYER])]
    expect(normalizeVideoOverlayNodes(nodes, [])).toBe(nodes)
  })
  it("a non-object layer entry (an agent writing bare URL strings) does not throw and is left as stored for the validator", () => {
    const nodes = [{ id: "n", type: "video-overlay", data: { layers: ["junk", { imageUrl: IMG, start: 1 }] } }]
    const [out] = normalizeVideoOverlayNodes(nodes, [{ target: "n", targetHandle: "overlay" }])
    const layers = (out!.data as { layers: unknown[] }).layers
    expect(layers[0]).toBe("junk")
    expect(layers[1]).toEqual(expandVideoOverlayLayer({ imageUrl: IMG, start: 1 }))
    expect(validateVideoOverlayRequest({ layers: layers as VideoOverlayLayerInput[] })).toMatchObject({ ok: false, code: "layer_without_image", layer: 0 })
  })
  it("a null slot STAYS null — wired or not; only the engine assemblies and the stage synthesise the default (Review Focus 1)", () => {
    const [out] = normalizeVideoOverlayNodes([node([null, { imageUrl: IMG, start: 1 }, null])], [{ target: "vo", targetHandle: "overlay3" }])
    expect((out!.data as { layers: unknown[] }).layers).toEqual([null, expandVideoOverlayLayer({ imageUrl: IMG, start: 1 }), null])
    const clean = [node([null, DEFAULT_VIDEO_OVERLAY_LAYER])]
    expect(normalizeVideoOverlayNodes(clean, [])).toBe(clean)
  })
})

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

describe("videoOverlayRenderOrder", () => {
  it("explicit zIndex wins, ties keep array order", () => {
    expect(videoOverlayRenderOrder([{ zIndex: 5 }, {}, { zIndex: 0 }])).toEqual([2, 1, 0])
  })

  // The stage orders every slot; the worker orders the COMPACTED request
  // (empty slots dropped by the assembly, late starters dropped by the clamp).
  // A layer with no zIndex must sit at its own position in both.
  const stageSlots = (stored: ReadonlyArray<VideoOverlayLayerInput | null>): number[] =>
    videoOverlayRenderOrder(stored.map((l, i) => ({ zIndex: l?.zIndex, slot: i + 1 })))
      .filter((i) => stored[i] !== null)
      .map((i) => i + 1)

  it("stage order equals render order with an empty slot before the layers: [null, A, B{zIndex:0}] → slots [3, 2] both", () => {
    const stored: Array<VideoOverlayLayerInput | null> = [null, { imageUrl: IMG, start: 0 }, { imageUrl: IMG, start: 0, zIndex: 0 }]
    const request = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: stored }, wiredImageUrls: [] })
    // The worker's graph layers carry the request index and the stamped slot.
    const graph = request.layers.map((l, index) => ({ index, slot: l.slot, zIndex: l.zIndex }))
    const renderSlots = videoOverlayRenderOrder(graph).map((k) => graph[k]!.slot)
    expect(stageSlots(stored)).toEqual([3, 2])
    expect(renderSlots).toEqual(stageSlots(stored))
  })

  it("a layer skipped for starting after the end does not shift the others (REST request: no slots, request index)", () => {
    // [X (skipped), Y, Z{zIndex:0}] — the full request orders Z below Y; so must the kept pair.
    const full = [{ index: 0 }, { index: 1 }, { index: 2, zIndex: 0 }]
    const expected = videoOverlayRenderOrder(full).filter((i) => i !== 0)
    const kept = full.slice(1)
    expect(videoOverlayRenderOrder(kept).map((k) => kept[k]!.index)).toEqual(expected)
    expect(expected).toEqual([2, 1])
  })

  it("the same with canvas slots: a skipped slot-1 layer, slot 3 at zIndex 1 stays above slot 2", () => {
    const stored: Array<VideoOverlayLayerInput | null> = [
      { imageUrl: IMG, start: 99 },
      { imageUrl: IMG, start: 0 },
      { imageUrl: IMG, start: 0, zIndex: 1 },
    ]
    const request = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: stored }, wiredImageUrls: [] })
    const kept = request.layers.map((l, index) => ({ index, slot: l.slot, zIndex: l.zIndex })).filter((l) => l.index !== 0)
    expect(videoOverlayRenderOrder(kept).map((k) => kept[k]!.slot)).toEqual(stageSlots(stored).filter((s) => s !== 1))
  })
})

describe("hasDrawableVideoOverlayBox", () => {
  it("a complete (expanded) layer is drawable", () => {
    expect(hasDrawableVideoOverlayBox(expandVideoOverlayLayer({ imageUrl: IMG, start: 0 }))).toBe(true)
    expect(hasDrawableVideoOverlayBox(expandVideoOverlayLayer({ imageUrl: IMG, start: 0, preset: "card" }))).toBe(true)
  })

  it("a stored partial box is not — the expansion leaves it as written, the geometry would throw", () => {
    const noAnchor = { imageUrl: IMG, start: 0, width: 40 }
    const nullAnchor = { imageUrl: IMG, start: 0, anchor: null, width: 30 }
    expect(expandVideoOverlayLayer(noAnchor)).toBe(noAnchor)
    expect(hasDrawableVideoOverlayBox(noAnchor)).toBe(false)
    expect(hasDrawableVideoOverlayBox(nullAnchor)).toBe(false)
    expect(hasDrawableVideoOverlayBox({ imageUrl: IMG, start: 0, anchor: "center" })).toBe(false)
  })

  it("an unknown anchor, a non-finite width or an out-of-range field is not", () => {
    const ok = expandVideoOverlayLayer({ imageUrl: IMG, start: 0 })
    expect(hasDrawableVideoOverlayBox({ ...ok, anchor: "middle" })).toBe(false)
    expect(hasDrawableVideoOverlayBox({ ...ok, width: Number.NaN })).toBe(false)
    expect(hasDrawableVideoOverlayBox({ ...ok, width: "40" })).toBe(false)
    expect(hasDrawableVideoOverlayBox({ ...ok, x: 500 })).toBe(false)
    expect(hasDrawableVideoOverlayBox(null)).toBe(false)
    expect(hasDrawableVideoOverlayBox("layer")).toBe(false)
  })

  it("agrees with the validator: whatever it passes is drawable", () => {
    const layers = [
      expandVideoOverlayLayer({ imageUrl: IMG, start: 0, anchor: "top-left", width: 30 }),
      expandVideoOverlayLayer({ imageUrl: IMG, start: 0, preset: "full-frame" }),
    ]
    expect(validateVideoOverlayRequest({ layers }).ok).toBe(true)
    for (const l of layers) expect(hasDrawableVideoOverlayBox(l)).toBe(true)
  })
})

describe("validateVideoOverlayRequest (§3.5)", () => {
  const ok = { imageUrl: IMG, start: 0 }
  const fail = (body: Parameters<typeof validateVideoOverlayRequest>[0]) => validateVideoOverlayRequest(body) as VideoOverlayIssue
  it("returns a code, the 0-based layer, the slot when present, and params — never English", () => {
    const r = fail({ layers: [ok, ok, { imageUrl: IMG, start: 5, end: 4 }] })
    expect(r).toEqual({ ok: false, code: "end_before_start", layer: 2, params: { start: 5, end: 4 } })
    expect(formatVideoOverlayError(r)).toBe("layers[2]: end (4 s) must be after start (5 s)")
    const s = fail({ layers: [{ imageUrl: IMG, start: 5, end: 4, slot: 3 }] })
    expect(formatVideoOverlayError(s)).toBe("Layer 3: end (4 s) must be after start (5 s)")
  })
  it("layer count 1..20", () => {
    expect(fail({ layers: [] }).code).toBe("no_layers")
    const many = fail({ layers: Array.from({ length: 21 }, () => ok) })
    expect(many.code).toBe("too_many_layers")
    expect(formatVideoOverlayError(many)).toBe("At most 20 layers (got 21)")
  })
  it("times finite within 0..3600", () => {
    expect(fail({ layers: [{ imageUrl: IMG, start: -1 }] }).code).toBe("time_out_of_range")
    expect(fail({ layers: [{ imageUrl: IMG, start: 0, end: 3601 }] }).code).toBe("time_out_of_range")
    expect(fail({ layers: [{ imageUrl: IMG, start: Number.POSITIVE_INFINITY }] }).code).toBe("time_out_of_range")
  })
  it("a no-preset partial box is incomplete_box; no preset and no box is fine before AND after expansion (D8)", () => {
    const partial = fail({ layers: [{ start: 0, width: 40 }] })
    expect(partial.code).toBe("incomplete_box")
    expect(formatVideoOverlayError(partial)).toBe("layers[0]: anchor and width are required without a preset")
    expect(validateVideoOverlayRequest({ layers: [{ imageUrl: IMG, start: 0 }] })).toEqual({ ok: true })
    expect(validateVideoOverlayRequest({ layers: expandVideoOverlayPresets([{ imageUrl: IMG, start: 0 }]) })).toEqual({ ok: true })
    expect(validateVideoOverlayRequest({ layers: [{ imageUrl: IMG, start: 0, preset: "card", width: 50 }] })).toEqual({ ok: true })
  })
  it("a present box / look field outside VIDEO_OVERLAY_BOUNDS or its enum / type is field_out_of_bounds (spec §4.4, the DAG path's only check)", () => {
    const code = (extra: Record<string, unknown>) => {
      const r = validateVideoOverlayRequest({ layers: [ok, { imageUrl: IMG, start: 0, anchor: "center", width: 30, ...extra } as VideoOverlayLayerInput] })
      return r.ok ? "ok" : ([r.code, r.layer, r.params.field] as const)
    }
    expect(code({ width: 500, height: 100, fit: "cover" })).toEqual(["field_out_of_bounds", 1, "width"])
    expect(code({ width: 101 })).toEqual(["field_out_of_bounds", 1, "width"])
    expect(code({ width: "50" })).toEqual(["field_out_of_bounds", 1, "width"])
    expect(code({ x: -101 })).toEqual(["field_out_of_bounds", 1, "x"])
    expect(code({ height: 0 })).toEqual(["field_out_of_bounds", 1, "height"])
    expect(code({ y: Number.NaN })).toEqual(["field_out_of_bounds", 1, "y"])
    expect(code({ opacity: 5 })).toEqual(["field_out_of_bounds", 1, "opacity"])
    expect(code({ opacity: 9 })).toEqual(["field_out_of_bounds", 1, "opacity"])
    expect(code({ zIndex: 2.5 })).toEqual(["field_out_of_bounds", 1, "zIndex"])
    expect(code({ zIndex: -3 })).toEqual(["field_out_of_bounds", 1, "zIndex"])
    expect(code({ anchor: 7 })).toEqual(["field_out_of_bounds", 1, "anchor"])
    expect(code({ anchor: "middle" })).toEqual(["field_out_of_bounds", 1, "anchor"])
    expect(code({ fit: "stretch" })).toEqual(["field_out_of_bounds", 1, "fit"])
    expect(code({ animate: "yes" })).toEqual(["field_out_of_bounds", 1, "animate"])
    // null reads as absent; the bounds themselves are inclusive
    expect(code({ height: null, zIndex: null, opacity: null })).toBe("ok")
    expect(code({ x: -100, y: 100, width: 100, height: 1, opacity: 0, zIndex: 100, fit: "cover", animate: false })).toBe("ok")
  })
  it("field_out_of_bounds carries the slot, a symbolic range, and renders one English line", () => {
    const r = fail({ layers: [{ imageUrl: IMG, start: 0, anchor: "center", width: 30, zIndex: 2.5, slot: 4 }] })
    expect(r).toEqual({ ok: false, code: "field_out_of_bounds", layer: 0, slot: 4, params: { field: "zIndex", allowed: "integers 0..100" } })
    expect(formatVideoOverlayError(r)).toBe("Layer 4: zIndex is out of range (allowed: integers 0..100)")
    expect(fail({ layers: [{ imageUrl: IMG, start: 0, anchor: "center", width: 30, fit: "stretch" } as unknown as VideoOverlayLayerInput] }).params).toEqual({ field: "fit", allowed: "contain, cover" })
  })
  it("the bounds verdict is the same before and after the expansion (§3.5 order-independence)", () => {
    const bad = [{ imageUrl: IMG, start: 0, preset: "card" as const, width: 500 }]
    expect(fail({ layers: bad }).code).toBe("field_out_of_bounds")
    expect(fail({ layers: expandVideoOverlayPresets(bad) }).code).toBe("field_out_of_bounds")
    const good = [{ imageUrl: IMG, start: 0, preset: "card" as const }]
    expect(validateVideoOverlayRequest({ layers: good })).toEqual({ ok: true })
    expect(validateVideoOverlayRequest({ layers: expandVideoOverlayPresets(good) })).toEqual({ ok: true })
    const noBoxBadLook = [{ imageUrl: IMG, start: 0, opacity: 5 }]
    expect(fail({ layers: noBoxBadLook }).code).toBe("field_out_of_bounds")
    expect(fail({ layers: expandVideoOverlayPresets(noBoxBadLook) }).code).toBe("field_out_of_bounds")
  })
  it("an assembled JSON-written layer with an unbounded box is refused before it reaches the geometry (the DAG path)", () => {
    const req = assembleVideoOverlayRequest({
      videoUrl: "v",
      data: { layers: [{ anchor: "center", width: 100000, height: 100, fit: "cover", start: 0 } as VideoOverlayLayerInput] },
      wiredImageUrls: [IMG],
    })
    expect(validateVideoOverlayRequest(req)).toMatchObject({ ok: false, code: "field_out_of_bounds", slot: 1, params: { field: "width" } })
    const anchor = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [{ anchor: 7, width: 30, start: 0 } as unknown as VideoOverlayLayerInput] }, wiredImageUrls: [IMG] })
    expect(validateVideoOverlayRequest(anchor)).toMatchObject({ ok: false, code: "field_out_of_bounds", params: { field: "anchor" } })
  })
  it("every layer needs an image", () => {
    expect(fail({ layers: [{ start: 0 }] }).code).toBe("layer_without_image")
  })
  it("baseFit / backgroundColor only with an outputAspect", () => {
    expect(fail({ layers: [ok], baseFit: "contain" }).code).toBe("fit_without_aspect")
    expect(validateVideoOverlayRequest({ layers: [ok], outputAspect: "9:16", baseFit: "contain", backgroundColor: "#ff0000" })).toEqual({ ok: true })
  })
})

describe("assembleVideoOverlayRequest (the ONE assembly both engines call)", () => {
  it("a wired slot with no settings runs as the default layer, slot stamped (D2)", () => {
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [] }, wiredImageUrls: ["https://x/1.png"] })
    expect(r.layers).toEqual([{ ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: "https://x/1.png", slot: 1 }])
  })
  it("wired wins over a stored imageUrl; an imageUrl-only layer 13 is kept with slot 13; an empty unwired slot is dropped", () => {
    const layers: Array<VideoOverlayLayerInput | null> = Array.from({ length: 13 }, () => null)
    layers[0] = { imageUrl: "https://x/stored.png", start: 2 }
    layers[12] = { imageUrl: "https://x/13.png", start: 1, preset: "card" }
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers }, wiredImageUrls: ["https://x/wired.png"] })
    expect(r.layers.map((l) => [l.slot, l.imageUrl])).toEqual([[1, "https://x/wired.png"], [13, "https://x/13.png"]])
    expect(r.layers[0]).toMatchObject({ start: 2, preset: "corner-badge" })
  })
  it("a null slot that is wired is the default layer (Review Focus 1)", () => {
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [null, { start: 3 }] }, wiredImageUrls: ["https://x/1.png", "https://x/2.png"] })
    expect(r.layers[0]).toEqual({ ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: "https://x/1.png", slot: 1 })
    expect(r.layers[1]).toMatchObject({ start: 3, slot: 2 })
  })
  it("a non-object layer entry reads as an empty slot: the D2 default when wired, dropped when not — never spread", () => {
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: ["ab", "https://x/unwired.png"] as unknown as VideoOverlayLayerInput[] }, wiredImageUrls: ["https://x/1.png"] })
    expect(r.layers).toEqual([{ ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: "https://x/1.png", slot: 1 }])
    expect(r.layers[0]).not.toHaveProperty("0")
    expect(expandVideoOverlayLayer("ab" as unknown as VideoOverlayLayerInput)).toEqual(DEFAULT_VIDEO_OVERLAY_LAYER)
  })
  it("carries every stored slot past 20, so the validator refuses the request (too_many_layers) instead of dropping layers 21+", () => {
    const layers = Array.from({ length: 25 }, () => ({ imageUrl: "https://x/i.png", start: 0 }))
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers }, wiredImageUrls: [] })
    expect(r.layers).toHaveLength(25)
    expect(r.layers.at(-1)!.slot).toBe(25)
    expect(validateVideoOverlayRequest(r)).toEqual({ ok: false, code: "too_many_layers", params: { max: 20, count: 25 } })
  })
  it("21+ stored slots without an image are still dropped — only layers that render count toward the cap", () => {
    const layers: Array<VideoOverlayLayerInput | null> = Array.from({ length: 25 }, () => null)
    layers[0] = { imageUrl: "https://x/i.png", start: 0 }
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers }, wiredImageUrls: [] })
    expect(r.layers.map((l) => l.slot)).toEqual([1])
    expect(validateVideoOverlayRequest(r)).toEqual({ ok: true })
  })
  it("keeps the 12-handle cap on the wired list: a 13th wired URL is ignored", () => {
    const wired = Array.from({ length: 13 }, (_, i) => `https://x/w${i}.png`)
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [] }, wiredImageUrls: wired })
    expect(r.layers).toHaveLength(12)
  })
  it("carries baseFit / backgroundColor as stored — the VALIDATOR refuses them without an outputAspect (spec §3.5 fit_without_aspect)", () => {
    const base = { layers: [{ imageUrl: IMG, start: 0 }], baseFit: "contain", backgroundColor: "#ff0000" }
    const noAspect = assembleVideoOverlayRequest({ videoUrl: "v", data: base, wiredImageUrls: [] })
    expect(noAspect).toMatchObject({ baseFit: "contain", backgroundColor: "#ff0000" })
    expect(noAspect).not.toHaveProperty("outputAspect")
    expect(validateVideoOverlayRequest(noAspect)).toMatchObject({ ok: false, code: "fit_without_aspect" })
    expect(assembleVideoOverlayRequest({ videoUrl: "v", data: { ...base, outputAspect: "9:16" }, wiredImageUrls: [] })).toMatchObject({ outputAspect: "9:16", baseFit: "contain", backgroundColor: "#ff0000" })
  })
  it("never forwards a value the route's schema would refuse: an unknown aspect or fit, a colour that is not #rrggbb", () => {
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [{ imageUrl: IMG, start: 0 }], outputAspect: "3:2", baseFit: "stretch", backgroundColor: "red" }, wiredImageUrls: [] })
    expect(Object.keys(r).sort()).toEqual(["layers", "videoUrl"])
  })
})

describe("videoOverlaySlotSources — wired ?? imageUrl, by slot", () => {
  it("a wire wins; an unwired slot draws its own imageUrl; neither is undefined", () => {
    expect(
      videoOverlaySlotSources(
        [{ imageUrl: "https://x/own0.png" }, null, { imageUrl: "https://x/own2.png" }],
        ["https://x/wired0.png", undefined, undefined, "https://x/wired3.png"],
      ),
    ).toEqual(["https://x/wired0.png", undefined, "https://x/own2.png", "https://x/wired3.png"])
  })
  it("a layer's own imageUrl is its source at any slot — past 20 too (layers 1–4 removed from a 24-layer node)", () => {
    const layers: Array<VideoOverlayLayerInput | null> = Array.from({ length: 24 }, (_, i) => ({ imageUrl: `https://x/${i}.png` }))
    for (const i of [0, 1, 2, 3]) layers[i] = null
    const sources = videoOverlaySlotSources(layers, [])
    expect(sources).toHaveLength(24)
    expect(sources.slice(0, 4)).toEqual([undefined, undefined, undefined, undefined])
    expect(sources[23]).toBe("https://x/23.png")
    expect(sources.filter(Boolean)).toHaveLength(20)
  })
  it("wired handles stay capped at 12: a 13th wired URL is no source, the slot's own imageUrl still is", () => {
    const wired = Array.from({ length: 14 }, (_, i) => `https://x/w${i}.png`)
    const layers: Array<VideoOverlayLayerInput | null> = Array.from({ length: 13 }, () => null)
    layers[12] = { imageUrl: "https://x/own13.png" }
    const sources = videoOverlaySlotSources(layers, wired)
    expect(sources).toHaveLength(13)
    expect(sources[11]).toBe("https://x/w11.png")
    expect(sources[12]).toBe("https://x/own13.png")
    expect(videoOverlaySlotSources([], wired)).toHaveLength(12)
  })
  it("the composition key follows a slot past 20: another image at slot 24 is another key", () => {
    const layers = (url: string): Array<VideoOverlayLayerInput | null> => [null, null, null, null, ...Array.from({ length: 19 }, (_, i) => ({ imageUrl: `https://x/${i}.png` })), { imageUrl: url }]
    const key = (url: string) => videoOverlayCompositionKey({ baseUrl: "b", sources: videoOverlaySlotSources(layers(url), []), data: { layers: layers(url) } })
    const a = layers("https://x/a.png")
    expect(videoOverlaySlotSources(a, [])[23]).toBe("https://x/a.png")
    expect(key("https://x/a.png")).not.toBe(key("https://x/b.png"))
    expect(JSON.parse(key("https://x/a.png"))[1]).toHaveLength(24)
  })
  it("reads non-array layers as none", () => {
    expect(videoOverlaySlotSources(null, ["https://x/w.png"])).toEqual(["https://x/w.png"])
  })
})

describe("videoOverlayCompositionKey — what a run stamps as resultCompositionKey (audit U10)", () => {
  const base = { baseUrl: "https://x/base.mp4", sources: ["https://x/a.png"], data: { layers: [{ start: 1 }] } }
  const key = videoOverlayCompositionKey(base)

  it("changes with the base video, a slot's image, the layers, the aspect, the fit and the pad colour", () => {
    const variants = [
      { ...base, baseUrl: "https://x/other.mp4" },
      { ...base, sources: ["https://x/b.png"] },
      { ...base, data: { ...base.data, layers: [{ start: 2 }] } },
      { ...base, data: { ...base.data, outputAspect: "9:16" } },
      { ...base, data: { ...base.data, baseFit: "contain" } },
      { ...base, data: { ...base.data, backgroundColor: "#ff0000" } },
    ]
    for (const v of variants) expect(videoOverlayCompositionKey(v)).not.toBe(key)
  })

  it("is canonical: a layer's key order does not change it (a jsonb round-trip reorders keys; the canvas keeps insertion order)", () => {
    const canvas: VideoOverlayLayerInput = { imageUrl: IMG, start: 1, end: 4, preset: "card", anchor: "center", x: 0, y: -4, width: 78, height: 60, fit: "contain", opacity: 1, animate: true }
    const fromDb: VideoOverlayLayerInput = { x: 0, y: -4, end: 4, fit: "contain", start: 1, width: 78, anchor: "center", height: 60, preset: "card", animate: true, opacity: 1, imageUrl: IMG }
    expect(videoOverlayCompositionKey({ ...base, data: { layers: [canvas] } })).toBe(videoOverlayCompositionKey({ ...base, data: { layers: [fromDb] } }))
  })

  it("an absent, undefined or null layer field is the same key (the assembly reads all three as absent); a null SLOT keeps its place", () => {
    const k = videoOverlayCompositionKey({ ...base, data: { layers: [{ start: 1 }] } })
    expect(videoOverlayCompositionKey({ ...base, data: { layers: [{ start: 1, end: undefined }] } })).toBe(k)
    expect(videoOverlayCompositionKey({ ...base, data: { layers: [{ start: 1, end: null } as unknown as VideoOverlayLayerInput] } })).toBe(k)
    expect(videoOverlayCompositionKey({ ...base, data: { layers: [null, { start: 1 }] } })).not.toBe(k)
  })

  it("an unset top-level field is the same key whether absent, undefined or null", () => {
    expect(videoOverlayCompositionKey({ ...base, data: { ...base.data, outputAspect: undefined, baseFit: null } })).toBe(key)
    expect(videoOverlayCompositionKey({ ...base, baseUrl: undefined })).toBe(videoOverlayCompositionKey({ ...base, baseUrl: null }))
  })

  it("trailing empty slots do not change it: a wired list with an unfilled last handle equals the shorter list", () => {
    expect(videoOverlayCompositionKey({ ...base, sources: ["https://x/a.png", undefined, null] })).toBe(key)
    expect(videoOverlayCompositionKey({ ...base, sources: [undefined, "https://x/a.png"] })).not.toBe(key)
  })
})

describe("VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH — the bound the REST route accepts the canvas key under", () => {
  it("fits a full 20-layer composition with long signed URLs on every slot and every stored layer", () => {
    const url = (i: number) => `https://storage.example/bucket/${"p".repeat(400)}/${i}.png?X-Signature=${"s".repeat(200)}`
    const layers: VideoOverlayLayerInput[] = Array.from({ length: VIDEO_OVERLAY_MAX_LAYERS }, (_, i) => ({
      imageUrl: url(i), start: 1234.567, end: 2345.678, preset: "corner-badge", corner: "bottom-right", anchor: "bottom-right",
      x: -4, y: -4, width: 18, height: 60, fit: "contain", opacity: 0.5, animate: true, zIndex: 100,
    }))
    const key = videoOverlayCompositionKey({
      baseUrl: url(99),
      sources: layers.map((_, i) => url(i + 100)),
      data: { layers, outputAspect: "9:16", baseFit: "contain", backgroundColor: "#101010" },
    })
    expect(key.length).toBeLessThan(VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH)
  })
})
