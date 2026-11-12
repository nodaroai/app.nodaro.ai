import { describe, it, expect } from "vitest"
import {
  VIDEO_OVERLAY_LAYOUT_IDS,
  isVideoOverlayLayoutId,
  videoOverlayLayoutNeedsAspect,
  videoOverlayLayoutNeedsVideoLayer,
  videoOverlayLayoutPlacesBase,
} from "../video-overlay-layout-ids.js"
import {
  VIDEO_OVERLAY_ASPECT_BOUNDS,
  VIDEO_OVERLAY_PIP_INSET,
  VIDEO_OVERLAY_PIP_WIDTH,
  clampVideoOverlayAspect,
  evenVideoOverlayRect,
  expandVideoOverlayLayout,
  firstVideoLayerIndex,
  placeVideoOverlayVideos,
  resolveVideoOverlayBaseRect,
  resolveVideoOverlayStackRects,
} from "../video-overlay-layouts.js"
import {
  VIDEO_OVERLAY_ERROR_CODES,
  VIDEO_OVERLAY_OUTPUT_ASPECTS,
  assembleVideoOverlayRequest,
  expandVideoOverlayLayer,
  videoOverlayCompositionKey,
  type ExpandedVideoOverlayRequest,
  type VideoOverlayBox,
  type VideoOverlayLayerInput,
} from "../video-overlay.js"
import { resolveVideoOverlayGeometry, videoOverlayCanvas, type VideoOverlayCanvas } from "../video-overlay-geometry.js"
import { formatVideoOverlayError, validateVideoOverlayRequest, type VideoOverlayIssue, type VideoOverlayValidationInput } from "../video-overlay-validate.js"

const V = "https://cdn.example/v.mp4"
const I = "https://cdn.example/i.png"
const BOX: VideoOverlayBox = { anchor: "center", x: 0, y: 10, width: 80, height: 40, fit: "cover" }
const videoLayer: VideoOverlayLayerInput = { videoUrl: V, start: 0 }
const imageLayer: VideoOverlayLayerInput = { imageUrl: I, start: 0 }
const codeOf = (body: VideoOverlayValidationInput) => {
  const r = validateVideoOverlayRequest(body)
  return r.ok ? "ok" : r.code
}
/** First video layers the validator refuses: each must reach it unrepaired by a layout. */
const malformedFirstVideoLayers: VideoOverlayLayerInput[] = [
  { videoUrl: V, start: 0, anchor: "center", width: 500 },
  { videoUrl: V, start: 0, width: 50 },
  { videoUrl: V, start: 0, anchor: "middle", width: 30 } as unknown as VideoOverlayLayerInput,
  { videoUrl: V, start: 0, anchor: "center", width: 30, height: 0 },
  { videoUrl: V, start: 0, anchor: "center", width: 30, fit: "stretch" } as unknown as VideoOverlayLayerInput,
  { videoUrl: V, start: 0, animate: "yes" } as unknown as VideoOverlayLayerInput,
  { videoUrl: V, start: 0, opacity: 5 },
  { videoUrl: V, start: -1 },
  { videoUrl: V, imageUrl: I, start: 0 },
  { videoUrl: V, start: 0, sound: { volume: 2 } },
]
const stack = resolveVideoOverlayStackRects
const CANVASES = VIDEO_OVERLAY_OUTPUT_ASPECTS.map((a) => videoOverlayCanvas(null, a)!)
const ASPECTS = [16 / 9, 9 / 16, 1, 4 / 3, 21 / 9, 4 / 5, 1920 / 1080, 720 / 1280]
const SHAPE_TABLE: Array<readonly [VideoOverlayCanvas, number, number]> = CANVASES.flatMap((c) =>
  ASPECTS.flatMap((a) => ASPECTS.map((b) => [c, a, b] as const)),
)

describe("layout ids", () => {
  it("are the five named layouts", () => {
    expect(VIDEO_OVERLAY_LAYOUT_IDS).toEqual(["video-bottom", "video-top", "stack-whole", "stack-filled", "pip"])
    expect(isVideoOverlayLayoutId("pip")).toBe(true)
    expect(isVideoOverlayLayoutId("stack")).toBe(false)
    expect(isVideoOverlayLayoutId(null)).toBe(false)
  })
  it("every layout but pip needs an output aspect; stacks and pip need a video layer; only the stacks place the base themselves", () => {
    expect(VIDEO_OVERLAY_LAYOUT_IDS.filter(videoOverlayLayoutNeedsAspect)).toEqual(["video-bottom", "video-top", "stack-whole", "stack-filled"])
    expect(VIDEO_OVERLAY_LAYOUT_IDS.filter(videoOverlayLayoutNeedsVideoLayer)).toEqual(["stack-whole", "stack-filled", "pip"])
    expect(VIDEO_OVERLAY_LAYOUT_IDS.filter(videoOverlayLayoutPlacesBase)).toEqual(["stack-whole", "stack-filled"])
  })
})

