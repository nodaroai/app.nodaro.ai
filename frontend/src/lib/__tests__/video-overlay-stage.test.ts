// @vitest-environment node
/**
 * The stage's geometry (the preview and the render never disagree about
 * where something sits): every video layer and a placed base through the
 * worker's own placement (`placeVideoOverlayVideos`), every image layer through
 * the unchanged layer geometry, a layout's boxes written by the same expansion
 * the worker runs — and anything the render would refuse to place falls back
 * to today's drawing instead of throwing.
 */
import { describe, it, expect } from "vitest"
import {
  evenVideoOverlayRect,
  expandVideoOverlayLayer,
  resolveVideoOverlayBaseRect,
  resolveVideoOverlayGeometry,
  resolveVideoOverlayStackRects,
  type VideoOverlayLayer,
} from "@nodaro/shared/video"
import { resolveVideoOverlayStage, videoOverlayRectBox, type VideoOverlayStageInput } from "../video-overlay-stage"

const PORTRAIT = { w: 1080, h: 1920 }
const CLIP = "https://x/clip.mp4"
const CARD = "https://x/card.png"
const video = (extra: Record<string, unknown> = {}) => expandVideoOverlayLayer({ videoUrl: CLIP, start: 0, ...extra })
const image = (extra: Record<string, unknown> = {}) => expandVideoOverlayLayer({ imageUrl: CARD, start: 0, ...extra })
const aspects: Record<string, number> = { [CLIP]: 1, [CARD]: 2 }

function stage(over: Partial<VideoOverlayStageInput> & { layers: Array<VideoOverlayLayer | undefined> }) {
  return resolveVideoOverlayStage({
    canvas: PORTRAIT,
    outputAspect: "9:16",
    baseAspect: 16 / 9,
    planLayers: [],
    sources: over.layers.map((l) => (l ? (l.videoUrl ?? l.imageUrl) : undefined)),
    aspectOf: (url) => aspects[url],
    ...over,
  })
}

describe("resolveVideoOverlayStage — a video layer", () => {
  it("draws at its box with its probed aspect, rounded to the even rect the render draws", () => {
    const layer = video({ anchor: "top-left", x: 3, y: 3, width: 33 })
    const s = stage({ layers: [layer], aspectOf: () => 4 / 3 })
    expect(s.items[0]).toMatchObject({ video: true, url: CLIP, fit: "contain" })
    expect(s.items[0]!.drawn).toEqual(evenVideoOverlayRect(resolveVideoOverlayGeometry(PORTRAIT, layer, 4 / 3).drawn))
    expect(s.base).toBeUndefined()
  })
  it("an image layer's geometry is unchanged (no even rounding of its offsets)", () => {
    const layer = image({ anchor: "top-left", x: 3, y: 3, width: 33 })
    const s = stage({ layers: [layer] })
    expect(s.items[0]).toMatchObject({ video: false, url: CARD })
    expect(s.items[0]!.drawn).toEqual(resolveVideoOverlayGeometry(PORTRAIT, layer, 2).drawn)
  })
  it("a slot with no source draws nothing", () => {
    expect(stage({ layers: [image()], sources: [undefined] }).items[0]).toBeUndefined()
  })
})

