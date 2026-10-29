import { describe, expect, it } from "vitest"
import { buildPayload } from "../../../../services/workflow-engine/payload-builder.js"
import type { SimpleNode } from "../../../../services/workflow-engine/types.js"
import { NODE_HANDLES } from "../../generated/node-handles.js"
import { flowNodeFor, type FlowNodeSpec } from "../node-mappers.js"

const IMG = "https://media.nodaro.ai/images/11111111-2222-3333-4444-555555555555.png"
const IMG2 = "https://media.nodaro.ai/uploads/second.png"
const IMG3 = "https://media.nodaro.ai/uploads/third.png"
const VID = "https://media.nodaro.ai/videos/22222222-3333-4444-5555-666666666666.mp4"
const BG = "https://media.nodaro.ai/uploads/background.mp4"
const MASK = "https://media.nodaro.ai/uploads/mask.mp4"
const TRANSPORT = { mcp_client: "Claude", userId: "u1" }

/** The node a tool's call becomes; it must exist and wire only handles its type has. */
function nodeOf(route: string, tool: string, body: Record<string, unknown>): FlowNodeSpec {
  const spec = flowNodeFor(route, { ...TRANSPORT, ...body }, tool)
  expect(spec).not.toBeNull()
  const handles = NODE_HANDLES[spec!.type]?.inputs ?? []
  for (const input of spec!.inputs) expect(handles).toContain(input.targetHandle)
  return spec!
}

/** Run the node through the server engine with the inputs its wires resolve to. */
function run(spec: FlowNodeSpec, inputs: Record<string, unknown>) {
  const node: SimpleNode = { id: "n1", type: spec.type, data: { ...spec.data } }
  const built = buildPayload(node, "job1", inputs, "usage1")
  return { payload: built.payload as Record<string, unknown>, modelIdentifier: built.modelIdentifier }
}

describe("edit_image becomes the node its provider runs on", () => {
  it("an upscale re-runs on an Upscale Image node", () => {
    const body = { imageUrl: IMG, provider: "topaz-image-upscale", upscaleFactor: "4" }
    const spec = nodeOf("/v1/edit-image", "edit_image", body)
    expect(spec.type).toBe("upscale-image")
    const { payload } = run(spec, { imageUrl: IMG })
    expect(payload).toMatchObject({ imageUrl: IMG, provider: "topaz-image-upscale", upscaleFactor: "4" })
  })

  it("the default provider is the recraft upscale", () => {
    const { payload } = run(nodeOf("/v1/edit-image", "edit_image", { imageUrl: IMG }), { imageUrl: IMG })
    expect(payload.provider).toBe("recraft-upscale")
  })

  it("a background removal re-runs on a Remove Background node", () => {
    const spec = nodeOf("/v1/edit-image", "edit_image", { imageUrl: IMG, provider: "recraft-remove-bg" })
    expect(spec.type).toBe("remove-background")
    const { payload } = run(spec, { imageUrl: IMG })
    expect(payload).toMatchObject({ imageUrl: IMG, provider: "recraft-remove-bg" })
  })

  it("a prompt edit re-runs on a Modify Image node, on the edit endpoint", () => {
    const body = { imageUrl: IMG, provider: "nano-banana-edit", prompt: "make the sky purple", negativePrompt: "text", seed: 7 }
    const spec = nodeOf("/v1/edit-image", "edit_image", body)
    expect(spec.type).toBe("modify-image")
    const built = buildPayload({ id: "n1", type: spec.type, data: { ...spec.data } }, "job1", { imageUrl: IMG }, "usage1")
    expect(built.jobName).toBe("edit-image")
    const payload = built.payload as Record<string, unknown>
    expect(payload).toMatchObject({ imageUrl: IMG, provider: "nano-banana-edit", seed: 7 })
    expect(String(payload.prompt)).toContain(body.prompt)
  })

  it("maps no node for a lever its node cannot hold", () => {
    const edit = (body: Record<string, unknown>) => flowNodeFor("/v1/edit-image", { ...TRANSPORT, ...body }, "edit_image")
    // A Grok op runs on a prior task, a mask or segment indexes have no node field.
    expect(edit({ provider: "grok-2-edit", taskId: "t1", prompt: "make the sky stormy" })).toBeNull()
    expect(edit({ imageUrl: IMG, provider: "grok-2-segment", taskId: "t1" })).toBeNull()
    expect(edit({ imageUrl: IMG, provider: "nano-banana-edit", prompt: "x", maskUrl: IMG2 })).toBeNull()
    // An upscaler's node has no prompt; a prompt edit's node has no upscale factor.
    expect(edit({ imageUrl: IMG, provider: "recraft-upscale", prompt: "sharper" })).toBeNull()
    expect(edit({ imageUrl: IMG, provider: "recraft-remove-bg", seed: 1 })).toBeNull()
    expect(edit({ imageUrl: IMG, provider: "nano-banana-edit", prompt: "x", upscaleFactor: "2" })).toBeNull()
  })
})

