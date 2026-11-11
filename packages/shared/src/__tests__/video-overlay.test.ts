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
  normalizeVideoOverlayNodes,
  toCustomVideoOverlayLayer,
  VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH,
  VIDEO_OVERLAY_MAX_LAYERS,
  videoOverlayCompositionKey,
  videoOverlayRenderOrder,
  videoOverlaySlotOfHandle,
  videoOverlaySlotSources,
  VIDEO_OVERLAY_ERROR_CODES,
  VIDEO_OVERLAY_MAX_LAYER_VIDEO_BYTES,
  VIDEO_OVERLAY_MAX_VIDEO_LAYERS,
  VIDEO_OVERLAY_VIDEO_MAX_BASE_SEC,
  VIDEO_OVERLAY_VOLUME_BOUNDS,
  VIDEO_OVERLAY_WARNING_CODES,
  type VideoOverlayLayerInput,
  type VideoOverlayLayerSpec,
} from "../video-overlay.js"
import { formatVideoOverlayError, hasDrawableVideoOverlayBox, validateVideoOverlayRequest, type VideoOverlayIssue } from "../video-overlay-validate.js"
import { videoOverlayHasVideoLayer, videoOverlayWiredLayerKind } from "../video-overlay-video-layers.js"
import { DYNAMIC_PRODUCER_TYPES } from "../producer-types.js"

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
  it("a wired slot's layer keeps only the fade setting it was written with: its default follows the wire's kind, read at the run", () => {
    const [out] = normalizeVideoOverlayNodes([node([{ start: 1, preset: "card" }, { start: 2, animate: true }, { imageUrl: IMG, start: 3 }])], [
      { target: "vo", targetHandle: "overlay" },
      { target: "vo", targetHandle: "overlay2" },
    ])
    const layers = (out!.data as { layers: VideoOverlayLayerInput[] }).layers
    expect(layers[0]).toMatchObject({ ...VIDEO_OVERLAY_PRESETS.card, start: 1, opacity: 1 })
    expect(layers[0]).not.toHaveProperty("animate")
    expect(layers[1]).toMatchObject({ start: 2, animate: true })
    // An unwired slot's kind is its own source: expanded in full, as before.
    expect(layers[2]).toEqual(expandVideoOverlayLayer({ imageUrl: IMG, start: 3 }))
    // Idempotent, by reference.
    const again = normalizeVideoOverlayNodes([out!], [{ target: "vo", targetHandle: "overlay" }, { target: "vo", targetHandle: "overlay2" }])
    expect(again[0]).toBe(out)
    // A video wired in later runs without a fade, as a video layer's default.
    const run = assembleVideoOverlayRequest({ videoUrl: "v", data: { layers }, wiredImageUrls: ["https://x/clip"], wiredVideoSlots: new Set([1]) })
    expect(run.layers[0]).toMatchObject({ videoUrl: "https://x/clip", animate: false })
  })
  it("a null slot STAYS null — wired or not; only the engine assemblies and the stage synthesise the default (Review Focus 1)", () => {
    const [out] = normalizeVideoOverlayNodes([node([null, { imageUrl: IMG, start: 1 }, null])], [{ target: "vo", targetHandle: "overlay3" }])
    expect((out!.data as { layers: unknown[] }).layers).toEqual([null, expandVideoOverlayLayer({ imageUrl: IMG, start: 1 }), null])
    const clean = [node([null, DEFAULT_VIDEO_OVERLAY_LAYER])]
    expect(normalizeVideoOverlayNodes(clean, [])).toBe(clean)
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

describe("video layers — a layer carries an image or a video, never both", () => {
  const I = "https://cdn.example/i.png"
  const V = "https://cdn.example/v.mp4"
  const B = "https://cdn.example/base.mp4"
  const validate = (layers: VideoOverlayLayerInput[]) => validateVideoOverlayRequest({ layers })
  const codeOf = (layers: VideoOverlayLayerInput[]) => {
    const r = validate(layers)
    return r.ok ? "ok" : r.code
  }
  const videoLayers = (n: number): VideoOverlayLayerInput[] => Array.from({ length: n }, (_, i) => ({ videoUrl: `https://cdn.example/v${i}.mp4`, start: 0 }))
  const threeVideoLayers = videoLayers(3)

  it("the contract's bounds, measured caps and codes", () => {
    expect(VIDEO_OVERLAY_VOLUME_BOUNDS).toEqual([0, 1])
    expect(VIDEO_OVERLAY_MAX_VIDEO_LAYERS).toBe(2)
    expect(VIDEO_OVERLAY_VIDEO_MAX_BASE_SEC).toBe(60)
    expect(VIDEO_OVERLAY_MAX_LAYER_VIDEO_BYTES).toBe(200 * 1024 * 1024)
    expect(VIDEO_OVERLAY_ERROR_CODES).toEqual(expect.arrayContaining(["layer_two_sources", "too_many_video_layers", "sound_without_video"]))
    expect(VIDEO_OVERLAY_WARNING_CODES).toContain("layer_no_audio")
  })

  it("a video layer defaults animate off; an image layer stays on", () => {
    expect(expandVideoOverlayLayer({ videoUrl: V, start: 0, preset: "full-frame" }).animate).toBe(false)
    expect(expandVideoOverlayLayer({ imageUrl: I, start: 0, preset: "full-frame" }).animate).toBe(true)
    expect(expandVideoOverlayLayer({ videoUrl: V, start: 0, preset: "full-frame", animate: true }).animate).toBe(true)
  })
  it("a video layer with no box and no preset is the default corner badge with animate off — and stays put on a second pass", () => {
    const l = expandVideoOverlayLayer({ videoUrl: V, start: 0 })
    expect(l).toEqual({ ...DEFAULT_VIDEO_OVERLAY_LAYER, videoUrl: V, animate: false })
    expect(expandVideoOverlayLayer(l)).toBe(l)
    expect(expandVideoOverlayLayer({ videoUrl: V, start: 0, animate: true }).animate).toBe(true)
    expect(expandVideoOverlayLayer({ videoUrl: V, start: 0, anchor: "top", width: 50 }).animate).toBe(false)
    expect(expandVideoOverlayLayer({ imageUrl: I, start: 0 }).animate).toBe(true)
  })

  // A preset-tagged layer with no `start` (written as JSON): the default layer
  // starts at 0, and a VIDEO layer tagged with a preset now does too. An image
  // layer is left as it was — its request is refused today (time_out_of_range),
  // and filling it would turn an existing image-only refusal into a run.
  it("a video layer with a preset tag and no start starts at 0; an image layer stays as it was (refused)", () => {
    const video = expandVideoOverlayLayer({ videoUrl: V, preset: "card" })
    expect(video).toMatchObject({ videoUrl: V, start: 0, preset: "card", animate: false, anchor: "center", width: 78 })
    expect(expandVideoOverlayLayer(video)).toBe(video)
    expect(codeOf([video])).toBe("ok")
    const image = expandVideoOverlayLayer({ imageUrl: I, preset: "card" })
    expect(image).not.toHaveProperty("start")
    expect(codeOf([image])).toBe("time_out_of_range")
    // An explicit start is kept; a wired video slot tagged with a preset runs from 0.
    expect(expandVideoOverlayLayer({ videoUrl: V, preset: "full-frame", start: 3 }).start).toBe(3)
    const wired = assembleVideoOverlayRequest({ videoUrl: B, data: { layers: [{ preset: "corner-badge", corner: "top-left" }] }, wiredImageUrls: [V], wiredVideoSlots: new Set([1]) })
    expect(wired.layers[0]).toMatchObject({ start: 0, videoUrl: V, slot: 1 })
    expect(validateVideoOverlayRequest(wired)).toEqual({ ok: true })
  })

  it("refuses a layer with both sources", () => {
    expect(codeOf([{ imageUrl: I, videoUrl: V, start: 0 }])).toBe("layer_two_sources")
    expect(formatVideoOverlayError(validate([{ imageUrl: I, videoUrl: V, start: 0, slot: 2 }]) as VideoOverlayIssue)).toBe(
      "Layer 2: has both an image and a video — keep one (imageUrl or videoUrl)",
    )
  })
  it("a video-only layer is a complete layer; a layer with neither source names both", () => {
    expect(codeOf([{ videoUrl: V, start: 0 }])).toBe("ok")
    expect(codeOf([{ imageUrl: "", videoUrl: V, start: 0 }])).toBe("ok")
    expect(formatVideoOverlayError(validate([{ start: 0, slot: 3 }]) as VideoOverlayIssue)).toBe(
      "Layer 3: no image or video — connect one to the layer's handle or set imageUrl or videoUrl",
    )
  })

  it("refuses a third video layer", () => {
    expect(validate(threeVideoLayers)).toMatchObject({ code: "too_many_video_layers", params: { max: 2, count: 3 } })
    expect(formatVideoOverlayError(validate(threeVideoLayers) as VideoOverlayIssue)).toBe("At most 2 video layers (got 3)")
    expect(codeOf([...videoLayers(2), { imageUrl: I, start: 0 }, { imageUrl: I, start: 0 }])).toBe("ok")
  })

  it("refuses sound on an image layer", () => {
    expect(codeOf([{ imageUrl: I, start: 0, sound: { volume: 1 } }])).toBe("sound_without_video")
    expect(formatVideoOverlayError(validate([{ imageUrl: I, start: 0, sound: { volume: 1 } }]) as VideoOverlayIssue)).toBe(
      "layers[0]: sound is only for a video layer — remove it or set videoUrl",
    )
    expect(codeOf([{ videoUrl: V, start: 0, sound: { volume: 0.8 } }])).toBe("ok")
    expect(codeOf([{ imageUrl: I, start: 0, sound: null }])).toBe("ok")
  })

  it("bounds the volume", () => {
    expect(codeOf([{ videoUrl: V, start: 0, sound: { volume: 1.5 } }])).toBe("field_out_of_bounds")
    expect(validate([{ videoUrl: V, start: 0, sound: { volume: -0.1 } }])).toMatchObject({ params: { field: "sound.volume", allowed: "0..1" } })
    for (const sound of [{ volume: Number.NaN }, { volume: "1" }, {}, "loud", 1]) {
      expect(codeOf([{ videoUrl: V, start: 0, sound } as unknown as VideoOverlayLayerInput])).toBe("field_out_of_bounds")
    }
    expect(codeOf([{ videoUrl: V, start: 0, sound: { volume: 0 } }, { videoUrl: V, start: 0, sound: { volume: 1 } }])).toBe("ok")
  })
  it("a bad volume does not make the layer undrawable (the stage still places it)", () => {
    expect(hasDrawableVideoOverlayBox({ ...expandVideoOverlayLayer({ videoUrl: V, start: 0 }), sound: { volume: 5 } })).toBe(true)
  })

  it("a wired video slot becomes videoUrl", () => {
    const r = assembleVideoOverlayRequest({ videoUrl: B, data: {}, wiredImageUrls: [V], wiredVideoSlots: new Set([1]) })
    expect(r.layers[0]).toMatchObject({ videoUrl: V, slot: 1, animate: false })
    expect(r.layers[0].imageUrl).toBeUndefined()
  })
  it("a wire replaces whichever source the slot stored; an unwired slot keeps its own", () => {
    const stored: VideoOverlayLayerInput[] = [{ videoUrl: "https://x/stored.mp4", start: 1 }, { imageUrl: "https://x/stored.png", start: 2 }, { videoUrl: V, start: 3 }]
    const r = assembleVideoOverlayRequest({ videoUrl: B, data: { layers: stored }, wiredImageUrls: [I, V], wiredVideoSlots: new Set([2]) })
    expect(r.layers.map((l) => [l.slot, l.imageUrl, l.videoUrl])).toEqual([[1, I, undefined], [2, undefined, V], [3, undefined, V]])
    expect(r.layers.map((l) => l.start)).toEqual([1, 2, 3])
    expect(validateVideoOverlayRequest(r)).toEqual({ ok: true })
  })
  it("an unwired slot stored with both sources reaches the validator as it is", () => {
    const r = assembleVideoOverlayRequest({ videoUrl: B, data: { layers: [{ imageUrl: I, videoUrl: V, start: 0 }] }, wiredImageUrls: [] })
    expect(validateVideoOverlayRequest(r)).toMatchObject({ ok: false, code: "layer_two_sources", slot: 1 })
  })
  it("an empty-string source is dropped, so the layer runs as the kind it has on both engines (the route refuses an empty URL)", () => {
    const r = assembleVideoOverlayRequest({
      videoUrl: B,
      data: { layers: [{ imageUrl: I, videoUrl: "", start: 0 }, { imageUrl: "", videoUrl: V, start: 1 }] },
      wiredImageUrls: [],
      planLayers: [{ imageUrl: I, videoUrl: "", start: 2 }],
    })
    expect(r.layers.map((l) => [Object.hasOwn(l, "imageUrl"), Object.hasOwn(l, "videoUrl")])).toEqual([[true, false], [true, false], [false, true]])
    expect(r.layers.map((l) => l.animate)).toEqual([true, true, false])
    expect(validateVideoOverlayRequest(r)).toEqual({ ok: true })
    // Both empty is no source at all: the slot is dropped, as before.
    expect(assembleVideoOverlayRequest({ videoUrl: B, data: { layers: [{ imageUrl: "", videoUrl: "", start: 0 }] }, wiredImageUrls: [] }).layers).toEqual([])
  })
  it("an image-only assembly is unchanged without wiredVideoSlots", () => {
    const r = assembleVideoOverlayRequest({ videoUrl: B, data: { layers: [{ imageUrl: "https://x/own.png", start: 2 }] }, wiredImageUrls: [I] })
    expect(r.layers).toEqual([{ ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: I, start: 2, slot: 1 }])
  })

  // A WIRED slot's kind is its wire's, read at the run: a `sound` left on the
  // slot from when its wire was a video is skipped when the wire is an image
  // (the run goes ahead), and its fade default follows the image. A layer that
  // carries its OWN image (the API, MCP, an unwired slot, a plan) is refused.
  it("a wired image slot drops a stored sound and runs, its fade default on; wired to a video it keeps the sound, fade off", () => {
    const layers: VideoOverlayLayerInput[] = [{ start: 1, sound: { volume: 0.4 } }]
    const image = assembleVideoOverlayRequest({ videoUrl: B, data: { layers }, wiredImageUrls: [I] })
    expect(image.layers).toEqual([{ ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: I, start: 1, slot: 1 }])
    expect(validateVideoOverlayRequest(image)).toEqual({ ok: true })
    const video = assembleVideoOverlayRequest({ videoUrl: B, data: { layers }, wiredImageUrls: [V], wiredVideoSlots: new Set([1]) })
    expect(video.layers).toEqual([{ ...DEFAULT_VIDEO_OVERLAY_LAYER, animate: false, videoUrl: V, start: 1, sound: { volume: 0.4 }, slot: 1 }])
    // Even a volume the validator would refuse: the sound is skipped, not judged.
    const bad = assembleVideoOverlayRequest({ videoUrl: B, data: { layers: [{ start: 0, sound: { volume: 5 } }] }, wiredImageUrls: [I] })
    expect(validateVideoOverlayRequest(bad)).toEqual({ ok: true })
  })
  it("a fade the wired slot was written with stays as written, whichever kind its wire is", () => {
    const layers: VideoOverlayLayerInput[] = [{ start: 0, animate: true }, { start: 0, animate: false }]
    const r = assembleVideoOverlayRequest({ videoUrl: B, data: { layers }, wiredImageUrls: [V, I], wiredVideoSlots: new Set([1]) })
    expect(r.layers.map((l) => [l.slot, l.animate])).toEqual([[1, true], [2, false]])
  })
  it("sound on a layer with its own image is still refused: an unwired slot and a plan layer", () => {
    const own = assembleVideoOverlayRequest({ videoUrl: B, data: { layers: [null, { imageUrl: I, start: 0, sound: { volume: 1 } }] }, wiredImageUrls: [] })
    expect(validateVideoOverlayRequest(own)).toMatchObject({ ok: false, code: "sound_without_video", slot: 2 })
    const plan = assembleVideoOverlayRequest({ videoUrl: B, data: {}, wiredImageUrls: [], planLayers: [{ imageUrl: I, start: 0, sound: { volume: 1 } }] })
    expect(validateVideoOverlayRequest(plan)).toMatchObject({ ok: false, code: "sound_without_video", planLayer: 1 })
  })

  it("wiring clears both stored sources", () => {
    expect(clearWiredVideoOverlayImageUrls([{ videoUrl: V, start: 0 }], new Set([1]))[0]).not.toHaveProperty("videoUrl")
    expect(clearWiredVideoOverlayImageUrls([{ imageUrl: I, videoUrl: V, start: 0 }], new Set([1]))[0]).toEqual({ start: 0 })
    const untouched = [{ start: 0 }]
    expect(clearWiredVideoOverlayImageUrls(untouched, new Set([1]))).toBe(untouched)
    const [out] = normalizeVideoOverlayNodes(
      [{ id: "vo", type: "video-overlay", data: { layers: [{ videoUrl: V, start: 0 }] } }],
      [{ target: "vo", targetHandle: "overlay" }],
    )
    expect((out!.data as { layers: VideoOverlayLayerInput[] }).layers[0]).not.toHaveProperty("videoUrl")
  })

  it("slot sources read a stored video", () => {
    expect(videoOverlaySlotSources([{ videoUrl: V, start: 0 }], [])).toEqual([V])
    expect(videoOverlaySlotSources([{ videoUrl: V, start: 0 }], [I])).toEqual([I])
  })

  it("kinds a wired source by producer, else by extension", () => {
    expect(videoOverlayWiredLayerKind({ type: "generate-video" }, "https://x/a")).toBe("video")
    expect(videoOverlayWiredLayerKind({ type: "generate-image" }, "https://x/a.mp4")).toBe("image")
    const dynamic = [...DYNAMIC_PRODUCER_TYPES][0]
    expect(videoOverlayWiredLayerKind({ type: dynamic }, "https://x/a.mp4?sig=1")).toBe("video")
    expect(videoOverlayWiredLayerKind({ type: dynamic }, "https://x/a.png")).toBe("image")
  })
  it("the extension test reads the path only, case-insensitively, and defaults to image", () => {
    for (const url of ["https://x/a.MOV", "https://x/a.webm#t=2", "https://x/a.m4v", "/uploads/a.mp4?x=1"]) {
      expect(videoOverlayWiredLayerKind({}, url)).toBe("video")
    }
    for (const url of ["https://x/a.png?f=.mp4", "https://x/a.mp4.png", "https://x/mp4", "https://x/a.avi", "", "not a url"]) {
      expect(videoOverlayWiredLayerKind({}, url)).toBe("image")
    }
  })

  it("videoOverlayHasVideoLayer: any layer with a video", () => {
    expect(videoOverlayHasVideoLayer([{ imageUrl: I, start: 0 }, null, { videoUrl: V, start: 0 }])).toBe(true)
    expect(videoOverlayHasVideoLayer([{ imageUrl: I, start: 0 }, { videoUrl: "", start: 0 }, null])).toBe(false)
    expect(videoOverlayHasVideoLayer([])).toBe(false)
    expect(videoOverlayHasVideoLayer(null)).toBe(false)
    expect(videoOverlayHasVideoLayer(["https://x/a.mp4"] as unknown as VideoOverlayLayerInput[])).toBe(false)
  })

  it("the wire type takes exactly one source", () => {
    const image: VideoOverlayLayerSpec = { imageUrl: I, start: 0 }
    const video: VideoOverlayLayerSpec = { videoUrl: V, start: 0, sound: { volume: 0.5 } }
    // @ts-expect-error — both sources
    const both: VideoOverlayLayerSpec = { imageUrl: I, videoUrl: V, start: 0 }
    // @ts-expect-error — neither source
    const neither: VideoOverlayLayerSpec = { start: 0 }
    expect([image, video, both, neither]).toHaveLength(4)
  })

  // Captured by running videoOverlayCompositionKey on IMAGE_ONLY_FIXTURE before video layers existed.
  const IMAGE_ONLY_FIXTURE = {
    baseUrl: "https://x/base.mp4",
    sources: ["https://x/wired.png", undefined, "https://x/own.png"],
    data: {
      layers: [
        { start: 1, end: 4, preset: "card" as const },
        null,
        { imageUrl: "https://x/own.png", start: 0, anchor: "top-left" as const, x: 2, y: 3, width: 30, fit: "cover" as const, opacity: 0.5, animate: true, zIndex: 4 },
      ],
      outputAspect: "9:16",
      baseFit: "contain",
      backgroundColor: "#101010",
    },
  }
  const KEY_CAPTURED_BEFORE_THIS_CHANGE = String.raw`["https://x/base.mp4",["https://x/wired.png",null,"https://x/own.png"],[{"end":4,"preset":"card","start":1},null,{"anchor":"top-left","animate":true,"fit":"cover","imageUrl":"https://x/own.png","opacity":0.5,"start":0,"width":30,"x":2,"y":3,"zIndex":4}],"9:16","contain","#101010"]`

  it("an image-only composition keeps today's key", () => {
    expect(videoOverlayCompositionKey(IMAGE_ONLY_FIXTURE)).toBe(KEY_CAPTURED_BEFORE_THIS_CHANGE)
  })
  it("a layer's video and its sound change the key", () => {
    const withVideo = (layer: VideoOverlayLayerInput) => {
      const layers = [layer]
      return videoOverlayCompositionKey({ baseUrl: B, sources: videoOverlaySlotSources(layers, []), data: { layers } })
    }
    const k = withVideo({ videoUrl: V, start: 0 })
    expect(withVideo({ videoUrl: "https://x/other.mp4", start: 0 })).not.toBe(k)
    expect(withVideo({ videoUrl: V, start: 0, sound: { volume: 1 } })).not.toBe(k)
    expect(withVideo({ videoUrl: V, start: 0, sound: { volume: 0.5 } })).not.toBe(withVideo({ videoUrl: V, start: 0, sound: { volume: 1 } }))
  })
  it("a wired slot's kind changes the key, even when its URL does not (videoSlots: 1-based, in any order)", () => {
    const wired = { baseUrl: B, sources: ["https://x/signed/clip?sig=1", "https://x/b.png"], data: { layers: [] } }
    const asImages = videoOverlayCompositionKey(wired)
    const slot1Video = videoOverlayCompositionKey({ ...wired, videoSlots: [1] })
    expect(slot1Video).not.toBe(asImages)
    expect(videoOverlayCompositionKey({ ...wired, videoSlots: [2] })).not.toBe(slot1Video)
    expect(videoOverlayCompositionKey({ ...wired, videoSlots: new Set([2, 1]) })).toBe(videoOverlayCompositionKey({ ...wired, videoSlots: [1, 2] }))
  })
  it("no wired video slot keeps the image-only key, whether absent, null or empty", () => {
    expect(videoOverlayCompositionKey({ ...IMAGE_ONLY_FIXTURE, videoSlots: [] })).toBe(KEY_CAPTURED_BEFORE_THIS_CHANGE)
    expect(videoOverlayCompositionKey({ ...IMAGE_ONLY_FIXTURE, videoSlots: new Set() })).toBe(KEY_CAPTURED_BEFORE_THIS_CHANGE)
    expect(videoOverlayCompositionKey({ ...IMAGE_ONLY_FIXTURE, videoSlots: null })).toBe(KEY_CAPTURED_BEFORE_THIS_CHANGE)
  })
})