describe("resolveVideoOverlayStackRects", () => {
  it("two 16:9 on 9:16", () =>
    expect(stack("stack-whole", { w: 1080, h: 1920 }, 16 / 9, 16 / 9)).toEqual({
      top: { left: 0, top: 354, width: 1080, height: 606 },
      bottom: { left: 0, top: 960, width: 1080, height: 606 },
    }))
  it("different shapes centre the pair", () =>
    expect(stack("stack-whole", { w: 1080, h: 1920 }, 16 / 9, 1)).toEqual({
      top: { left: 0, top: 117, width: 1080, height: 606 },
      bottom: { left: 0, top: 723, width: 1080, height: 1080 },
    }))
  it("shrinks together when too tall", () =>
    expect(stack("stack-whole", { w: 1080, h: 1080 }, 16 / 9, 16 / 9)).toEqual({
      top: { left: 60, top: 0, width: 960, height: 540 },
      bottom: { left: 60, top: 540, width: 960, height: 540 },
    }))
  it("filled splits with no gap on an odd half", () =>
    expect(stack("stack-filled", { w: 1080, h: 1350 }, 16 / 9, 16 / 9)).toEqual({
      top: { left: 0, top: 0, width: 1080, height: 674 },
      bottom: { left: 0, top: 674, width: 1080, height: 676 },
    }))
  it("the join is exact for every shape", () => {
    for (const [c, a, b] of SHAPE_TABLE) {
      const r = stack("stack-whole", c, a, b)
      expect(r.top.top + r.top.height).toBe(r.bottom.top)
    }
  })
  it("whole: both the same width, even sizes, inside the canvas, equal room above and below (±1 px)", () => {
    for (const [c, a, b] of SHAPE_TABLE) {
      const { top, bottom } = stack("stack-whole", c, a, b)
      expect(top.width).toBe(bottom.width)
      expect(top.left).toBe(bottom.left)
      for (const r of [top, bottom]) {
        expect(r.width % 2).toBe(0)
        expect(r.height % 2).toBe(0)
        expect(r.left).toBeGreaterThanOrEqual(0)
        expect(r.top).toBeGreaterThanOrEqual(0)
        expect(r.left + r.width).toBeLessThanOrEqual(c.w)
        expect(r.top + r.height).toBeLessThanOrEqual(c.h)
      }
      const below = c.h - (bottom.top + bottom.height)
      expect(Math.abs(below - top.top)).toBeLessThanOrEqual(1)
    }
  })
  it("filled: the two halves cover the whole canvas, whatever the sources' shapes", () => {
    for (const c of CANVASES) {
      const { top, bottom } = stack("stack-filled", c, 16 / 9, 9 / 16)
      expect(top).toMatchObject({ left: 0, top: 0, width: c.w })
      expect(bottom).toMatchObject({ left: 0, top: top.height, width: c.w })
      expect(top.height + bottom.height).toBe(c.h)
    }
  })
  it("an unreadable aspect reads as square, as in the layer geometry", () => {
    expect(stack("stack-whole", { w: 1080, h: 1920 }, Number.NaN, 0)).toEqual(stack("stack-whole", { w: 1080, h: 1920 }, 1, 1))
  })
})

describe("resolveVideoOverlayBaseRect — a placed base sits flush on its anchored edge", () => {
  const PORTRAIT = { w: 1080, h: 1920 }
  const edge = (anchor: "bottom" | "top"): VideoOverlayBox => ({ anchor, x: 0, y: 0, width: 100, fit: "contain" })
  it("a 16:9 base against the bottom of 9:16", () =>
    expect(resolveVideoOverlayBaseRect(PORTRAIT, edge("bottom"), 16 / 9)).toEqual({ left: 0, top: 1314, width: 1080, height: 606 }))
  it("a 16:9 base against the top of 9:16", () =>
    expect(resolveVideoOverlayBaseRect(PORTRAIT, edge("top"), 16 / 9)).toEqual({ left: 0, top: 0, width: 1080, height: 606 }))
  it("cover with an explicit height fills the box exactly", () => {
    expect(resolveVideoOverlayBaseRect(PORTRAIT, { anchor: "center", x: 0, y: 0, width: 100, height: 50, fit: "cover" }, 16 / 9)).toEqual({ left: 0, top: 480, width: 1080, height: 960 })
    expect(resolveVideoOverlayBaseRect(PORTRAIT, { anchor: "bottom", x: 0, y: 0, width: 100, height: 50, fit: "cover" }, 16 / 9)).toEqual({ left: 0, top: 960, width: 1080, height: 960 })
  })
  it("offsets move it in % of the canvas", () =>
    expect(resolveVideoOverlayBaseRect(PORTRAIT, { ...edge("bottom"), y: -10 }, 16 / 9)).toEqual({ left: 0, top: 1122, width: 1080, height: 606 }))
  it("its size is the layer geometry's drawn size (same clamp, same even rounding)", () => {
    const boxes: VideoOverlayBox[] = [edge("bottom"), BOX, { anchor: "top-left", x: 4, y: 4, width: 30, fit: "contain" }, { anchor: "center", x: 0, y: 0, width: 100, fit: "contain" }]
    for (const c of CANVASES) {
      for (const box of boxes) {
        for (const aspect of ASPECTS) {
          const { drawn } = resolveVideoOverlayGeometry(c, box, aspect)
          const r = resolveVideoOverlayBaseRect(c, box, aspect)
          expect([r.width, r.height]).toEqual([drawn.width, drawn.height])
        }
      }
    }
  })
})

