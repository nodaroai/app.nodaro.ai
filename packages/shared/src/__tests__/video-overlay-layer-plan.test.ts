import { describe, expect, it } from "vitest"
import {
  VIDEO_OVERLAY_MAX_LAYERS,
  assembleVideoOverlayRequest,
  formatVideoOverlayError,
  parseVideoOverlayLayerPlan,
  validateVideoOverlayRequest,
  videoOverlayCompositionKey,
  videoOverlayRenderOrder,
  videoOverlaySlotSources,
} from "../video-overlay.js"

const box = { anchor: "top", x: 0, y: 12, width: 78, height: 52, fit: "contain" } as const
const plan = [
  { imageUrl: "https://cdn.example/s1.png", start: 1.4, end: 2.8, ...box },
  { imageUrl: "https://cdn.example/s2.png", start: 3.2, end: 4.6, ...box },
]

describe("the layerPlan input (SP2 D6, spec §6.1)", () => {
  it("parses a JSON string or an array of objects; anything else is invalid_layer_plan", () => {
    expect(parseVideoOverlayLayerPlan(JSON.stringify(plan))).toEqual({ layers: plan })
    expect(parseVideoOverlayLayerPlan(plan)).toEqual({ layers: plan })
    expect(parseVideoOverlayLayerPlan("{")).toEqual({ error: "invalid_layer_plan" })
    expect(parseVideoOverlayLayerPlan({ layers: plan })).toEqual({ error: "invalid_layer_plan" })
    expect(parseVideoOverlayLayerPlan([1, 2])).toEqual({ error: "invalid_layer_plan" })
  })
  it("puts plan layers first, then the slot layers, and stamps planLayer", () => {
    const req = assembleVideoOverlayRequest({
      videoUrl: "https://cdn.example/v.mp4",
      data: { layers: [{ preset: "corner-badge", start: 0 }] },
      wiredImageUrls: ["https://cdn.example/logo.png"],
      planLayers: JSON.stringify(plan),
    })
    expect(req.layers.map((l) => l.imageUrl)).toEqual(["https://cdn.example/s1.png", "https://cdn.example/s2.png", "https://cdn.example/logo.png"])
    expect(req.layers[0]!.planLayer).toBe(1)
    expect(req.layers[0]!.slot).toBeUndefined()
    expect(req.layers[2]!.slot).toBe(1)
  })
  it("never fills a plan layer's image from the index-aligned handle (R18)", () => {
    const req = assembleVideoOverlayRequest({
      videoUrl: "https://cdn.example/v.mp4",
      data: { layers: [] },
      wiredImageUrls: ["https://cdn.example/handle.png"],
      planLayers: [{ start: 1, ...box }],
    })
    const verdict = validateVideoOverlayRequest(req)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe("layer_without_image")
      expect(formatVideoOverlayError(verdict)).toBe("Plan layer 1: no image — set imageUrl on this layer in the plan.")
    }
  })
  it("a handle layer without an image keeps the handle wording", () => {
    const verdict = validateVideoOverlayRequest({ layers: [{ start: 0, slot: 2 }] })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(formatVideoOverlayError(verdict)).toBe("Layer 2: no image — connect one to the layer's handle or set imageUrl")
  })
  it("reports an unparseable plan as invalid_layer_plan", () => {
    const req = assembleVideoOverlayRequest({ videoUrl: "https://cdn.example/v.mp4", data: { layers: [] }, wiredImageUrls: [], planLayers: "not json" })
    const verdict = validateVideoOverlayRequest(req)
    expect(verdict.ok ? null : verdict.code).toBe("invalid_layer_plan")
  })
  it("counts plan and slot layers together against the 20-layer cap", () => {
    const many = Array.from({ length: VIDEO_OVERLAY_MAX_LAYERS }, (_, i) => ({ ...plan[0], start: i }))
    const req = assembleVideoOverlayRequest({ videoUrl: "https://cdn.example/v.mp4", data: { layers: [{ preset: "corner-badge", start: 0 }] }, wiredImageUrls: ["https://cdn.example/logo.png"], planLayers: many })
    const verdict = validateVideoOverlayRequest(req)
    expect(verdict.ok ? null : verdict.code).toBe("too_many_layers")
  })
  it("makes a new plan read as stale", () => {
    const base = { baseUrl: "https://cdn.example/v.mp4", sources: videoOverlaySlotSources([], []), data: { layers: [] } }
    expect(videoOverlayCompositionKey({ ...base, planLayers: plan })).not.toBe(videoOverlayCompositionKey({ ...base, planLayers: [plan[0]] }))
    expect(videoOverlayCompositionKey({ ...base, planLayers: plan })).toBe(videoOverlayCompositionKey({ ...base, planLayers: JSON.stringify(plan) }))
  })
  it("renders every plan layer under every slot layer — handle layers draw above the cards", () => {
    const req = assembleVideoOverlayRequest({
      videoUrl: "https://cdn.example/v.mp4",
      data: { layers: [{ preset: "corner-badge", start: 0 }] },
      wiredImageUrls: ["https://cdn.example/logo.png"],
      planLayers: plan,
    })
    // [plan 1, plan 2, slot 1] — slot 1 (position 0) would sit under plan 2 by position alone.
    expect(videoOverlayRenderOrder(req.layers)).toEqual([0, 1, 2])
    expect(videoOverlayRenderOrder(req.layers.map((l, i) => ({ ...l, index: i })).reverse())).toEqual([2, 1, 0])
    expect(videoOverlayRenderOrder([{ slot: 1 }, { planLayer: 2 }, { planLayer: 1 }])).toEqual([2, 1, 0])
    // An explicit zIndex on a plan layer is respected.
    expect(videoOverlayRenderOrder([{ slot: 1 }, { planLayer: 1, zIndex: 50 }])).toEqual([0, 1])
  })
  it("an absent plan changes nothing: the request and the key are today's", () => {
    const base = { baseUrl: "https://cdn.example/v.mp4", sources: videoOverlaySlotSources([], []), data: { layers: [] } }
    expect(videoOverlayCompositionKey(base)).toBe(videoOverlayCompositionKey({ ...base, planLayers: undefined }))
    expect(JSON.parse(videoOverlayCompositionKey(base))).toHaveLength(6)
    expect(assembleVideoOverlayRequest({ videoUrl: "v", data: { layers: [] }, wiredImageUrls: [] }).planError).toBeUndefined()
  })
})
