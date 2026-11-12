// @vitest-environment node
/**
 * A layout turned Custom keeps every box it wrote: the stage draws the same
 * rects before and after, for each layout, a wired video included — the
 * property a drag that clears the layout relies on so nothing but the
 * dragged layer moves.
 */
import { describe, it, expect } from "vitest"
import { VIDEO_OVERLAY_PIP_WIDTH, validateVideoOverlayRequest, type VideoOverlayLayerInput, type VideoOverlayNodeFields } from "@nodaro/shared/video"
import { resolveVideoOverlayView, type VideoOverlayViewMedia, type VideoOverlayWires } from "../video-overlay-view"
import { videoOverlayLayoutAsCustom } from "../video-overlay-layout-custom"

const BASE = "https://x/base.mp4"
const CLIP = "https://x/clip.mp4"
const CARD = "https://x/card.png"
const MEDIA: VideoOverlayViewMedia = { baseDisplay: { width: 1920, height: 1080 }, aspectOf: (url) => (url === CLIP ? 1 : 2) }
const UNWIRED: VideoOverlayWires = { base: BASE, layers: [], wiredVideoSlots: new Set() }

function custom(data: VideoOverlayNodeFields, wires: VideoOverlayWires = UNWIRED, wiredSlots: ReadonlySet<number> = new Set(), media = MEDIA) {
  const before = resolveVideoOverlayView(data, wires, media)
  const result = videoOverlayLayoutAsCustom(data, before, wiredSlots)
  if (result === "shapes-pending") throw new Error("shapes pending")
  const patch = result
  const after = patch ? resolveVideoOverlayView({ ...data, ...patch }, wires, media) : before
  const drawn = (v: typeof before) => ({ base: v.stage.base, items: v.stage.items.map((i) => i?.drawn) })
  return { patch, before: drawn(before), after: drawn(after), verdict: validateVideoOverlayRequest(after.request) }
}

const card: VideoOverlayLayerInput = { imageUrl: CARD, start: 0, anchor: "top", x: 0, y: 8, width: 80 }

describe("videoOverlayLayoutAsCustom — nothing moves", () => {
  it("no layout: nothing to do", () => {
    expect(custom({ layers: [card] }).patch).toBeNull()
    expect(custom({ layers: [card], layout: "" }).patch).toBeNull()
  })

  it("video-bottom: the base keeps its bottom edge box; the layers are untouched", () => {
    const { patch, before, after } = custom({ outputAspect: "9:16", layout: "video-bottom", layers: [card] })
    expect(patch).toEqual({ layout: undefined, baseBox: { anchor: "bottom", x: 0, y: 0, width: 100, fit: "contain" } })
    expect(before.base?.drawn).toEqual({ left: 0, top: 1314, width: 1080, height: 606 })
    expect(after).toEqual(before)
  })

  it("an explicit base box already wins: only the tag goes", () => {
    const { patch, after, before } = custom({ outputAspect: "9:16", layout: "video-top", baseBox: { anchor: "center", width: 50 }, layers: [card] })
    expect(patch).toEqual({ layout: undefined })
    expect(after).toEqual(before)
  })

  it("pip: the first video layer keeps the pip box, its own source and timing", () => {
    const layers: VideoOverlayLayerInput[] = [card, { videoUrl: CLIP, start: 2, preset: "card" }]
    const { patch, before, after } = custom({ layout: "pip", layers })
    expect(patch!.layers![0]).toBe(card)
    expect(patch!.layers![1]).toMatchObject({ videoUrl: CLIP, start: 2, anchor: "bottom-right", x: -4, y: -4, width: VIDEO_OVERLAY_PIP_WIDTH, fit: "contain", animate: false })
    expect(patch!.layers![1]!.preset).toBeUndefined()
    expect(after).toEqual(before)
  })

  it("pip on a WIRED video: the slot stores the box but no source and no implied fade; a fade the layout turned off is stored off", () => {
    const wires: VideoOverlayWires = { base: BASE, layers: [undefined, CLIP], wiredVideoSlots: new Set([2]) }
    const implied = custom({ layout: "pip", layers: [null, { start: 1 }] }, wires, new Set([1]))
    expect(implied.patch!.layers![1]).toEqual({ start: 1, corner: "bottom-right", anchor: "bottom-right", x: -4, y: -4, width: VIDEO_OVERLAY_PIP_WIDTH, fit: "contain", opacity: 1 })
    expect(implied.after).toEqual(implied.before)
    const faded = custom({ layout: "pip", layers: [null, { start: 1, animate: true }] }, wires, new Set([1]))
    expect(faded.patch!.layers![1]).toMatchObject({ animate: false })
  })

  it.each(["stack-whole", "stack-filled"] as const)("%s: the base and the first video layer keep their stacked rects as boxes", (layout) => {
    const { patch, before, after } = custom({ outputAspect: "9:16", layout, layers: [card, { videoUrl: CLIP, start: 0 }] })
    expect(patch!.baseBox).toMatchObject({ anchor: "top-left", fit: "cover" })
    expect(patch!.layers![1]).toMatchObject({ videoUrl: CLIP, anchor: "top-left", fit: "cover" })
    expect(before.base).toBeDefined()
    expect(after.base?.drawn).toEqual(before.base?.drawn)
    expect(after.items).toEqual(before.items)
  })

  // A stack's rects depend on both videos' shapes (stack-whole): turned Custom
  // before either is read, it would store a stack placed by stand-in shapes the
  // render never draws. It waits for them instead; stack-filled needs none.
  it("stack-whole waits for both shapes: before the base's or the clip's is read, Custom is pending", () => {
    const data: VideoOverlayNodeFields = { outputAspect: "9:16", layout: "stack-whole", layers: [{ videoUrl: CLIP, start: 0 }] }
    const pending = (media: VideoOverlayViewMedia) => videoOverlayLayoutAsCustom(data, resolveVideoOverlayView(data, UNWIRED, media), new Set())
    expect(pending({ ...MEDIA, baseDisplay: undefined })).toBe("shapes-pending")
    expect(pending({ ...MEDIA, aspectOf: () => undefined })).toBe("shapes-pending")
    // Once both are read: the render's own rects (16:9 over 16:9 on 9:16 — 354 and 960, 606 px each).
    const known = custom(data, UNWIRED, new Set(), { ...MEDIA, aspectOf: () => 16 / 9 })
    expect(known.after.base?.drawn).toEqual({ left: 0, top: 354, width: 1080, height: 606 })
    expect(known.after.items[0]).toEqual({ left: 0, top: 960, width: 1080, height: 606 })
  })
  it("stack-filled needs no shape: its halves are kept even before the base or the clip is read", () => {
    const data: VideoOverlayNodeFields = { outputAspect: "9:16", layout: "stack-filled", layers: [{ videoUrl: CLIP, start: 0 }] }
    const result = videoOverlayLayoutAsCustom(data, resolveVideoOverlayView(data, UNWIRED, { aspectOf: () => undefined }), new Set())
    expect(result).toMatchObject({ layout: undefined, baseBox: { anchor: "top-left", x: 0, y: 0, width: 100, height: 50, fit: "cover" } })
    expect(result).toMatchObject({ layers: [{ anchor: "top-left", y: 50, height: 50, fit: "cover" }] })
  })

  it("a first video layer from the layer plan has no stored slot: only the base is kept", () => {
    const wires: VideoOverlayWires = { ...UNWIRED, plan: JSON.stringify([{ videoUrl: CLIP, start: 0 }]) }
    const { patch } = custom({ outputAspect: "9:16", layout: "stack-whole", layers: [card] }, wires)
    expect(patch).toMatchObject({ layout: undefined, baseBox: { anchor: "top-left" } })
    expect(patch).not.toHaveProperty("layers")
  })
})