describe("clampVideoOverlayAspect — a probed video's aspect, bounded before any geometry", () => {
  it("keeps every aspect inside [1/8, 8] as it is", () => {
    expect(VIDEO_OVERLAY_ASPECT_BOUNDS).toEqual([1 / 8, 8])
    for (const a of [16 / 9, 9 / 16, 1, 1 / 8, 8]) expect(clampVideoOverlayAspect(a)).toBe(a)
  })
  it("clamps a wider or taller one to the bound", () => {
    expect(clampVideoOverlayAspect(20)).toBe(8)
    expect(clampVideoOverlayAspect(1 / 1000)).toBe(1 / 8)
  })
  it("reads an unusable one as square, as the layer geometry does", () => {
    for (const a of [Number.NaN, 0, -2, Number.POSITIVE_INFINITY]) expect(clampVideoOverlayAspect(a)).toBe(1)
  })
  it("a stack of clamped aspects never leaves the canvas, whatever the probes said", () => {
    const EXTREMES = [1 / 1000, 1 / 9, 1 / 8, 1, 8, 9, 1000]
    for (const c of CANVASES) {
      for (const a of EXTREMES) {
        for (const b of EXTREMES) {
          const { top, bottom } = stack("stack-whole", c, clampVideoOverlayAspect(a), clampVideoOverlayAspect(b))
          for (const r of [top, bottom]) {
            expect(r.left).toBeGreaterThanOrEqual(0)
            expect(r.top).toBeGreaterThanOrEqual(0)
            expect(r.left + r.width).toBeLessThanOrEqual(c.w)
            expect(r.top + r.height).toBeLessThanOrEqual(c.h)
          }
        }
      }
    }
  })
})

describe("evenVideoOverlayRect — what the render draws, since overlay snaps odd offsets to even", () => {
  it("floors an odd left and top to even, as overlay does on yuv420", () => {
    expect(evenVideoOverlayRect({ left: 371, top: 117, width: 606, height: 1080 })).toEqual({ left: 370, top: 116, width: 606, height: 1080 })
  })
  it("floors a negative odd offset down too (overlay clears the low bit)", () => {
    expect(evenVideoOverlayRect({ left: -61, top: -1, width: 1200, height: 676 })).toEqual({ left: -62, top: -2, width: 1200, height: 676 })
  })
  it("floors an odd size to even", () => {
    expect(evenVideoOverlayRect({ left: 0, top: 0, width: 607, height: 341 })).toEqual({ left: 0, top: 0, width: 606, height: 340 })
  })
  it("returns an even rect by reference", () => {
    const r = { left: 0, top: 1314, width: 1080, height: 606 }
    expect(evenVideoOverlayRect(r)).toBe(r)
  })
  it("keeps a stack's join exact: both tops move by the same pixel", () => {
    for (const [c, a, b] of SHAPE_TABLE) {
      const r = stack("stack-whole", c, a, b)
      const top = evenVideoOverlayRect(r.top)
      const bottom = evenVideoOverlayRect(r.bottom)
      expect(top.top + top.height).toBe(bottom.top)
      expect(top.top % 2).toBe(0)
    }
  })
  it("16:9 above 1:1 on 9:16 draws at 116 and 722", () => {
    const r = stack("stack-whole", { w: 1080, h: 1920 }, 16 / 9, 1)
    expect([evenVideoOverlayRect(r.top).top, evenVideoOverlayRect(r.bottom).top]).toEqual([116, 722])
  })
})

describe("firstVideoLayerIndex — the lowest video layer by render order", () => {
  it("skips image layers and follows zIndex", () => {
    const layers: VideoOverlayLayerInput[] = [
      { imageUrl: I, start: 0, slot: 1 },
      { videoUrl: V, start: 0, slot: 2, zIndex: 50 },
      { videoUrl: V, start: 0, slot: 3 },
    ]
    expect(firstVideoLayerIndex(layers)).toBe(2)
    expect(firstVideoLayerIndex(layers.slice(0, 2))).toBe(1)
  })
  it("-1 with no video layer, and for anything that is not a list", () => {
    expect(firstVideoLayerIndex([imageLayer, null, undefined])).toBe(-1)
    expect(firstVideoLayerIndex([])).toBe(-1)
    expect(firstVideoLayerIndex(null)).toBe(-1)
  })
})