describe("image_collage", () => {
  it("wires the images in order and asks for the call's layout", () => {
    const body = { imageUrls: [IMG, IMG2, IMG3], layout: "grid", resolution: "2K", aspectRatio: "16:9", gap: 8, backgroundColor: "#000000", numbered: true, badgePosition: "top-right" }
    const spec = nodeOf("/v1/image-collage", "image_collage", body)
    expect(spec.inputs.map((i) => [i.url, i.targetHandle])).toEqual([[IMG, "in"], [IMG2, "in"], [IMG3, "in"]])
    const { payload } = run(spec, { imageUrls: body.imageUrls })
    expect(payload).toMatchObject({
      imageUrls: body.imageUrls, layout: "grid", resolution: "2K", aspectRatio: "16:9", gap: 8,
      backgroundColor: "#000000", numbered: true, badgePosition: "top-right",
    })
  })

  it("keeps the route's defaults where the call left them out, price included", () => {
    const spec = nodeOf("/v1/image-collage", "image_collage", { imageUrls: [IMG, IMG2] })
    const { payload, modelIdentifier } = run(spec, { imageUrls: [IMG, IMG2] })
    expect(payload).toMatchObject({ layout: "smart", resolution: "4K", aspectRatio: "4:3", gap: 24, backgroundColor: "#ffffff" })
    expect(payload).not.toHaveProperty("numbered")
    expect(modelIdentifier).toContain("4K")
  })

  it("maps no node for size hints, captions or a repeated image", () => {
    const collage = (body: Record<string, unknown>) => flowNodeFor("/v1/image-collage", { ...TRANSPORT, ...body }, "image_collage")
    expect(collage({ imageUrls: [IMG, IMG2], imageSizes: [1, 0] })).toBeNull()
    expect(collage({ imageUrls: [IMG, IMG2], imageLabels: ["Wide", null] })).toBeNull()
    expect(collage({ imageUrls: [IMG, IMG] })).toBeNull()
  })
})

