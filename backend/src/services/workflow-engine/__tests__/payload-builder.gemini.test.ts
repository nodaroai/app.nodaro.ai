/**
 * Gemini Omni Video dispatch in the unified `generate-video` payload-builder case.
 *
 * Tests:
 * 1. A connected source video (referenceVideoUrls) routes through the
 *    image-to-video worker path (effectiveMode = "image-to-video").
 * 2. videoTrimStart / videoTrimEnd are threaded into the payload.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function gv(provider: string, data: Record<string, unknown> = {}): SimpleNode {
  return node("gv-1", "generate-video", {
    provider,
    prompt: "edit this video to look cinematic",
    duration: 8,
    ...data,
  })
}

const JOB_ID = "job-gemini-1"

describe("Gemini Omni Video dispatch in generate-video", () => {
  it("routes through image-to-video path when a reference video is connected", () => {
    const n = gv("gemini-omni-video")
    const inputs: ResolvedInputs = {
      referenceVideoUrls: ["https://cdn.example/source.mp4"],
    }
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.jobName).toBe("image-to-video")
  })

  it("threads videoTrimStart and videoTrimEnd into the payload", () => {
    const n = gv("gemini-omni-video", { videoTrimStart: 1, videoTrimEnd: 9 })
    const inputs: ResolvedInputs = {
      referenceVideoUrls: ["https://cdn.example/source.mp4"],
    }
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.videoTrimStart).toBe(1)
    expect(result.payload.videoTrimEnd).toBe(9)
  })

  it("uses text-to-video path when no reference video is connected (normal T2V)", () => {
    const n = gv("gemini-omni-video")
    const inputs: ResolvedInputs = {}
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.jobName).toBe("text-to-video")
    // No trim fields on the node → absent in payload
    expect(result.payload.videoTrimStart).toBeUndefined()
    expect(result.payload.videoTrimEnd).toBeUndefined()
  })

  it("non-gemini provider with video ref uses text-to-video path (no effectiveMode override)", () => {
    // e.g. kling with a referenceVideoUrl should NOT be forced to image-to-video
    // unless it also has a start frame — the effectiveMode only diverges for gemini.
    const n = gv("kling")
    const inputs: ResolvedInputs = {
      referenceVideoUrls: ["https://cdn.example/ref.mp4"],
    }
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    // No startFrame → mode = text-to-video, effectiveMode stays text-to-video
    expect(result.jobName).toBe("text-to-video")
  })

  it("includes referenceVideoUrls in the payload", () => {
    const n = gv("gemini-omni-video")
    const inputs: ResolvedInputs = {
      referenceVideoUrls: ["https://cdn.example/source.mp4"],
    }
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.referenceVideoUrls).toEqual(["https://cdn.example/source.mp4"])
  })
})
