/**
 * Image Overlay wiring — the server-side half of the node's contract:
 *
 *   1. input-resolver routes by HANDLE: `image` → imageUrl (the base),
 *      `overlay`..`overlay12` → overlayImageUrls[0..11] (sparse when a middle
 *      handle is unwired). Never by source type, never accumulated.
 *   2. payload-builder aligns data.layers[i] with the wired URL at the same
 *      index, fills a wired-but-unconfigured handle with the default layer,
 *      skips a configured-but-unwired entry, and refuses a run with no layer.
 *   3. a missing base image is refused BEFORE the credit reservation through
 *      REQUIRED_MEDIA_INPUTS (the B3 parity gate).
 *
 * The canvas resolver has the mirror suite (image-overlay-inputs.test.ts) —
 * the two fail independently.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import { buildPayload, REQUIRED_MEDIA_INPUTS } from "../payload-builder.js"
import { getPrimaryOutput, extractSavedNodeOutput, buildNodeOutputFromJobData } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"
import { OVERLAY_MAX_LAYERS } from "../../../providers/image/overlay-contract.js"
import { OVERLAY_MAX_VARIANTS, OVERLAY_PLATFORMS } from "@nodaro/shared"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(source: string, target: string, targetHandle?: string | null): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: targetHandle ?? null }
}

const states: Record<string, NodeExecutionState> = {}

describe("resolveNodeInputs — image-overlay", () => {
  it("routes the base to imageUrl and each overlay handle to its index", () => {
    const target = node("ov", "image-overlay")
    const base = node("b", "upload-image", { url: "https://x/base.png" })
    const l1 = node("l1", "upload-image", { url: "https://x/logo.svg" })
    const l3 = node("l3", "upload-image", { url: "https://x/badge.png" })
    const result = resolveNodeInputs(
      target,
      [edge("b", "ov", "image"), edge("l1", "ov", "overlay"), edge("l3", "ov", "overlay3")],
      states,
      [base, l1, l3, target],
    )
    expect(result.imageUrl).toBe("https://x/base.png")
    expect(result.overlayImageUrls).toEqual(["https://x/logo.svg", undefined, "https://x/badge.png"])
    expect(result.imageUrls).toBeUndefined()
  })

  it("only the real layer handles index a layer — overlay0 / overlay99 are not handles", () => {
    const target = node("ov", "image-overlay")
    const base = node("b", "upload-image", { url: "https://x/base.png" })
    const a = node("a", "upload-image", { url: "https://x/a.png" })
    const b = node("b2", "upload-image", { url: "https://x/b.png" })
    const result = resolveNodeInputs(
      target,
      [edge("b", "ov", "image"), edge("a", "ov", "overlay0"), edge("b2", "ov", "overlay99")],
      states,
      [base, a, b, target],
    )
    expect(result.imageUrl).toBe("https://x/base.png")
    expect(result.overlayImageUrls).toBeUndefined()
  })

  it("an edge with no handle fills the base only while it is empty (API-authored workflows)", () => {
    const target = node("ov", "image-overlay")
    const base = node("b", "upload-image", { url: "https://x/base.png" })
    const other = node("o", "upload-image", { url: "https://x/other.png" })
    const result = resolveNodeInputs(target, [edge("b", "ov"), edge("o", "ov")], states, [base, other, target])
    expect(result.imageUrl).toBe("https://x/base.png")
    expect(result.overlayImageUrls).toBeUndefined()
  })
})

describe("buildPayload — image-overlay", () => {
  const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })

  it("aligns data.layers[i] with the wired URL at the same index and skips holes", () => {
    const n = node("ov", "image-overlay", {
      layers: [
        { anchor: "bottom-right", x: -4, y: -6, width: 12, opacity: 0.95, rotation: 0, blend: "over", fit: "contain" },
        { anchor: "top-left", width: 30 },
        { anchor: "center", width: 50 },
      ],
      outputFormat: "webp",
    })
    const r = buildPayload(
      n,
      "job-1",
      { imageUrl: "https://x/base.png", overlayImageUrls: ["https://x/logo.svg", undefined, "https://x/badge.png"] },
      "usage-1",
      ctx(n),
    )
    expect(r.jobName).toBe("image-overlay")
    expect(r.modelIdentifier).toBe("image-overlay")
    expect(r.queueName).toBe("video-generation")
    const layers = r.payload.layers as Array<Record<string, unknown>>
    expect(layers).toHaveLength(2)
    expect(layers[0]).toMatchObject({ imageUrl: "https://x/logo.svg", anchor: "bottom-right", x: -4, y: -6, width: 12, opacity: 0.95 })
    // layers[1] (top-left) had no wire → skipped; the overlay3 wire carries layers[2]'s settings.
    expect(layers[1]).toMatchObject({ imageUrl: "https://x/badge.png", anchor: "center", width: 50 })
    expect(r.payload.imageUrl).toBe("https://x/base.png")
    expect(r.payload.outputFormat).toBe("webp")
    expect(r.payload.usageLogId).toBe("usage-1")
  })

  it("an imageUrl written into data.layers[i] is ignored — a layer reaches the node only through a wire (mirrors the canvas executor)", () => {
    const n = node("ov", "image-overlay", { layers: [{ imageUrl: "https://x/smuggled.png", anchor: "center", width: 25 }] })
    expect(() => buildPayload(n, "job-1", { imageUrl: "https://x/base.png" }, undefined, ctx(n))).toThrow(/at least one layer/)
    const r = buildPayload(n, "job-1", { imageUrl: "https://x/base.png", overlayImageUrls: ["https://x/wired.png"] }, undefined, ctx(n))
    expect(r.payload.layers).toEqual([{ anchor: "center", width: 25, kind: "image", imageUrl: "https://x/wired.png" }])
  })

  it("caps the layer count at the handle count BEFORE the credit reservation", () => {
    const n = node("ov", "image-overlay", { layers: [] })
    const many = Array.from({ length: OVERLAY_MAX_LAYERS + 3 }, (_, i) => `https://x/${i}.png`)
    const r = buildPayload(n, "job-1", { imageUrl: "https://x/base.png", overlayImageUrls: many }, undefined, ctx(n))
    expect((r.payload.layers as unknown[]).length).toBe(OVERLAY_MAX_LAYERS)
  })

  it("a wired handle with no data.layers entry runs with the provider defaults (bare imageUrl)", () => {
    const n = node("ov", "image-overlay", { layers: [] })
    const r = buildPayload(n, "job-1", { imageUrl: "https://x/base.png", overlayImageUrls: ["https://x/logo.png"] }, undefined, ctx(n))
    expect(r.payload.layers).toEqual([{ kind: "image", imageUrl: "https://x/logo.png" }])
  })

  it("refuses a run with a base but no layer at all", () => {
    const n = node("ov", "image-overlay", { layers: [{ anchor: "center", width: 25 }] })
    expect(() => buildPayload(n, "job-1", { imageUrl: "https://x/base.png" }, undefined, ctx(n))).toThrow(/at least one layer/)
  })

  it("a generated layer (text / qr / shape) needs no wire and travels whole, in its slot order", () => {
    const n = node("ov", "image-overlay", {
      layers: [
        { kind: "text", anchor: "top", y: 5, text: { text: "SALE", fontId: "inter", fontWeight: 800, fontSize: 10, color: "#ffffff", align: "center", letterSpacing: 0, lineHeight: 1.1, uppercase: true } },
        { anchor: "bottom-right", width: 12 },
        { kind: "qr", width: 15, qr: { text: "https://nodaro.ai", color: "#000000", margin: 1 } },
      ],
    })
    const r = buildPayload(n, "job-1", { imageUrl: "https://x/base.png", overlayImageUrls: [undefined, "https://x/logo.png"] }, undefined, ctx(n))
    const layers = r.payload.layers as Array<Record<string, unknown>>
    expect(layers.map((l) => l.kind)).toEqual(["text", "image", "qr"])
    expect(layers[0].text).toMatchObject({ text: "SALE", uppercase: true })
    expect(layers[1]).toMatchObject({ imageUrl: "https://x/logo.png", anchor: "bottom-right" })
    expect(layers[2].qr).toMatchObject({ text: "https://nodaro.ai" })
  })

  it("the QR link handle: text routes to overlayQrText, rides as payload.qrText, and a fromInput QR with nothing wired is refused before the reservation", () => {
    const target = node("ov", "image-overlay", { layers: [{ kind: "qr", width: 15, qr: { text: "", fromInput: true, color: "#000000", margin: 1 } }] })
    const base = node("b", "upload-image", { url: "https://x/base.png" })
    const link = node("t", "text-prompt", { text: "https://nodaro.ai/promo" })
    const resolved = resolveNodeInputs(target, [edge("b", "ov", "image"), edge("t", "ov", "qrText")], states, [base, link, target])
    expect(resolved.overlayQrText).toBe("https://nodaro.ai/promo")
    expect(resolved.overlayImageUrls).toBeUndefined()

    const r = buildPayload(target, "job-1", resolved, undefined, ctx(target))
    expect(r.payload.qrText).toBe("https://nodaro.ai/promo")
    expect((r.payload.layers as Array<Record<string, unknown>>)[0]).toMatchObject({ kind: "qr" })

    expect(() => buildPayload(target, "job-2", { imageUrl: "https://x/base.png" }, undefined, ctx(target))).toThrow(/QR link handle/)
  })

  it("a variant:<platformId> source handle yields that platform's render, mask its mask, anything else the composite — from a live output and from a saved node alike", () => {
    const output = { imageUrl: "https://x/main.png", maskUrl: "https://x/mask.png", variants: [{ id: "x-header", label: "X / Twitter header", url: "https://x/x.png", width: 1500, height: 500 }] }
    expect(getPrimaryOutput(output, "image-overlay", "variant:x-header")).toBe("https://x/x.png")
    expect(getPrimaryOutput(output, "image-overlay", "variant:youtube-thumbnail")).toBeUndefined()
    expect(getPrimaryOutput(output, "image-overlay", "variant:not-a-platform")).toBe("https://x/main.png")
    expect(getPrimaryOutput(output, "image-overlay", "mask")).toBe("https://x/mask.png")
    expect(getPrimaryOutput(output, "image-overlay", "image")).toBe("https://x/main.png")

    const saved = extractSavedNodeOutput(node("ov", "image-overlay", {
      generatedImageUrl: "https://x/main.png",
      overlayVariants: [{ id: "x-header", label: "X / Twitter header", url: "https://x/x.png", width: 1500, height: 500 }, { id: 7, url: "bad" }],
    }))
    expect(saved?.variants).toEqual([{ id: "x-header", label: "X / Twitter header", url: "https://x/x.png", width: 1500, height: 500 }])
    expect(getPrimaryOutput(saved!, "image-overlay", "variant:x-header")).toBe("https://x/x.png")
  })

  it("as a SOURCE the overlay feeds downstream nodes: composite → upscale, mask → Modify Image's mask, variant:<id> → that render (orchestrator resolver)", () => {
    const ov = node("ov", "image-overlay")
    const live: Record<string, NodeExecutionState> = {
      ov: { status: "completed", output: { imageUrl: "https://x/main.png", maskUrl: "https://x/mask.png", variants: [{ id: "youtube-thumbnail", url: "https://x/yt.png" }] } },
    }
    const up = node("up", "upscale-image")
    expect(resolveNodeInputs(up, [{ ...edge("ov", "up", "image"), sourceHandle: "image" }], live, [ov, up]).imageUrl).toBe("https://x/main.png")
    const upYt = node("up2", "upscale-image")
    expect(resolveNodeInputs(upYt, [{ ...edge("ov", "up2", "image"), sourceHandle: "variant:youtube-thumbnail" }], live, [ov, upYt]).imageUrl).toBe("https://x/yt.png")
    const mod = node("mod", "modify-image")
    const modInputs = resolveNodeInputs(mod, [{ ...edge("ov", "mod", "image"), sourceHandle: "image" }, { ...edge("ov", "mod", "mask"), sourceHandle: "mask" }], live, [ov, mod])
    expect(modInputs.maskUrl).toBe("https://x/mask.png")
    expect(modInputs.referenceImageUrls ?? [modInputs.imageUrl]).toContain("https://x/main.png")
  })

  it("the live DAG keeps the platform renders from the job row (execution 1180e15d dropped them)", () => {
    const out = buildNodeOutputFromJobData({ imageUrl: "https://x/main.png", maskUrl: "https://x/mask.png", width: 1280, height: 720, variants: [{ id: "instagram-post", label: "Instagram post (1:1)", url: "https://x/ig.png", width: 1080, height: 1080 }] } as never, "image-overlay")
    expect(out?.variants?.map((v) => v.id)).toEqual(["instagram-post"])
    expect(getPrimaryOutput(out!, "image-overlay", "variant:instagram-post")).toBe("https://x/ig.png")
  })

  it("a platform a wire leaves through is rendered even when the tick list forgot it (MCP / import / template edges)", () => {
    const n = node("ov", "image-overlay", { layers: [], variants: ["instagram-post"] })
    const edges = [{ id: "e1", source: "ov", target: "up", sourceHandle: "variant:youtube-thumbnail", targetHandle: "image" }, { id: "e2", source: "ov", target: "up2", sourceHandle: "variant:instagram-post", targetHandle: "image" }, { id: "e3", source: "ov", target: "x", sourceHandle: "variant:not-a-platform", targetHandle: "image" }]
    const r = buildPayload(n, "job-1", { imageUrl: "https://x/base.png", overlayImageUrls: ["https://x/logo.png"] }, undefined, { nodes: [n], edges, nodeStates: {} })
    expect(r.payload.variants).toEqual(["instagram-post", "youtube-thumbnail"])
  })

  it("refuses a run with no base image through the REQUIRED_MEDIA_INPUTS gate", () => {
    expect(REQUIRED_MEDIA_INPUTS["image-overlay"]).toMatchObject({ anyOf: ["imageUrl"], kind: "image" })
    const n = node("ov", "image-overlay", { layers: [] })
    expect(() => buildPayload(n, "job-1", { overlayImageUrls: ["https://x/logo.png"] }, undefined, ctx(n))).toThrow(/image_required/)
  })

  it("forwards the platform export variants, string ids only, capped at the registry size (every platform at once)", () => {
    const ids = ["youtube-thumbnail", 7, "instagram-story", ...Array.from({ length: OVERLAY_MAX_VARIANTS + 2 }, (_, i) => `p${i}`)]
    const n = node("ov", "image-overlay", { layers: [], variants: ids })
    const r = buildPayload(n, "job-1", { imageUrl: "https://x/base.png", overlayImageUrls: ["https://x/logo.png"] }, undefined, ctx(n))
    const strings = ids.filter((v): v is string => typeof v === "string")
    expect(r.payload.variants).toEqual(strings.slice(0, OVERLAY_MAX_VARIANTS))
    expect(OVERLAY_MAX_VARIANTS).toBe(OVERLAY_PLATFORMS.length)
    const none = node("ov", "image-overlay", { layers: [] })
    expect(buildPayload(none, "job-1", { imageUrl: "https://x/base.png", overlayImageUrls: ["https://x/logo.png"] }, undefined, ctx(none)).payload.variants).toBeUndefined()
  })

  it("forwards canvas / baseFit only when they are well-formed", () => {
    const n = node("ov", "image-overlay", { layers: [], canvas: { width: 1500, height: 500, backgroundColor: "#000000" }, baseFit: "cover" })
    const r = buildPayload(n, "job-1", { imageUrl: "https://x/base.png", overlayImageUrls: ["https://x/logo.png"] }, undefined, ctx(n))
    expect(r.payload.canvas).toEqual({ width: 1500, height: 500, backgroundColor: "#000000" })
    expect(r.payload.baseFit).toBe("cover")
    const bad = node("ov", "image-overlay", { layers: [], baseFit: "stretch" })
    const r2 = buildPayload(bad, "job-1", { imageUrl: "https://x/base.png", overlayImageUrls: ["https://x/logo.png"] }, undefined, ctx(bad))
    expect(r2.payload.baseFit).toBeUndefined()
    expect(r2.payload.canvas).toBeUndefined()
  })
})
