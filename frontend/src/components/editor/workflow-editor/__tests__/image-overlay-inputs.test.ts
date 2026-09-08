/**
 * Canvas-side Image Overlay input routing — mirrors the backend
 * image-overlay-wiring suite, because the two resolvers fail independently:
 *
 *   1. the `image` handle is the base → inputs.imageUrl;
 *   2. `overlay`..`overlay4` land at their handle INDEX in
 *      inputs.overlayImageUrls (sparse when a middle handle is unwired) —
 *      never accumulated, never routed by source type;
 *   3. the node's definition keeps the handle list the resolver dispatches on.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../node-input-resolver"
import { NODE_DEFINITIONS, OVERLAY_HANDLE_IDS, DEFAULT_OVERLAY_LAYER, type WorkflowNode, type WorkflowEdge } from "@/types/nodes"

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as WorkflowNode
}

function edge(source: string, target: string, targetHandle?: string): WorkflowEdge {
  return { id: `${source}->${target}`, source, target, targetHandle } as WorkflowEdge
}

describe("resolveNodeInputs — image-overlay (canvas)", () => {
  it("routes the base to imageUrl and each overlay handle to its index", () => {
    const target = node("ov", "image-overlay")
    const base = node("b", "upload-image", { url: "https://x/base.png", imageUrl: "https://x/base.png" })
    const l1 = node("l1", "upload-image", { url: "https://x/logo.svg", imageUrl: "https://x/logo.svg" })
    const l4 = node("l4", "upload-image", { url: "https://x/badge.png", imageUrl: "https://x/badge.png" })
    const inputs = resolveNodeInputs(
      target,
      [base, l1, l4, target],
      [edge("b", "ov", "image"), edge("l1", "ov", "overlay"), edge("l4", "ov", "overlay4")],
    )
    expect(inputs.imageUrl).toBe("https://x/base.png")
    expect(inputs.overlayImageUrls).toEqual(["https://x/logo.svg", undefined, undefined, "https://x/badge.png"])
    expect(inputs.imageUrls).toBeUndefined()
  })

  it("overlay0 / overlay5 are not layer handles — never a silent out-of-range index", () => {
    const target = node("ov", "image-overlay")
    const base = node("b", "upload-image", { url: "https://x/base.png", imageUrl: "https://x/base.png" })
    const a = node("a", "upload-image", { url: "https://x/a.png", imageUrl: "https://x/a.png" })
    const inputs = resolveNodeInputs(target, [base, a, target], [edge("b", "ov", "image"), edge("a", "ov", "overlay0")])
    expect(inputs.imageUrl).toBe("https://x/base.png")
    expect(inputs.overlayImageUrls).toBeUndefined()
  })

  it("an edge without a handle fills the base only while it is empty", () => {
    const target = node("ov", "image-overlay")
    const base = node("b", "upload-image", { url: "https://x/base.png", imageUrl: "https://x/base.png" })
    const other = node("o", "upload-image", { url: "https://x/other.png", imageUrl: "https://x/other.png" })
    const inputs = resolveNodeInputs(target, [base, other, target], [edge("b", "ov"), edge("o", "ov")])
    expect(inputs.imageUrl).toBe("https://x/base.png")
    expect(inputs.overlayImageUrls).toBeUndefined()
  })
})

describe("resolveNodeInputs — image-overlay QR link handle", () => {
  it("routes text on the qrText handle into overlayQrText, never into an image slot", () => {
    const target = node("ov", "image-overlay")
    const base = node("b", "upload-image", { url: "https://x/base.png", imageUrl: "https://x/base.png" })
    const link = node("t", "text-prompt", { text: "https://nodaro.ai/promo" })
    const inputs = resolveNodeInputs(target, [base, link, target], [edge("b", "ov", "image"), edge("t", "ov", "qrText")])
    expect(inputs.imageUrl).toBe("https://x/base.png")
    expect(inputs.overlayQrText).toBe("https://nodaro.ai/promo")
    expect(inputs.overlayImageUrls).toBeUndefined()
  })
})

describe("image-overlay node definition", () => {
  const def = NODE_DEFINITIONS.find((d) => d.type === "image-overlay")!

  it("declares the base handle plus every layer handle, in handle order (the gen-skills literal must not drift from OVERLAY_HANDLE_IDS)", () => {
    expect(def).toBeDefined()
    expect(def.inputs).toEqual(["image", ...OVERLAY_HANDLE_IDS, "qrText"])
    expect(def.outputs).toEqual(["image", "mask"])
  })

  it("its default first layer is byte-equal to DEFAULT_OVERLAY_LAYER (literal copy for the gen-skills parser)", () => {
    const layers = (def.defaultData as { layers: unknown[] }).layers
    expect(layers).toEqual([DEFAULT_OVERLAY_LAYER])
  })
})
