// backend/src/services/workflow-engine/__tests__/video-overlay-wiring.test.ts
/**
 * Video Overlay wiring — the DAG half of the node's contract (spec §3.5, §6):
 *
 *   1. input-resolver routes by HANDLE: `video` → videoUrl (the base),
 *      `overlay`..`overlay12` → overlayImageUrls[0..11] (sparse when a middle
 *      handle is unwired), the reserved `layerPlan` → inputs.layerPlan (not
 *      read in v1). Never by source type.
 *   2. payload-builder runs the SHARED assembly (the canvas executor runs the
 *      same one): per slot the wired image, else the layer's own imageUrl; a
 *      wired slot with no settings is the default corner badge; empty slots
 *      dropped; `slot` stamped; presets expanded — then the shared validator,
 *      which throws BEFORE the credit reservation.
 *   3. a missing base video is refused through REQUIRED_MEDIA_INPUTS.
 *   4. as a SOURCE, a finished Video Overlay reads as a video.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import { buildPayload, REQUIRED_MEDIA_INPUTS } from "../payload-builder.js"
import { extractSavedNodeOutput } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"
import { DEFAULT_VIDEO_OVERLAY_LAYER, VIDEO_OVERLAY_MAX_LAYERS, videoOverlayCompositionKey, videoOverlaySlotSources, type VideoOverlayLayerInput } from "@nodaro/shared"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(source: string, target: string, targetHandle?: string | null): SimpleEdge {
  return { id: `${source}->${target}:${targetHandle ?? ""}`, source, target, sourceHandle: null, targetHandle: targetHandle ?? null }
}

const states: Record<string, NodeExecutionState> = {}
const BASE = "https://x/base.mp4"
const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })

describe("resolveNodeInputs — video-overlay", () => {
  it("routes the base to videoUrl, each layer handle to its index, and layerPlan aside", () => {
    const target = node("vo", "video-overlay")
    const base = node("b", "upload-video", { url: BASE })
    const l1 = node("l1", "upload-image", { url: "https://x/card1.png" })
    const l3 = node("l3", "upload-image", { url: "https://x/card3.png" })
    const plan = node("p", "text-prompt", { text: '[{"start":1}]' })
    const result = resolveNodeInputs(
      target,
      [edge("b", "vo", "video"), edge("l1", "vo", "overlay"), edge("l3", "vo", "overlay3"), edge("p", "vo", "layerPlan")],
      states,
      [base, l1, l3, plan, target],
    )
    expect(result.videoUrl).toBe(BASE)
    expect(result.overlayImageUrls).toEqual(["https://x/card1.png", undefined, "https://x/card3.png"])
    expect(result.layerPlan).toBe('[{"start":1}]')
    expect(result.imageUrl).toBeUndefined()
  })

  it("only the real layer handles index a layer; an edge with no handle fills the base while it is empty", () => {
    const target = node("vo", "video-overlay")
    const base = node("b", "upload-video", { url: BASE })
    const other = node("o", "upload-video", { url: "https://x/other.mp4" })
    const stray = node("s", "upload-image", { url: "https://x/stray.png" })
    const result = resolveNodeInputs(target, [edge("b", "vo"), edge("o", "vo"), edge("s", "vo", "overlay13")], states, [base, other, stray, target])
    expect(result.videoUrl).toBe(BASE)
    expect(result.overlayImageUrls).toBeUndefined()
  })
})

describe("buildPayload — video-overlay", () => {
  it("the shared assembly: wired ?? imageUrl, a wired slot with no settings = the default badge, holes dropped, slot stamped", () => {
    const n = node("vo", "video-overlay", {
      layers: [
        null,
        { imageUrl: "https://x/own.png", start: 2, end: 4, preset: "card" },
        { start: 1 },
      ],
      outputAspect: "9:16",
      baseFit: "contain",
      backgroundColor: "#101010",
    })
    const r = buildPayload(
      n,
      "job-1",
      { videoUrl: BASE, overlayImageUrls: ["https://x/wired1.png", undefined, undefined, "https://x/wired4.png"] },
      "usage-1",
      ctx(n),
    )
    expect(r.jobName).toBe("video-overlay")
    expect(r.modelIdentifier).toBe("video-overlay")
    expect(r.queueName).toBe("video-generation")
    expect(r.payload).toMatchObject({ jobId: "job-1", videoUrl: BASE, outputAspect: "9:16", baseFit: "contain", backgroundColor: "#101010", usageLogId: "usage-1" })
    expect(r.payload.layers).toEqual([
      { ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: "https://x/wired1.png", slot: 1 },
      { imageUrl: "https://x/own.png", slot: 2, start: 2, end: 4, preset: "card", anchor: "center", x: 0, y: -4, width: 78, height: 60, fit: "contain", opacity: 1, animate: true },
      { ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: "https://x/wired4.png", slot: 4 },
    ])
  })

  it("a null field is absent (Review Focus 1): { end: null, height: null, preset: null } is the default badge with its own start", () => {
    const n = node("vo", "video-overlay", { layers: [{ start: 3, end: null, height: null, preset: null }] })
    const r = buildPayload(n, "job-1", { videoUrl: BASE, overlayImageUrls: ["https://x/a.png"] }, undefined, ctx(n))
    expect(r.payload.layers).toEqual([{ ...DEFAULT_VIDEO_OVERLAY_LAYER, start: 3, imageUrl: "https://x/a.png", slot: 1 }])
  })

  it("the wired image wins over a stale imageUrl on the same slot", () => {
    const n = node("vo", "video-overlay", { layers: [{ imageUrl: "https://x/stale.png", start: 0 }] })
    const r = buildPayload(n, "job-1", { videoUrl: BASE, overlayImageUrls: ["https://x/wired.png"] }, undefined, ctx(n))
    expect((r.payload.layers as Array<{ imageUrl: string }>)[0]!.imageUrl).toBe("https://x/wired.png")
  })

  it("refuses before the reservation with the validator's text — no layer, and end ≤ start (named by slot)", () => {
    const empty = node("vo", "video-overlay", { layers: [] })
    expect(() => buildPayload(empty, "job-1", { videoUrl: BASE }, undefined, ctx(empty))).toThrow("Video Overlay: At least 1 layer is required")
    const bad = node("vo", "video-overlay", { layers: [null, { start: 5, end: 4 }] })
    expect(() => buildPayload(bad, "job-1", { videoUrl: BASE, overlayImageUrls: [undefined, "https://x/b.png"] }, undefined, ctx(bad))).toThrow(
      "Video Overlay: Layer 2: end (4 s) must be after start (5 s)",
    )
    // Spec §3.5 / §4.4: a JSON-written fit with no output aspect is refused on the DAG path
    // too (the assembly forwards it; the validator refuses it) — never rendered as if absent.
    const fitOnly = node("vo", "video-overlay", { layers: [{ imageUrl: "https://x/a.png", start: 0 }], baseFit: "contain" })
    expect(() => buildPayload(fitOnly, "job-1", { videoUrl: BASE }, undefined, ctx(fitOnly))).toThrow(
      "Video Overlay: baseFit and backgroundColor need an outputAspect",
    )
  })

  it("carries layers 13–20 from data.imageUrl", () => {
    const layers = Array.from({ length: VIDEO_OVERLAY_MAX_LAYERS }, (_, i) => ({ imageUrl: `https://x/${i}.png`, start: i }))
    const n = node("vo", "video-overlay", { layers })
    const r = buildPayload(n, "job-1", { videoUrl: BASE }, undefined, ctx(n))
    const out = r.payload.layers as Array<{ slot: number }>
    expect(out).toHaveLength(VIDEO_OVERLAY_MAX_LAYERS)
    expect(out.at(-1)!.slot).toBe(20)
  })

  it("refuses more than 20 stored layers before the reservation (too_many_layers) — never drops layers 21+ silently", () => {
    const layers = Array.from({ length: 24 }, (_, i) => ({ imageUrl: `https://x/${i}.png`, start: i }))
    const n = node("vo", "video-overlay", { layers })
    expect(() => buildPayload(n, "job-1", { videoUrl: BASE }, undefined, ctx(n))).toThrow("Video Overlay: At most 20 layers (got 24)")
  })

  it("no base video → REQUIRED_MEDIA_INPUTS refuses it (video_required)", () => {
    expect(REQUIRED_MEDIA_INPUTS["video-overlay"]).toMatchObject({ anyOf: ["videoUrl"], kind: "video" })
    const n = node("vo", "video-overlay", { layers: [{ imageUrl: "https://x/a.png", start: 0 }] })
    expect(() => buildPayload(n, "job-1", {}, undefined, ctx(n))).toThrow(/video_required/)
  })
})

describe("buildPayload — video-overlay stamps the freshness key (resultCompositionKey)", () => {
  // What the canvas computes for this node (video-overlay-node.tsx, and the
  // single-node Run in execute-node.ts): the shared key over the upstream base,
  // the slot sources (wired ?? imageUrl) and the node's stored settings.
  const canvasLayers: Array<VideoOverlayLayerInput | null> = [
    null,
    { imageUrl: "https://x/own.png", start: 2, end: 4, preset: "card", anchor: "center", x: 0, y: -4, width: 78, height: 60, fit: "contain", opacity: 1, animate: true },
  ]
  const canvasData = { layers: canvasLayers, outputAspect: "9:16", baseFit: "contain", backgroundColor: "#101010" }
  const canvasKey = videoOverlayCompositionKey({
    baseUrl: BASE,
    sources: videoOverlaySlotSources(canvasLayers, ["https://x/card1.png"]),
    data: canvasData,
  })
  // The same node as a schedule / webhook / app run reads it from the DB: jsonb
  // re-orders every object's keys.
  const dbLayers = [
    null,
    { x: 0, y: -4, end: 4, fit: "contain", start: 2, width: 78, anchor: "center", height: 60, preset: "card", animate: true, opacity: 1, imageUrl: "https://x/own.png" },
  ]

  it("parity: the DAG key for the resolved inputs equals the canvas key for the same node, jsonb key order and all", () => {
    const target = node("vo", "video-overlay", { backgroundColor: "#101010", baseFit: "contain", outputAspect: "9:16", layers: dbLayers })
    const base = node("b", "upload-video", { url: BASE })
    const l1 = node("l1", "upload-image", { url: "https://x/card1.png" })
    const inputs = resolveNodeInputs(target, [edge("b", "vo", "video"), edge("l1", "vo", "overlay")], states, [base, l1, target])
    const r = buildPayload(target, "job-1", inputs, "usage-1", ctx(target))
    expect(r.payload.resultCompositionKey).toBe(canvasKey)
  })

  it("is computed from the stored settings and the resolved sources, not the expanded request", () => {
    const n = node("vo", "video-overlay", canvasData)
    const r = buildPayload(n, "job-1", { videoUrl: BASE, overlayImageUrls: ["https://x/card1.png"] }, undefined, ctx(n))
    expect(r.payload.resultCompositionKey).toBe(canvasKey)
    // Another base, another image or another setting is another key.
    const other = buildPayload(n, "job-1", { videoUrl: "https://x/other.mp4", overlayImageUrls: ["https://x/card1.png"] }, undefined, ctx(n))
    expect(other.payload.resultCompositionKey).not.toBe(canvasKey)
    const otherImage = buildPayload(n, "job-1", { videoUrl: BASE, overlayImageUrls: ["https://x/card2.png"] }, undefined, ctx(n))
    expect(otherImage.payload.resultCompositionKey).not.toBe(canvasKey)
  })

  // Layers 1–4 removed from a 24-layer node: 20 layers stay at slots 5–24
  // (removal never re-numbers). The key must see slots 21–24 on both engines.
  it("parity past slot 20: layers 1–4 removed from a 24-layer node — the DAG key equals the canvas key and follows slot 24's image", () => {
    const imaged = (last: string) =>
      Array.from({ length: 24 }, (_, i) => (i < 4 ? null : { imageUrl: i === 23 ? last : `https://x/${i}.png`, start: 0, anchor: "center" as const, width: 20 }))
    // What the node / single-node Run computes (editor insertion order).
    const canvas = (last: string) => {
      const layers = imaged(last)
      return videoOverlayCompositionKey({ baseUrl: BASE, sources: videoOverlaySlotSources(layers, []), data: { layers } })
    }
    // The same node read back from the DB (jsonb re-orders keys).
    const dbNode = (last: string) =>
      node("vo", "video-overlay", { layers: imaged(last).map((l) => (l ? { width: l.width, start: l.start, imageUrl: l.imageUrl, anchor: l.anchor } : null)) })
    const dag = (last: string) => {
      const n = dbNode(last)
      const r = buildPayload(n, "job-1", { videoUrl: BASE }, undefined, ctx(n))
      expect((r.payload.layers as Array<{ slot: number }>).map((l) => l.slot)).toEqual(Array.from({ length: 20 }, (_, i) => i + 5))
      return r.payload.resultCompositionKey
    }
    expect(dag("https://x/a.png")).toBe(canvas("https://x/a.png"))
    expect(dag("https://x/b.png")).toBe(canvas("https://x/b.png"))
    expect(dag("https://x/a.png")).not.toBe(dag("https://x/b.png"))
    // Slot 24's image is in the key's sources, not only in the stored layers.
    expect(JSON.parse(dag("https://x/a.png") as string)[1][23]).toBe("https://x/a.png")
  })
})

describe("output-extractor — video-overlay as a source", () => {
  it("a finished node reads as a video", () => {
    const n = node("vo", "video-overlay", { generatedResults: [{ url: "https://x/out.mp4" }], activeResultIndex: 0 })
    expect(extractSavedNodeOutput(n)).toEqual({ videoUrl: "https://x/out.mp4" })
  })
})