describe("expandVideoOverlayLayout — a layout writes the boxes", () => {
  it("video-bottom writes the base box", () =>
    expect(expandVideoOverlayLayout({ layout: "video-bottom", outputAspect: "9:16", layers: [] }).baseBox).toEqual({ anchor: "bottom", x: 0, y: 0, width: 100, fit: "contain" }))
  it("video-top writes the base box", () =>
    expect(expandVideoOverlayLayout({ layout: "video-top", outputAspect: "9:16", layers: [] }).baseBox).toEqual({ anchor: "top", x: 0, y: 0, width: 100, fit: "contain" }))
  it("pip puts the first video in its corner", () =>
    expect(expandVideoOverlayLayout({ layout: "pip", layers: [{ videoUrl: V, start: 0, corner: "top-left" }] }).layers[0]).toMatchObject({
      anchor: "top-left",
      x: 4,
      y: 4,
      width: 30,
      fit: "contain",
      animate: false,
    }))
  it("an explicit base box wins over the layout", () =>
    expect(expandVideoOverlayLayout({ layout: "video-bottom", baseBox: BOX, layers: [] }).baseBox).toEqual(BOX))

  it("pip defaults to bottom-right, 30 % wide, 4 % in, and replaces the layer's box, height and preset tag", () => {
    expect([VIDEO_OVERLAY_PIP_WIDTH, VIDEO_OVERLAY_PIP_INSET]).toEqual([30, 4])
    const layer: VideoOverlayLayerInput = {
      videoUrl: V, start: 1, end: 9, slot: 2, sound: { volume: 0.5 }, opacity: 0.8,
      preset: "card", anchor: "center", x: 0, y: -4, width: 78, height: 60, fit: "cover", animate: true,
    }
    const out = expandVideoOverlayLayout({ layout: "pip", layers: [imageLayer, layer] })
    expect(out.layers[0]).toBe(imageLayer)
    expect(out.layers[1]).toEqual({
      videoUrl: V, start: 1, end: 9, slot: 2, sound: { volume: 0.5 }, opacity: 0.8,
      anchor: "bottom-right", x: -4, y: -4, width: 30, fit: "contain", animate: false,
    })
    expect(out.baseBox).toBeUndefined()
  })
  it("pip places the lowest video layer only", () => {
    const layers: VideoOverlayLayerInput[] = [{ videoUrl: V, start: 0, slot: 1, zIndex: 9 }, { videoUrl: V, start: 0, slot: 2 }]
    const out = expandVideoOverlayLayout({ layout: "pip", layers })
    expect(out.layers[0]).toBe(layers[0])
    expect(out.layers[1]).toMatchObject({ anchor: "bottom-right", width: 30 })
  })
  it("stack layouts leave every box unset and turn the first video layer's animation off", () => {
    for (const layout of ["stack-whole", "stack-filled"] as const) {
      const layers: VideoOverlayLayerInput[] = [imageLayer, { videoUrl: V, start: 0, animate: true }]
      const out = expandVideoOverlayLayout({ layout, outputAspect: "9:16", layers })
      expect(out.baseBox).toBeUndefined()
      expect(out.layers[0]).toBe(imageLayer)
      expect(out.layers[1]).toEqual({ videoUrl: V, start: 0, animate: false })
    }
  })
  it("an explicit base box gets the layer's trailing defaults (x 0, y 0, fit contain); a partial one is left for the validator", () => {
    expect(expandVideoOverlayLayout({ baseBox: { anchor: "bottom", width: 100 }, layers: [] }).baseBox).toEqual({ anchor: "bottom", width: 100, x: 0, y: 0, fit: "contain" })
    expect(expandVideoOverlayLayout({ baseBox: { anchor: "top", width: 50, height: null }, layers: [] }).baseBox).toEqual({ anchor: "top", width: 50, x: 0, y: 0, fit: "contain" })
    const partial = { width: 50 }
    expect(expandVideoOverlayLayout({ baseBox: partial, layers: [] }).baseBox).toBe(partial)
  })
  it("returns the request by reference when there is nothing to write, and is idempotent", () => {
    const plain = { layers: [imageLayer], outputAspect: "9:16" }
    expect(expandVideoOverlayLayout(plain)).toBe(plain)
    const unknown = { layout: "stack", layers: [videoLayer] }
    expect(expandVideoOverlayLayout(unknown)).toBe(unknown)
    const noVideo = { layout: "pip", layers: [imageLayer] }
    expect(expandVideoOverlayLayout(noVideo)).toBe(noVideo)
    for (const layout of VIDEO_OVERLAY_LAYOUT_IDS) {
      const once = expandVideoOverlayLayout({ layout, outputAspect: "9:16", layers: [imageLayer, { videoUrl: V, start: 0, corner: "top-right" }] })
      expect(expandVideoOverlayLayout(once)).toBe(once)
    }
  })
  it("never mutates its input", () => {
    const layer = Object.freeze({ videoUrl: V, start: 0, animate: true })
    const req = Object.freeze({ layout: "pip", baseBox: Object.freeze({ anchor: "bottom", width: 100 }), layers: Object.freeze([layer]) })
    const out = expandVideoOverlayLayout(req)
    expect(out).not.toBe(req)
    expect(req.layers[0]).toEqual({ videoUrl: V, start: 0, animate: true })
    expect(req.baseBox).toEqual({ anchor: "bottom", width: 100 })
  })
})