describe("resolveVideoOverlayStage — layouts and a placed base", () => {
  it("stack-whole: the base and the first video layer at the stacked rects — 16:9 over 1:1 on 9:16 at y 116 and 722", () => {
    const s = stage({ layout: "stack-whole", layers: [image(), video({ width: 10 })] })
    const rects = resolveVideoOverlayStackRects("stack-whole", PORTRAIT, 16 / 9, 1)
    expect(s.base).toEqual({ drawn: evenVideoOverlayRect(rects.top), fit: "contain" })
    expect(s.items[1]).toMatchObject({ drawn: evenVideoOverlayRect(rects.bottom), fit: "contain" })
    expect([s.base!.drawn.top, s.items[1]!.drawn!.top]).toEqual([116, 722])
    expect(s.stacked).toBe(1)
    // The image layer stays where its own box puts it.
    expect(s.items[0]!.drawn).toEqual(resolveVideoOverlayGeometry(PORTRAIT, image(), 2).drawn)
  })
  it("a stacked layer's layer carries its rect as a box (what a drag starts from); the box draws that rect to the pixel", () => {
    for (const [layout, aspect] of [["stack-whole", 1], ["stack-whole", 16 / 9], ["stack-filled", 1]] as const) {
      const s = stage({ layout, layers: [image(), video({ width: 10, preset: "card" })], aspectOf: (url) => (url === CLIP ? aspect : 2) })
      const item = s.items[1]!
      expect(item.layer).toMatchObject({ anchor: "top-left", fit: "cover", start: 0 })
      expect(item.layer.preset).toBeUndefined()
      expect(evenVideoOverlayRect(resolveVideoOverlayGeometry(PORTRAIT, item.layer, aspect).drawn)).toEqual(item.drawn)
    }
    // Not stacked: the layer as stored.
    expect(stage({ layers: [video({ anchor: "bottom-right", width: 10 })] }).items[0]!.layer).toMatchObject({ anchor: "bottom-right", width: 10 })
  })
  it("videoOverlayRectBox: a rect as a top-left cover box, pixel-exact through the geometry and the base placement", () => {
    for (const canvas of [PORTRAIT, { w: 1920, h: 1080 }, { w: 1080, h: 1350 }, { w: 1080, h: 1080 }]) {
      for (const rect of [{ left: 0, top: 116, width: 1080, height: 606 }, { left: 354, top: 722, width: 236, height: 28 }, { left: 0, top: 674, width: 1080, height: 676 }]) {
        const box = videoOverlayRectBox(rect, canvas)
        expect(box).toMatchObject({ anchor: "top-left", fit: "cover" })
        expect(resolveVideoOverlayGeometry(canvas, box, 1).drawn).toEqual(rect)
        expect(resolveVideoOverlayBaseRect(canvas, box, 1)).toEqual(rect)
      }
    }
  })
  it("stack-filled: both halves cover", () => {
    const s = stage({ layout: "stack-filled", layers: [video()] })
    expect(s.base).toEqual({ drawn: { left: 0, top: 0, width: 1080, height: 960 }, fit: "cover" })
    expect(s.items[0]).toMatchObject({ drawn: { left: 0, top: 960, width: 1080, height: 960 }, fit: "cover" })
  })
  it("the first video layer is the lowest by render order — a plan's video sits below every slot", () => {
    const planVideo = expandVideoOverlayLayer({ videoUrl: "https://x/plan.mp4", start: 0 })
    const s = stage({ layout: "stack-whole", planLayers: [planVideo], layers: [video()], aspectOf: () => 16 / 9 })
    expect(s.stacked).toBe(0)
    expect(s.items[0]!.drawn!.top).toBe(960)
  })
  it("video-bottom: the base flush on the bottom edge (y 1314–1920 for 16:9 on 9:16)", () => {
    const s = stage({ layout: "video-bottom", layers: [image()] })
    expect(s.base).toEqual({ drawn: { left: 0, top: 1314, width: 1080, height: 606 }, fit: "contain" })
  })
  it("an explicit base box moves the base", () => {
    const s = stage({ baseBox: { anchor: "top", width: 50 }, layers: [image()] })
    expect(s.base!.drawn).toMatchObject({ top: 0, width: 540, height: 302 })
    expect(s.base!.drawn.left % 2).toBe(0)
  })
  it("pip: the first video layer in the bottom-right corner, 30 % wide", () => {
    const s = stage({ layout: "pip", outputAspect: undefined, canvas: { w: 1920, h: 1080 }, layers: [video({ anchor: "top-left", width: 80 })], aspectOf: () => 16 / 9 })
    expect(s.items[0]!.layer).toMatchObject({ anchor: "bottom-right", x: -4, y: -4, width: 30, animate: false })
    expect(s.items[0]!.drawn).toEqual({ left: 1266, top: 712, width: 576, height: 324 })
    expect(s.base).toBeUndefined()
  })
})

describe("resolveVideoOverlayStage — what the render refuses is drawn as before, never thrown", () => {
  it("a partial base box", () => {
    expect(() => stage({ baseBox: { width: 50 }, layers: [image()] })).not.toThrow()
    expect(stage({ baseBox: { width: 50 }, layers: [image()] }).base).toBeUndefined()
    expect(stage({ baseBox: { anchor: "bottom", width: 500 }, layers: [image()] }).base).toBeUndefined()
  })
  it("a stack with no video layer, a stack with a base box, a layout without an output aspect", () => {
    expect(stage({ layout: "stack-whole", layers: [image()] }).base).toBeUndefined()
    expect(stage({ layout: "stack-whole", baseBox: { anchor: "top", width: 50 }, layers: [video()] }).base).toBeUndefined()
    expect(stage({ layout: "video-bottom", outputAspect: undefined, layers: [image()] }).base).toBeUndefined()
    expect(stage({ baseBox: { anchor: "top", width: 50 }, outputAspect: undefined, layers: [image()] }).base).toBeUndefined()
  })
  it("a base whose shape is not known yet", () => {
    expect(stage({ layout: "stack-whole", baseAspect: undefined, layers: [video()] }).base).toBeUndefined()
  })
  it("a video layer with a partial box is not drawn (unless a stack places it)", () => {
    const partial = { videoUrl: CLIP, start: 0, width: 40 } as unknown as VideoOverlayLayer
    expect(stage({ layers: [partial] }).items[0]!.drawn).toBeUndefined()
    expect(stage({ layout: "stack-filled", layers: [partial] }).items[0]!.drawn).toEqual({ left: 0, top: 960, width: 1080, height: 960 })
  })
})

