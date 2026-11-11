import { describe, it, expect } from "vitest"
import { assembleVideoOverlayRequest, expandVideoOverlayLayer, expandVideoOverlayPresets, type VideoOverlayLayerInput } from "../video-overlay.js"
import { formatVideoOverlayError, hasDrawableVideoOverlayBox, validateVideoOverlayRequest, type VideoOverlayIssue } from "../video-overlay-validate.js"

const IMG = "https://cdn.example/a.png"

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