describe("validateVideoOverlayRequest — the base box and layouts", () => {
  it("refuses a stack with no aspect", () => expect(codeOf({ layout: "stack-whole", layers: [videoLayer] })).toBe("layout_needs_aspect"))
  it("refuses a stack with no video layer", () => expect(codeOf({ layout: "stack-whole", outputAspect: "9:16", layers: [imageLayer] })).toBe("layout_needs_video_layer"))
  it("refuses a base box with no aspect", () => expect(codeOf({ baseBox: BOX, layers: [imageLayer] })).toBe("base_box_needs_aspect"))

  it("the three codes are in the list", () => {
    expect(VIDEO_OVERLAY_ERROR_CODES).toEqual(expect.arrayContaining(["base_box_needs_aspect", "layout_needs_aspect", "layout_needs_video_layer"]))
  })
  it("each layout's needs, and nothing more", () => {
    expect(codeOf({ layout: "pip", layers: [videoLayer] })).toBe("ok")
    expect(codeOf({ layout: "pip", outputAspect: "9:16", layers: [imageLayer] })).toBe("layout_needs_video_layer")
    expect(codeOf({ layout: "video-bottom", layers: [imageLayer] })).toBe("layout_needs_aspect")
    expect(codeOf({ layout: "video-top", outputAspect: "9:16", layers: [imageLayer] })).toBe("ok")
    expect(codeOf({ layout: "stack-filled", outputAspect: "1:1", layers: [imageLayer, videoLayer] })).toBe("ok")
    expect(codeOf({ baseBox: BOX, outputAspect: "4:5", layers: [imageLayer] })).toBe("ok")
  })
  it("a base box follows the layer rule: anchor and width, every present field in range", () => {
    const fail = (baseBox: unknown) => validateVideoOverlayRequest({ outputAspect: "9:16", layers: [imageLayer], baseBox: baseBox as VideoOverlayBox }) as VideoOverlayIssue
    const incomplete = fail({ width: 50 })
    expect(incomplete).toEqual({ ok: false, code: "incomplete_box", params: { field: "baseBox" } })
    expect(formatVideoOverlayError(incomplete)).toBe("baseBox needs an anchor and a width")
    expect(fail({}).code).toBe("incomplete_box")
    expect(fail("bottom").code).toBe("incomplete_box")
    const wide = fail({ anchor: "bottom", width: 101 })
    expect(wide).toEqual({ ok: false, code: "field_out_of_bounds", params: { field: "baseBox.width", allowed: "1..100" } })
    expect(formatVideoOverlayError(wide)).toBe("baseBox.width is out of range (allowed: 1..100)")
    expect(fail({ anchor: "middle", width: 50 }).params.field).toBe("baseBox.anchor")
    expect(fail({ anchor: "bottom", width: 50, fit: "stretch" }).params.field).toBe("baseBox.fit")
    expect(validateVideoOverlayRequest({ outputAspect: "9:16", layers: [imageLayer], baseBox: { anchor: "bottom", width: 50, height: null } })).toEqual({ ok: true })
  })
  it("an unknown layout is refused, not ignored", () => {
    const r = validateVideoOverlayRequest({ outputAspect: "9:16", layers: [videoLayer], layout: "stack" }) as VideoOverlayIssue
    expect(r).toEqual({ ok: false, code: "field_out_of_bounds", params: { field: "layout", allowed: VIDEO_OVERLAY_LAYOUT_IDS.join(", ") } })
  })
  it("an empty layout reads as absent, like null", () => {
    expect(codeOf({ outputAspect: "9:16", layers: [imageLayer], layout: "" })).toBe("ok")
    expect(codeOf({ layers: [imageLayer], layout: null })).toBe("ok")
  })
  it("a stack layout with a base box is refused: the stack places the base itself", () => {
    for (const layout of ["stack-whole", "stack-filled"] as const) {
      const r = validateVideoOverlayRequest({ layout, baseBox: BOX, outputAspect: "9:16", layers: [videoLayer] }) as VideoOverlayIssue
      expect(r).toEqual({ ok: false, code: "layout_conflicts_base_box", params: { layout } })
      expect(formatVideoOverlayError(r)).toBe("A stack layout places the base itself — remove baseBox or choose Custom")
    }
    expect(VIDEO_OVERLAY_ERROR_CODES).toContain("layout_conflicts_base_box")
  })
  it("the edge layouts and pip still take an explicit base box", () => {
    for (const layout of ["video-bottom", "video-top", "pip"] as const) {
      expect(codeOf({ layout, baseBox: BOX, outputAspect: "9:16", layers: [videoLayer] })).toBe("ok")
    }
  })
  it("renders the three refusals in English", () => {
    const text = (body: VideoOverlayValidationInput) => formatVideoOverlayError(validateVideoOverlayRequest(body) as VideoOverlayIssue)
    expect(text({ baseBox: BOX, layers: [imageLayer] })).toBe("baseBox needs an outputAspect")
    expect(text({ layout: "stack-whole", layers: [videoLayer] })).toBe("layout stack-whole needs an outputAspect")
    expect(text({ layout: "pip", layers: [imageLayer] })).toBe("layout pip needs a video layer — set videoUrl on a layer or connect a video to a layer's handle")
  })
  it("the verdict is the same before and after the layout expansion", () => {
    const cases: VideoOverlayValidationInput[] = [
      { layout: "video-bottom", layers: [imageLayer] },
      { layout: "video-top", outputAspect: "9:16", layers: [imageLayer] },
      { layout: "stack-whole", layers: [videoLayer] },
      { layout: "stack-filled", outputAspect: "9:16", layers: [imageLayer] },
      { layout: "pip", layers: [imageLayer] },
      { layout: "pip", layers: [{ videoUrl: V, start: 0, sound: { volume: 2 } }] },
      { layout: "video-bottom", baseBox: { width: 50 }, outputAspect: "9:16", layers: [imageLayer] },
      { baseBox: { anchor: "bottom", width: 100 }, layers: [imageLayer] },
      { baseBox: { anchor: "bottom", width: 100 }, outputAspect: "9:16", layers: [imageLayer] },
      { layout: "stack", outputAspect: "9:16", layers: [videoLayer] },
      { layout: "stack-whole", baseBox: { anchor: "bottom", width: 100 }, outputAspect: "9:16", layers: [videoLayer] },
      { layout: "stack-filled", baseBox: { width: 50 }, layers: [imageLayer] },
      { layout: "", outputAspect: "9:16", layers: [imageLayer] },
      // A malformed first video layer is refused before the expansion, so it must be refused after it too:
      // the layout never repairs a layer the validator would refuse.
      ...malformedFirstVideoLayers.map((layer) => ({ layout: "pip", layers: [imageLayer, layer] })),
      ...malformedFirstVideoLayers.map((layer) => ({ layout: "stack-whole", outputAspect: "9:16", layers: [layer] })),
      ...malformedFirstVideoLayers.map((layer) => ({ layout: "stack-filled", outputAspect: "9:16", layers: [layer] })),
    ]
    for (const body of cases) {
      const expanded = expandVideoOverlayLayout({ ...body, layers: body.layers ?? [] })
      expect([body, validateVideoOverlayRequest(expanded)]).toEqual([body, validateVideoOverlayRequest(body)])
    }
  })
  it("a first video layer the validator refuses is left as it is (by reference), for every layout that places it", () => {
    for (const layer of malformedFirstVideoLayers) {
      for (const layout of ["pip", "stack-whole", "stack-filled"] as const) {
        const req = { layout, outputAspect: "9:16", layers: [layer] }
        expect([layer, expandVideoOverlayLayout(req)]).toEqual([layer, req])
        expect(expandVideoOverlayLayout(req)).toBe(req)
      }
    }
  })
  it("the same holds through the real assembly (pip with a 500 %-wide video layer)", () => {
    const r = assembleVideoOverlayRequest({
      videoUrl: "v",
      data: { layout: "pip", layers: [{ start: 0, anchor: "center", width: 500 }] },
      wiredImageUrls: [V],
      wiredVideoSlots: new Set([1]),
    })
    const before = validateVideoOverlayRequest(r)
    expect(before).toMatchObject({ ok: false, code: "field_out_of_bounds", slot: 1, params: { field: "width" } })
    expect(validateVideoOverlayRequest(expandVideoOverlayLayout(r))).toEqual(before)
  })
})