describe("resolveVideoOverlayStage — the base as a drag moves it (baseFrame)", () => {
  // Video fit gives the base no box of its own: a move starts from its drawn rect
  // as a box (nothing moves on the first edit), a resize from a centred box as
  // wide as it is drawn with no height (the picture keeps its shape).
  it("Video fit: the move box IS the drawn rect; the resize box keeps the picture's shape", () => {
    const cover = stage({ layers: [image()] }).baseFrame!
    expect(cover.drawn).toEqual({ left: 0, top: 0, width: 1080, height: 1920 })
    expect(cover.box).toEqual({ anchor: "top-left", x: 0, y: 0, width: 100, height: 100, fit: "cover" })
    expect(cover.resizeBox).toEqual({ anchor: "center", x: 0, y: 0, width: 100, fit: "contain" })
    const contain = stage({ baseFit: "contain", layers: [image()] }).baseFrame!
    expect(contain.drawn).toEqual({ left: 0, top: 656, width: 1080, height: 606 })
    // The box draws the same rect through the base placement: the first move shifts nothing.
    expect(evenVideoOverlayRect(resolveVideoOverlayBaseRect(PORTRAIT, contain.box, 16 / 9))).toEqual(contain.drawn)
    // …and the resize box, before any change, draws the same picture (to the even pixel).
    expect(evenVideoOverlayRect(resolveVideoOverlayBaseRect(PORTRAIT, contain.resizeBox, 16 / 9))).toEqual(contain.drawn)
  })
  it("a partial stored box draws as Video fit and is moved from that drawn rect (no jump)", () => {
    const partial = stage({ baseBox: { width: 40 }, layers: [image()] }).baseFrame!
    expect(partial.drawn).toEqual({ left: 0, top: 0, width: 1080, height: 1920 })
    expect(partial.box).toEqual({ anchor: "top-left", x: 0, y: 0, width: 100, height: 100, fit: "cover" })
  })
  it("a stored box, or an edge layout's, is the frame and draws where the render places it", () => {
    const edge = { anchor: "bottom", x: 0, y: 0, width: 100, fit: "contain" } as const
    expect(stage({ layout: "video-bottom", layers: [image()] }).baseFrame).toEqual({ box: edge, resizeBox: edge, drawn: { left: 0, top: 1314, width: 1080, height: 606 } })
    const own = { anchor: "top", x: 0, y: 0, width: 50, fit: "contain" } as const
    const boxed = stage({ baseBox: own, layers: [image()] })
    expect(boxed.baseFrame).toEqual({ box: own, resizeBox: own, drawn: boxed.base!.drawn })
  })
  it("a stack: its base rect as a box once the clip's shape is read; none before", () => {
    const known = stage({ layout: "stack-whole", layers: [video()] })
    const rect = videoOverlayRectBox(known.base!.drawn, PORTRAIT)
    expect(known.baseFrame).toEqual({ box: rect, resizeBox: rect, drawn: known.base!.drawn })
    expect(stage({ layout: "stack-whole", layers: [video()], aspectOf: () => undefined }).baseFrame).toBeUndefined()
    // stack-filled reads no shape of the clip.
    expect(stage({ layout: "stack-filled", layers: [video()], aspectOf: () => undefined }).baseFrame?.drawn).toEqual({ left: 0, top: 0, width: 1080, height: 960 })
  })
  it("cannot be moved without an output aspect or before the base's shape is read", () => {
    expect(stage({ outputAspect: undefined, layers: [image()] }).baseFrame).toBeUndefined()
    expect(stage({ baseAspect: undefined, layers: [image()] }).baseFrame).toBeUndefined()
  })
})