describe("videoOverlayLayoutAsCustom — what the stage does not place is not stored", () => {
  it("an edge layout's box needs no shape: kept even before the base's shape is read", () => {
    const { patch } = custom({ outputAspect: "9:16", layout: "video-top", layers: [card] }, UNWIRED, new Set(), { aspectOf: () => undefined })
    expect(patch).toEqual({ layout: undefined, baseBox: { anchor: "top", x: 0, y: 0, width: 100, fit: "contain" } })
  })
  it("an edge layout with no output aspect (refused; the stage draws the base as before): only the tag goes", () => {
    const { patch, before, after } = custom({ layout: "video-bottom", layers: [card] })
    expect(before.base).toBeUndefined()
    expect(patch).toEqual({ layout: undefined })
    expect(after).toEqual(before)
  })
})

// An untouched slot stores no timing: the layer it becomes keeps the run's
// (start 0), or the run would be refused (time_out_of_range).
describe("videoOverlayLayoutAsCustom — an untouched slot keeps its timing", () => {
  const WIRED: VideoOverlayWires = { base: BASE, layers: [CLIP], wiredVideoSlots: new Set([1]) }
  it.each([
    ["pip", []],
    ["pip", [null]],
    ["stack-whole", []],
    ["stack-whole", [null]],
    ["stack-filled", []],
    ["stack-filled", [null]],
  ] as const)("%s with a wired video on an untouched slot (%j): the stored layer has a start and the run is accepted", (layout, layers) => {
    const { patch, before, after, verdict } = custom({ outputAspect: "9:16", layout, layers: [...layers] }, WIRED, new Set([0]))
    expect(patch!.layers![0]).toMatchObject({ start: 0 })
    expect(patch!.layers![0]).not.toHaveProperty("videoUrl")
    expect(patch!.layers![0]).not.toHaveProperty("animate")
    expect(verdict).toEqual({ ok: true })
    expect(after.items).toEqual(before.items)
  })
  it("an unwired JSON-written video with no start: the stored layer gets the run's start", () => {
    const { patch, verdict } = custom({ layout: "pip", layers: [{ videoUrl: CLIP } as VideoOverlayLayerInput] })
    expect(patch!.layers![0]).toMatchObject({ videoUrl: CLIP, start: 0, width: VIDEO_OVERLAY_PIP_WIDTH })
    expect(verdict).toEqual({ ok: true })
  })
})