describe("assembleVideoOverlayRequest — baseBox and layout ride as stored", () => {
  it("both reach the request; absent, they add no key", () => {
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [imageLayer], outputAspect: "9:16", baseBox: BOX, layout: "video-bottom" }, wiredImageUrls: [] })
    expect(r).toMatchObject({ baseBox: BOX, layout: "video-bottom" })
    const plain = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [imageLayer], baseBox: null, layout: null }, wiredImageUrls: [] })
    expect(Object.keys(plain).sort()).toEqual(["layers", "videoUrl"])
  })
  it("a malformed base box or an unknown layout reaches the validator, which refuses it on both engines", () => {
    const box = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [imageLayer], outputAspect: "9:16", baseBox: { width: 50 } }, wiredImageUrls: [] })
    expect(validateVideoOverlayRequest(box)).toMatchObject({ ok: false, code: "incomplete_box", params: { field: "baseBox" } })
    const layout = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [imageLayer], outputAspect: "9:16", layout: "stack" }, wiredImageUrls: [] })
    expect(validateVideoOverlayRequest(layout)).toMatchObject({ ok: false, code: "field_out_of_bounds", params: { field: "layout" } })
  })
  it("a stored base box loses its null fields — read as absent everywhere — so the REST route, which takes no null, accepts the canvas run", () => {
    const stored = { anchor: "bottom", x: 0, y: null, width: 100, height: null, fit: "contain" } as const
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [imageLayer], outputAspect: "9:16", baseBox: stored }, wiredImageUrls: [] })
    expect(r.baseBox).toEqual({ anchor: "bottom", x: 0, width: 100, fit: "contain" })
    expect(validateVideoOverlayRequest(r)).toEqual(validateVideoOverlayRequest({ ...r, baseBox: stored }))
    // A box with no null field rides by reference; a non-object still reaches the validator as stored.
    expect(assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [imageLayer], baseBox: BOX }, wiredImageUrls: [] }).baseBox).toBe(BOX)
    const odd = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [imageLayer], outputAspect: "9:16", baseBox: "top" as never }, wiredImageUrls: [] })
    expect(odd.baseBox).toBe("top")
    expect(validateVideoOverlayRequest(odd)).toMatchObject({ ok: false, code: "incomplete_box", params: { field: "baseBox" } })
  })
  it("a node storing an empty layout assembles with no layout and validates", () => {
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [imageLayer], layout: "" }, wiredImageUrls: [] })
    expect(Object.keys(r).sort()).toEqual(["layers", "videoUrl"])
    expect(validateVideoOverlayRequest(r)).toEqual({ ok: true })
  })
  it("a wired video slot satisfies a layout that needs a video layer", () => {
    const r = assembleVideoOverlayRequest({
      videoUrl: "v",
      data: { layers: [], outputAspect: "9:16", layout: "stack-whole" },
      wiredImageUrls: [V],
      wiredVideoSlots: new Set([1]),
    })
    expect(validateVideoOverlayRequest(r)).toEqual({ ok: true })
  })
  it("an assembled request expands and is still an assembled request (what the worker calls)", () => {
    const r = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [], layout: "pip" }, wiredImageUrls: [V], wiredVideoSlots: new Set([1]) })
    const out: ExpandedVideoOverlayRequest = expandVideoOverlayLayout(r)
    expect(out.layers[0]).toMatchObject({ videoUrl: V, slot: 1, anchor: "bottom-right", x: -4, y: -4, width: 30, animate: false })
    expect(validateVideoOverlayRequest(out)).toEqual({ ok: true })
  })
})

