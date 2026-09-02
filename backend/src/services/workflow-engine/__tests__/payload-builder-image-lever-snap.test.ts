import { describe, it, expect, vi, afterEach } from "vitest"
import { buildCreditModelIdentifier } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

/**
 * Last-mile catalog snap on the DAG image branches.
 *
 * `resolveImageGenCreditIdentifier` prices off the SNAPPED levers (the snap
 * lives inside the credit primitive — see credit-identifiers.ts). So a branch
 * that hands it RAW `data.resolution` / `data.quality` and then ALSO puts those
 * raw values in the queue payload reserves one tier and renders another, with
 * no upward true-up to correct it. `generate-image` and `image-to-image`
 * already normalize first and send the snapped pair; these tests pin the same
 * invariant for `modify-image` and `edit-image`:
 *
 *   the lever in the payload === the lever the identifier was priced on.
 *
 * They also pin that a catalog-VALID node is byte-identical to the pre-snap
 * behaviour, so the guard can never become a silent rewrite.
 */

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

const jobId = "job-1"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("buildPayload — modify-image lever snap", () => {
  it("snaps a quality the model does not accept, and pays for the snapped one", () => {
    // gpt-image declares qualities ["medium", "high"] and ratios 1:1/3:2/2:3.
    const result = buildPayload(
      node("m1", "modify-image", { prompt: "x", provider: "gpt-image", aspectRatio: "16:9", quality: "basic" }),
      jobId,
      { imageUrl: "https://r2.nodaro.ai/in.png" },
    )
    expect(result.payload.quality).toBe("medium")
    expect(result.payload.aspectRatio).toBe("1:1")
    // "medium" is the base tier -> no composite. The payload says medium too.
    expect(result.modelIdentifier).toBe("gpt-image")
  })

  it("keeps a declared quality and its composite price (payload === priced lever)", () => {
    const result = buildPayload(
      node("m2", "modify-image", { prompt: "x", provider: "gpt-image", quality: "high" }),
      jobId,
      { imageUrl: "https://r2.nodaro.ai/in.png" },
    )
    expect(result.payload.quality).toBe("high")
    expect(result.modelIdentifier).toBe("gpt-image:high")
  })

  it("drops a resolution the model does not have instead of forwarding it", () => {
    // nano-banana has no resolution lever at all.
    const result = buildPayload(
      node("m3", "modify-image", { prompt: "x", provider: "nano-banana", resolution: "2K" }),
      jobId,
      { imageUrl: "https://r2.nodaro.ai/in.png" },
    )
    expect(result.payload.resolution).toBeUndefined()
    expect(result.modelIdentifier).toBe("nano-banana")
  })

  it("leaves a catalog-valid node's levers byte-identical", () => {
    const result = buildPayload(
      node("m4", "modify-image", { prompt: "x", provider: "nano-banana-pro", aspectRatio: "16:9", resolution: "4K" }),
      jobId,
      { imageUrl: "https://r2.nodaro.ai/in.png" },
    )
    expect(result.payload.aspectRatio).toBe("16:9")
    expect(result.payload.resolution).toBe("4K")
    expect(result.modelIdentifier).toBe("nano-banana-pro:4K")
  })

  it("snaps the nano-banana-edit sub-branch's ratio too (same case, other arm)", () => {
    const result = buildPayload(
      node("m5", "modify-image", { prompt: "x", provider: "nano-banana-edit", aspectRatio: "8:1" }),
      jobId,
      { imageUrl: "https://r2.nodaro.ai/in.png" },
    )
    // 8:1 is off-list for nano-banana-edit -> snapped to its first ratio.
    expect(result.payload.aspectRatio).toBe("1:1")
    expect(result.jobName).toBe("edit-image")
  })
})

describe("buildPayload — edit-image lever snap", () => {
  it("drops a ratio the upscalers do not have, leaving the price untouched", () => {
    const result = buildPayload(
      node("e1", "edit-image", { provider: "recraft-upscale", aspectRatio: "16:9", targetResolution: "4K" }),
      jobId,
      { imageUrl: "https://r2.nodaro.ai/in.png" },
    )
    expect(result.payload.aspectRatio).toBeUndefined()
    // `targetResolution` is the pricing lever here and is NOT a catalog
    // `resolutions` value — the snap must not touch it.
    expect(result.payload.targetResolution).toBe("4K")
    expect(result.modelIdentifier).toBe(
      buildCreditModelIdentifier("recraft-upscale", undefined, undefined, undefined, "4K"),
    )
    expect(result.modelIdentifier).toBe("recraft-upscale")
  })

  it("keeps a ratio nano-banana-edit declares", () => {
    const result = buildPayload(
      node("e2", "edit-image", { provider: "nano-banana-edit", prompt: "make it night", aspectRatio: "21:9" }),
      jobId,
      { imageUrl: "https://r2.nodaro.ai/in.png" },
    )
    expect(result.payload.aspectRatio).toBe("21:9")
    expect(result.modelIdentifier).toBe("nano-banana-edit")
  })
})
