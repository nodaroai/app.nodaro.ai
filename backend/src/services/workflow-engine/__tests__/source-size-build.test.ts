import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The workflow run's build with the photo's size. Generate Image's photo is
 * the first image its build sends, so that one case builds once to find it and
 * again with its size; every other node builds exactly once. The builder and
 * the size read are the seams; the photo selection (`source-image.ts`,
 * `imageJobPhotoUrl`) is real.
 */

const { mockBuildPayload, mockProbe } = vi.hoisted(() => ({
  mockBuildPayload: vi.fn(),
  mockProbe: vi.fn(),
}))
vi.mock("../payload-builder.js", () => ({ buildPayload: mockBuildPayload }))
vi.mock("@/lib/image-source-size.js", () => ({ probeImageDisplaySize: mockProbe }))

import { buildPayloadWithSourceSize } from "../source-size-build.js"
import type { SimpleNode } from "../types.js"
import { FLUX_LORA_CHARACTER_MODEL_ID, MODEL_CATALOG, T2I_TO_I2I_VARIANT } from "@nodaro/shared"

const PHOTO = "https://cdn.example.com/photo.png"
const BASE = "https://cdn.example.com/base.png"
const SIZE = { width: 1920, height: 1080 }

const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: "n1", type, data: { prompt: "x", ...data } })
const built = (payload: Record<string, unknown>) => ({ jobName: "generate-image", queueName: "video-generation", modelIdentifier: "m", payload: { jobId: "job-1", ...payload } })
const ctxOf = (call: number) => (mockBuildPayload.mock.calls[call] as unknown[])[4] as { sourceImage?: unknown }

beforeEach(() => {
  vi.clearAllMocks()
  mockProbe.mockResolvedValue(SIZE)
})