describe("videoOverlayCompositionKey — the base box and the layout", () => {
  const base = { baseUrl: "https://x/base.mp4", sources: [I], data: { layers: [{ start: 1 }], outputAspect: "9:16" } }
  const key = videoOverlayCompositionKey(base)
  it("unset (absent, undefined, null, or an empty layout) keeps today's key", () => {
    expect(videoOverlayCompositionKey({ ...base, data: { ...base.data, baseBox: null, layout: undefined } })).toBe(key)
    expect(videoOverlayCompositionKey({ ...base, data: { ...base.data, layout: "" } })).toBe(key)
    expect(JSON.parse(key)).toHaveLength(6)
  })
  it("changes with the base box and with the layout, and is canonical in the box's key order", () => {
    const withBox = videoOverlayCompositionKey({ ...base, data: { ...base.data, baseBox: BOX } })
    const withLayout = videoOverlayCompositionKey({ ...base, data: { ...base.data, layout: "video-bottom" } })
    const otherBox = videoOverlayCompositionKey({ ...base, data: { ...base.data, baseBox: { ...BOX, y: 20 } } })
    expect(new Set([key, withBox, withLayout, otherBox]).size).toBe(4)
    const reordered: VideoOverlayBox = { fit: "cover", height: 40, width: 80, y: 10, x: 0, anchor: "center" }
    expect(videoOverlayCompositionKey({ ...base, data: { ...base.data, baseBox: reordered } })).toBe(withBox)
  })
  it("a wired plan and a layout stay distinguishable", () => {
    const plan = videoOverlayCompositionKey({ ...base, planLayers: [] })
    const both = videoOverlayCompositionKey({ ...base, planLayers: [], data: { ...base.data, layout: "pip" } })
    expect(new Set([key, plan, both]).size).toBe(3)
  })
})

