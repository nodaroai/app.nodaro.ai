/**
 * i2v-only provider guard in the unified `generate-video` payload-builder case.
 *
 * Providers without a t2v mode (VIDEO_PROVIDERS_REQUIRING_IMAGE — kling-3-omni,
 * kling-master, happyhorse-ref2v, …) must fail fast with a clear message when
 * the node dispatches to the text-to-video path (no start-frame image wired),
 * mirroring the /v1/text-to-video route's "image_required" 400 — instead of
 * enqueueing a job that dies at provider lookup. Reference images alone do NOT
 * satisfy the requirement (they're conditioning inputs, not the start frame).
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

function gv(provider: string, data: Record<string, unknown> = {}): SimpleNode {
  return {
    id: "gv-1",
    type: "generate-video",
    data: { provider, prompt: "a cinematic shot", duration: 5, ...data },
  }
}

const JOB_ID = "job-img-required-1"
const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })

describe("generate-video i2v-only provider guard", () => {
  it("throws a clear image-required error for kling-3-omni with no image wired", () => {
    const n = gv("kling-3-omni")
    expect(() => buildPayload(n, JOB_ID, {}, undefined, ctx(n)))
      .toThrow(/kling-3-omni requires an input image/)
  })

  it("reference images alone do not satisfy the start-frame requirement", () => {
    const n = gv("kling-3-omni")
    const inputs: ResolvedInputs = {
      referenceImageUrls: ["https://cdn.example/ref-1.png"],
    }
    expect(() => buildPayload(n, JOB_ID, inputs, undefined, ctx(n)))
      .toThrow(/kling-3-omni requires an input image/)
  })

  it("dispatches kling-3-omni to image-to-video when a start frame is wired (refs forwarded)", () => {
    const n = gv("kling-3-omni")
    const inputs: ResolvedInputs = {
      startFrameUrl: "https://cdn.example/start.png",
      referenceImageUrls: ["https://cdn.example/ref-1.png"],
    }
    const result = buildPayload(n, JOB_ID, inputs, undefined, ctx(n))
    expect(result.jobName).toBe("image-to-video")
    expect(result.payload.imageUrl).toBe("https://cdn.example/start.png")
    expect(result.payload.referenceImageUrls).toEqual(["https://cdn.example/ref-1.png"])
  })

  it("remaps happyhorse-i2v to its t2v twin instead of failing when run without an image", () => {
    const n = gv("happyhorse-i2v")
    const result = buildPayload(n, JOB_ID, {}, undefined, ctx(n))
    expect(result.jobName).toBe("text-to-video")
    expect(result.payload.provider).toBe("happyhorse")
  })

  it("keeps gemini-omni-video on the t2v path with reference images forwarded", () => {
    const n = gv("gemini-omni-video")
    const inputs: ResolvedInputs = {
      referenceImageUrls: ["https://cdn.example/ref-1.png"],
    }
    const result = buildPayload(n, JOB_ID, inputs, undefined, ctx(n))
    expect(result.jobName).toBe("text-to-video")
    expect(result.payload.referenceImageUrls).toEqual(["https://cdn.example/ref-1.png"])
  })
})