describe("buildPayloadWithSourceSize", () => {
  it("a source-image node: reads its image before the build and builds once with the size", async () => {
    mockBuildPayload.mockReturnValue(built({ imageUrl: PHOTO }))
    await buildPayloadWithSourceSize(node("image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "auto" }), "job-1", { imageUrl: PHOTO }, undefined, {})
    expect(mockProbe).toHaveBeenCalledWith(PHOTO)
    expect(mockBuildPayload).toHaveBeenCalledTimes(1)
    expect(ctxOf(0).sourceImage).toEqual(SIZE)
  })

  it("Generate Image with a photo: builds once to find it, reads it, and builds again with its size", async () => {
    mockBuildPayload.mockReturnValueOnce(built({ referenceImageUrls: [PHOTO] })).mockReturnValueOnce(built({ referenceImageUrls: [PHOTO], aspectRatio: "16:9" }))
    const result = await buildPayloadWithSourceSize(node("generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" }), "job-1", {}, undefined, {})
    expect(mockBuildPayload).toHaveBeenCalledTimes(2)
    expect(ctxOf(0).sourceImage).toBeUndefined()
    expect(mockProbe).toHaveBeenCalledWith(PHOTO)
    expect(ctxOf(1).sourceImage).toEqual(SIZE)
    expect(result.payload.aspectRatio).toBe("16:9")
  })

  it("Generate Image: the inpaint / refine base is the photo, ahead of the references", async () => {
    mockBuildPayload.mockReturnValue(built({ baseImageUrl: BASE, referenceImageUrls: [PHOTO] }))
    await buildPayloadWithSourceSize(node("generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" }), "job-1", {}, undefined, {})
    expect(mockProbe).toHaveBeenCalledWith(BASE)
  })

  // A LoRA run hands the trained character model a base image but takes no
  // "auto" from it (the route never reads a size for LoRA either): the first
  // build is the build that runs, and nothing is read.
  it("Generate Image swapped to the character LoRA model: reads nothing, builds once", async () => {
    const first = built({ model: FLUX_LORA_CHARACTER_MODEL_ID, baseImageUrl: BASE, referenceImageUrls: [] })
    mockBuildPayload.mockReturnValue(first)
    const result = await buildPayloadWithSourceSize(node("generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" }), "job-1", {}, undefined, {})
    expect(mockProbe).not.toHaveBeenCalled()
    expect(mockBuildPayload).toHaveBeenCalledTimes(1)
    expect(result).toBe(first)
  })

  // With references attached the build snaps against the model's image-to-image
  // sibling, so whether the photo's size matters is asked about that model, with
  // the references the build actually assembled.
  it("Generate Image whose references swap it to a sibling with no ratio lever (grok): reads nothing, builds once", async () => {
    const first = built({ provider: "grok", model: "grok-i2i", referenceImageUrls: [PHOTO] })
    mockBuildPayload.mockReturnValue(first)
    const result = await buildPayloadWithSourceSize(node("generate-image", { provider: "grok", aspectRatio: "auto" }), "job-1", {}, undefined, {})
    expect(mockProbe).not.toHaveBeenCalled()
    expect(mockBuildPayload).toHaveBeenCalledTimes(1)
    expect(result).toBe(first)
  })

  it("Generate Image on grok with only a base (nothing swaps): reads the base", async () => {
    mockBuildPayload.mockReturnValue(built({ provider: "grok", baseImageUrl: BASE, referenceImageUrls: [] }))
    await buildPayloadWithSourceSize(node("generate-image", { provider: "grok", aspectRatio: "auto" }), "job-1", {}, undefined, {})
    expect(mockProbe).toHaveBeenCalledWith(BASE)
  })

  it("Generate Image on a model with a native auto whose sibling has none: reads the photo once references attach", async () => {
    // Not in today's catalog — a made-up pair, registered for this test only.
    const base = MODEL_CATALOG["seedream-5-pro"]!
    MODEL_CATALOG["pair-probe"] = { ...base, label: "Pair probe", aspectRatios: ["auto", "1:1", "16:9"] }
    MODEL_CATALOG["pair-probe-i2i"] = { ...base, label: "Pair probe edit", aspectRatios: ["1:1", "16:9"] }
    T2I_TO_I2I_VARIANT["pair-probe"] = "pair-probe-i2i"
    try {
      const pairNode = node("generate-image", { provider: "pair-probe", aspectRatio: "auto" })
      mockBuildPayload.mockReturnValue(built({ provider: "pair-probe", model: "pair-probe-i2i", referenceImageUrls: [PHOTO] }))
      await buildPayloadWithSourceSize(pairNode, "job-1", {}, undefined, {})
      expect(mockProbe).toHaveBeenCalledWith(PHOTO)
      expect(mockBuildPayload).toHaveBeenCalledTimes(2)
      expect(ctxOf(1).sourceImage).toEqual(SIZE)

      vi.clearAllMocks()
      const noRefs = built({ provider: "pair-probe", referenceImageUrls: [] })
      mockBuildPayload.mockReturnValue(noRefs)
      expect(await buildPayloadWithSourceSize(pairNode, "job-1", {}, undefined, {})).toBe(noRefs)
      expect(mockProbe).not.toHaveBeenCalled()
    } finally {
      delete MODEL_CATALOG["pair-probe"]
      delete MODEL_CATALOG["pair-probe-i2i"]
      delete T2I_TO_I2I_VARIANT["pair-probe"]
    }
  })

  it("Generate Image whose photo cannot be read: the build already made is the one that runs", async () => {
    mockProbe.mockResolvedValue(undefined)
    const first = built({ referenceImageUrls: [PHOTO], aspectRatio: "1:1" })
    mockBuildPayload.mockReturnValue(first)
    const result = await buildPayloadWithSourceSize(node("generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" }), "job-1", {}, undefined, {})
    expect(mockBuildPayload).toHaveBeenCalledTimes(1)
    expect(result).toBe(first)
  })

  it("Generate Image with no photo: one build, nothing read", async () => {
    mockBuildPayload.mockReturnValue(built({ referenceImageUrls: [] }))
    await buildPayloadWithSourceSize(node("generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" }), "job-1", {}, undefined, {})
    expect(mockBuildPayload).toHaveBeenCalledTimes(1)
    expect(mockProbe).not.toHaveBeenCalled()
  })

  it("a node that would not use the size: one build, nothing read", async () => {
    mockBuildPayload.mockReturnValue(built({ referenceImageUrls: [PHOTO] }))
    const unused: Array<[string, Record<string, unknown>]> = [
      ["generate-image", { provider: "gpt-image-2", aspectRatio: "auto" }],
      ["generate-image", { provider: "seedream-5-pro", aspectRatio: "16:9" }],
      ["image-to-image", { provider: "gpt-image-2-i2i", aspectRatio: "auto" }],
      ["text-to-audio", { provider: "elevenlabs-sfx" }],
    ]
    for (const [type, data] of unused) {
      vi.clearAllMocks()
      await buildPayloadWithSourceSize(node(type, data), "job-1", { imageUrl: PHOTO }, undefined, {})
      expect(mockBuildPayload, `${type} ${JSON.stringify(data)}`).toHaveBeenCalledTimes(1)
      expect(mockProbe, `${type} ${JSON.stringify(data)}`).not.toHaveBeenCalled()
      expect(ctxOf(0).sourceImage).toBeUndefined()
    }
  })

  it("a build that throws on the first pass propagates (the caller deletes its placeholder row)", async () => {
    mockBuildPayload.mockImplementation(() => { throw new Error("image_required") })
    await expect(
      buildPayloadWithSourceSize(node("generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" }), "job-1", {}, undefined, {}),
    ).rejects.toThrow("image_required")
  })
})
