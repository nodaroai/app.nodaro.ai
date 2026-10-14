import { describe, it, expect, vi, afterEach } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { PHOTO_AUTO_ASPECT_NODE_TYPES } from "@nodaro/shared/nodes"
import { buildPayload } from "../payload-builder.js"
import { autoAspectSourceImageUrl, generateImageMayUsePhotoSize } from "../source-image.js"
import type { SimpleNode } from "../types.js"

/**
 * #2009 — on Generate Image and Modify Image an UNSET aspect ratio is Auto: the
 * dropdown shows Auto for it, so the run asks for "auto" too. It used to send
 * nothing, and the provider's own default (16:9 on nearly every model) drew a
 * 3:4 photo as 2752x1536.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

const PHOTO = "https://cdn.example.com/portrait.jpg"
const portrait = { width: 1536, height: 2048 }

function node(type: string, data: Record<string, unknown>): SimpleNode {
  return { id: "n1", type, data: { label: type, prompt: "make it dusk", ...data } }
}

describe("an unset ratio runs as Auto on the photo-Auto nodes", () => {
  it("the photo-Auto nodes are Generate Image and Modify Image", () => {
    expect([...PHOTO_AUTO_ASPECT_NODE_TYPES].sort()).toEqual(["generate-image", "modify-image"])
  })

  it("Modify Image on a model with a native auto sends auto", () => {
    expect(MODEL_CATALOG["nano-banana-2-1"]!.aspectRatios).toContain("auto")
    const r = buildPayload(node("modify-image", { provider: "nano-banana-2-1" }), "job-1", { imageUrl: PHOTO })
    expect(r.payload.aspectRatio).toBe("auto")
  })

  it("Modify Image on a model without one keeps the photo's shape", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const provider = "seedream-5-pro-i2i"
    expect(MODEL_CATALOG[provider]!.aspectRatios).not.toContain("auto")
    const n = node("modify-image", { provider })
    // The run reads the photo's size for it, as for a chosen Auto.
    expect(autoAspectSourceImageUrl(n, { imageUrl: PHOTO })).toBe(PHOTO)
    const r = buildPayload(n, "job-1", { imageUrl: PHOTO }, undefined, { sourceImage: portrait })
    expect(r.payload.aspectRatio).toBe("3:4")
  })

  it("the nano-banana-edit arm of Modify Image asks for auto too", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const n = node("modify-image", { provider: "nano-banana-edit" })
    const r = buildPayload(n, "job-1", { imageUrl: PHOTO }, undefined, { sourceImage: portrait })
    expect(r.jobName).toBe("edit-image")
    expect(r.payload.aspectRatio).toBe("3:4")
  })

  it("Generate Image with no ratio sends auto on a model that lists it", () => {
    const r = buildPayload(node("generate-image", { provider: "nano-banana-2-1" }), "job-1", {})
    expect(r.payload.aspectRatio).toBe("auto")
  })

  it("Generate Image with no ratio and no photo sends the ratio its dropdown shows for Auto without one", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const provider = "nano-banana-2"
    const r = buildPayload(node("generate-image", { provider }), "job-1", {})
    expect(r.payload.aspectRatio).toBe(MODEL_CATALOG[provider]!.aspectRatios![0])
    expect(generateImageMayUsePhotoSize(node("generate-image", { provider }))).toBe(true)
  })

  it("a chosen ratio is sent as chosen", () => {
    const r = buildPayload(node("modify-image", { provider: "nano-banana-2-1", aspectRatio: "9:16" }), "job-1", { imageUrl: PHOTO })
    expect(r.payload.aspectRatio).toBe("9:16")
  })

  it("other image nodes keep an unset ratio unset", () => {
    const r = buildPayload(node("image-to-image", { provider: "nano-banana-2-1" }), "job-1", { imageUrl: PHOTO })
    expect(r.payload.aspectRatio).toBeUndefined()
  })
})