describe("image_overlay", () => {
  const layers = [
    { kind: "image", imageUrl: IMG2, anchor: "bottom-right", x: -4, y: -6, width: 12, opacity: 0.8, shadow: { blur: 4, offsetX: 1, offsetY: 2, color: "#000000", opacity: 0.5 } },
    { kind: "text", text: { content: "SALE", fontId: "inter", fontSize: 8, color: "#ffffff" } },
    { kind: "image", imageUrl: IMG3, anchor: "top-left" },
  ]

  it("wires the base and each image layer on its own layer handle, the settings in the node", () => {
    const body = { imageUrl: IMG, layers, canvas: { width: 1280, height: 720 }, outputFormat: "jpg", variants: ["youtube-thumbnail"], maskMode: "none" }
    const spec = nodeOf("/v1/image-overlay", "image_overlay", body)
    expect(spec.inputs.map((i) => [i.url, i.targetHandle])).toEqual([[IMG, "image"], [IMG2, "overlay"], [IMG3, "overlay3"]])
    const { payload } = run(spec, { imageUrl: IMG, overlayImageUrls: [IMG2, undefined, IMG3] })
    const sent = payload.layers as Array<Record<string, unknown>>
    expect(sent).toHaveLength(3)
    expect(sent[0]).toMatchObject({ kind: "image", imageUrl: IMG2, anchor: "bottom-right", x: -4, y: -6, width: 12, opacity: 0.8, shadow: layers[0].shadow })
    expect(sent[1]).toMatchObject({ kind: "text", text: layers[1].text })
    // The route's layer defaults, which only its Zod would otherwise apply.
    expect(sent[2]).toMatchObject({ kind: "image", imageUrl: IMG3, anchor: "top-left", x: 0, y: 0, width: 25, opacity: 1, rotation: 0, blend: "over", fit: "contain" })
    expect(payload).toMatchObject({
      imageUrl: IMG, canvas: { width: 1280, height: 720, backgroundColor: "#000000" }, baseFit: "contain",
      outputFormat: "jpg", variants: ["youtube-thumbnail"], maskMode: "none", maskSpread: 48,
    })
  })

  it("maps no node for a QR link from the handle, or an image layer with no picture", () => {
    const overlay = (body: Record<string, unknown>) => flowNodeFor("/v1/image-overlay", { ...TRANSPORT, ...body }, "image_overlay")
    expect(overlay({ imageUrl: IMG, layers: [{ kind: "qr", qr: { fromInput: true } }], qrText: "https://x.y" })).toBeNull()
    expect(overlay({ imageUrl: IMG, layers: [{ kind: "image" }] })).toBeNull()
  })
})

describe("extract_frame", () => {
  it("re-runs the frame the call picked", () => {
    const spec = nodeOf("/v1/extract-frame", "extract_frame", { videoUrl: VID, mode: "timestamp", timestamp: 3.5 })
    expect(spec.outputKey).toBe("generatedImageUrl")
    const { payload } = run(spec, { videoUrl: VID })
    expect(payload).toMatchObject({ videoUrl: VID, mode: "timestamp", timestamp: 3.5 })
  })

  it("takes the first frame when the call names none", () => {
    const { payload } = run(nodeOf("/v1/extract-frame", "extract_frame", { videoUrl: VID, mode: "last" }), { videoUrl: VID })
    expect(payload.mode).toBe("last")
  })
})

describe("mask_composite", () => {
  it("wires foreground, background and mask, and asks for the call's settings", () => {
    const body = { foregroundUrl: VID, backgroundUrl: BG, maskUrl: MASK, invertMask: true, feather: 6, grow: -3, backgroundFit: "contain", audioSource: "mix" }
    const spec = nodeOf("/v1/mask-composite", "mask_composite", body)
    expect(spec.outputKey).toBe("generatedVideoUrl")
    expect(spec.inputs.map((i) => [i.url, i.targetHandle])).toEqual([[VID, "video"], [BG, "background-video"], [MASK, "mask-video"]])
    const { payload } = run(spec, { videoUrl: VID, backgroundVideoUrl: BG, maskUrl: MASK })
    expect(payload).toMatchObject({
      foregroundUrl: VID, backgroundUrl: BG, maskUrl: MASK, invertMask: true, feather: 6, grow: -3,
      fill: "video", backgroundFit: "contain", audioSource: "mix",
    })
  })

  it("a pixelate fill wires no foreground and sends none", () => {
    const spec = nodeOf("/v1/mask-composite", "mask_composite", { backgroundUrl: BG, maskUrl: MASK, fill: "pixelate", pixelSizePct: 3 })
    expect(spec.inputs.map((i) => i.targetHandle)).toEqual(["background-video", "mask-video"])
    const { payload } = run(spec, { backgroundVideoUrl: BG, maskUrl: MASK })
    expect(payload).not.toHaveProperty("foregroundUrl")
    expect(payload).toMatchObject({ backgroundUrl: BG, maskUrl: MASK, fill: "pixelate", pixelSizePct: 3 })
  })
})

describe("generate_mask", () => {
  it("is not a node: its result is a mask the conversation node could not show", () => {
    expect(flowNodeFor("/v1/generate-mask", { ...TRANSPORT, imageUrl: IMG, prompt: "the person" }, "generate_mask")).toBeNull()
  })
})