/**
 * Where the base and every video layer draw — the ONE placement the worker
 * renders with and the canvas preview draws with, so the two cannot disagree.
 */
describe("placeVideoOverlayVideos — the base and the video layers, as the render draws them", () => {
  const PORTRAIT = { w: 1080, h: 1920 }
  const layer = (box: Partial<VideoOverlayBox> = {}) => expandVideoOverlayLayer({ videoUrl: V, start: 0, anchor: "center", width: 50, ...box })
  const at = (r: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }) => [r.left, r.top, r.width, r.height]

  it("stack-whole: the base above, the first video layer below, both contain — 16:9 over 1:1 on 9:16 at y 116 and 722", () => {
    const p = placeVideoOverlayVideos({ canvas: PORTRAIT, layout: "stack-whole", baseAspect: 16 / 9, firstVideo: 1, videos: [{ index: 1, layer: layer(), aspect: 1 }] })
    expect(p.basePlacement).toEqual({ drawn: { left: 0, top: 116, width: 1080, height: 606 }, fit: "contain" })
    expect(p.layers.get(1)).toEqual({ drawn: { left: 0, top: 722, width: 1080, height: 1080 }, fit: "contain" })
  })
  it("stack-whole: two 16:9 come out at 1080x606, 354 px above and below", () => {
    const p = placeVideoOverlayVideos({ canvas: PORTRAIT, layout: "stack-whole", baseAspect: 16 / 9, firstVideo: 0, videos: [{ index: 0, layer: layer(), aspect: 16 / 9 }] })
    expect(at(p.basePlacement!.drawn)).toEqual([0, 354, 1080, 606])
    expect(at(p.layers.get(0)!.drawn)).toEqual([0, 960, 1080, 606])
  })
  it("stack-filled: both halves cover, whatever fit the layer stores; its own box is not read", () => {
    const p = placeVideoOverlayVideos({ canvas: PORTRAIT, layout: "stack-filled", baseAspect: 16 / 9, firstVideo: 0, videos: [{ index: 0, layer: layer({ fit: "contain", width: 10 }), aspect: 16 / 9 }] })
    expect(p.basePlacement).toEqual({ drawn: { left: 0, top: 0, width: 1080, height: 960 }, fit: "cover" })
    expect(p.layers.get(0)).toEqual({ drawn: { left: 0, top: 960, width: 1080, height: 960 }, fit: "cover" })
  })
  it("a base box (video-bottom) places the base flush on its edge at its own fit; a video layer draws at its own box, rounded to even", () => {
    const req = expandVideoOverlayLayout({ layout: "video-bottom", layers: [] })
    const p = placeVideoOverlayVideos({ canvas: PORTRAIT, baseBox: req.baseBox, baseAspect: 16 / 9, firstVideo: 0, videos: [{ index: 0, layer: layer({ anchor: "top-left", x: 3, y: 3, width: 33 }), aspect: 4 / 3 }] })
    expect(p.basePlacement).toEqual({ drawn: { left: 0, top: 1314, width: 1080, height: 606 }, fit: "contain" })
    const own = resolveVideoOverlayGeometry(PORTRAIT, layer({ anchor: "top-left", x: 3, y: 3, width: 33 }), 4 / 3).drawn
    expect(p.layers.get(0)).toEqual({ drawn: evenVideoOverlayRect(own), fit: "contain" })
    expect(p.layers.get(0)!.drawn.left % 2).toBe(0)
  })
  it("no layout and no base box: the base is not placed (drawn as before)", () => {
    const p = placeVideoOverlayVideos({ canvas: PORTRAIT, baseAspect: 16 / 9, firstVideo: 0, videos: [{ index: 0, layer: layer(), aspect: 16 / 9 }] })
    expect(p.basePlacement).toBeUndefined()
  })
  it("holds every aspect inside the bounds before placing (a 1:1000 sliver is placed as 1:8)", () => {
    const args = (aspect: number) => ({ canvas: PORTRAIT, layout: "stack-whole", baseAspect: aspect, firstVideo: 0, videos: [{ index: 0, layer: layer(), aspect }] })
    expect(placeVideoOverlayVideos(args(1 / 1000))).toEqual(placeVideoOverlayVideos(args(1 / 8)))
    expect(placeVideoOverlayVideos(args(Number.NaN))).toEqual(placeVideoOverlayVideos(args(1)))
  })
  it("a stack whose first video layer is not among the videos is a caller bug", () => {
    expect(() => placeVideoOverlayVideos({ canvas: PORTRAIT, layout: "stack-whole", baseAspect: 1, firstVideo: 2, videos: [] })).toThrow(/stacked layer 2/)
  })
})
