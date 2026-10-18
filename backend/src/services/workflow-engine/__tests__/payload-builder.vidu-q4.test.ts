/**
 * Vidu Q4 in the DAG payload builder.
 *
 * - Its catalog `resolutions` are ascending (540p first) while it renders and
 *   bills 720p by default, so an untouched node must be filled with the
 *   DECLARED 720p default and 5s — never index 0.
 * - It has no text-to-video mode: a run with nothing wired fails with the
 *   image-required message before any jobs row exists.
 * - Its reference endpoint needs a prompt and an image: an empty prompt (or
 *   reference audio with no image) is refused HERE, before the reservation,
 *   rather than by the provider after it.
 */
import { describe, it, expect } from "vitest"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

const JOB_ID = "job-vidu-1"
const START = "https://cdn.example/start.png"

function n(type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id: "vidu-1", type, data: { provider: "vidu-q4", prompt: "the astronaut waves", ...data } }
}

function build(node: SimpleNode, inputs: ResolvedInputs = {}) {
  return buildPayload(node, JOB_ID, inputs, undefined, { nodes: [node], edges: [], nodeStates: {} })
}

describe("Vidu Q4 payload-builder", () => {
  it("generate-video with a start frame runs image-to-video at the declared 5s / 720p defaults", () => {
    const r = build(n("generate-video"), { startFrameUrl: START })
    expect(r.jobName).toBe("image-to-video")
    expect(r.payload.provider).toBe("vidu-q4")
    expect(r.payload.resolution).toBe("720p")
    expect(r.modelIdentifier).toBe("vidu-q4:5s:720p")
    expect(r.modelIdentifier).toBe(buildVideoCreditModelIdentifier("vidu-q4", undefined, undefined, "image-to-video"))
  })

  it("an explicit node value wins, and an uppercase 4K bills the 4k row", () => {
    const r = build(n("generate-video", { resolution: "4K", duration: 12 }), { startFrameUrl: START })
    expect(r.payload.resolution).toBe("4k")
    expect(r.modelIdentifier).toBe("vidu-q4:12s:4k")
  })

  it("a start frame plus references stays one job on the same ladder (no -ref dimension)", () => {
    const r = build(n("generate-video", { resolution: "1080p", duration: 6 }), {
      startFrameUrl: START,
      referenceImageUrls: ["https://cdn.example/r1.png"],
      referenceAudioUrls: ["https://cdn.example/voice.mp3"],
    })
    expect(r.jobName).toBe("image-to-video")
    expect(r.payload.imageUrl).toBe(START)
    expect(r.payload.referenceImageUrls).toEqual(["https://cdn.example/r1.png"])
    expect(r.payload.referenceAudioUrls).toEqual(["https://cdn.example/voice.mp3"])
    expect(r.modelIdentifier).toBe("vidu-q4:6s:1080p")
  })

  it("nothing wired is the image-required refusal (no text-to-video mode)", () => {
    expect(() => build(n("generate-video"))).toThrow(/image|frame/i)
  })

  it("references with an EMPTY prompt are refused before any job exists", () => {
    expect(() =>
      build(n("generate-video", { prompt: "" }), {
        startFrameUrl: START,
        referenceImageUrls: ["https://cdn.example/r1.png"],
      }),
    ).toThrow(/needs a prompt/)
  })

  it("a frame-only run with an empty prompt is legal (the prompt is optional there)", () => {
    const r = build(n("generate-video", { prompt: "" }), { startFrameUrl: START })
    expect(r.jobName).toBe("image-to-video")
  })

  it("reference audio with no image anywhere is refused", () => {
    expect(() =>
      build(n("image-to-video"), { referenceAudioUrls: ["https://cdn.example/voice.mp3"] }),
    ).toThrow(/needs a start frame or at least one reference image/)
  })
})
