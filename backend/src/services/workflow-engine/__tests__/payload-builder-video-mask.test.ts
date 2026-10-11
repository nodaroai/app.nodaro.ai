/**
 * Video Mask + Mask Composite payloads on the workflow lane. That lane never
 * meets the routes' Zod, so the builder applies their rules itself: a blank
 * prompt is refused before any reservation and the threshold is held to the
 * model's range; Mask Composite sends exactly the keys its media guard checks.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

const JOB = "job-video-mask"
const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })
const node = (type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id: `${type}-1`, type, data: { label: "My Node", ...data } })
const build = (n: SimpleNode, inputs: ResolvedInputs) => buildPayload(n, JOB, inputs, undefined, ctx(n)) as { jobName: string; modelIdentifier: string; payload: Record<string, unknown> }

describe("video-mask payload", () => {
  it("sends the trimmed wired prompt over the node's, with the default threshold and model", () => {
    const r = build(node("video-mask", { prompt: "the cat" }), { videoUrl: "https://x/c.mp4", prompt: "  the dancer  " })
    expect(r.jobName).toBe("video-mask")
    expect(r.payload).toMatchObject({ videoUrl: "https://x/c.mp4", prompt: "the dancer", threshold: 0.5, provider: "sam-3" })
  })

  it("falls back to the node's own prompt when the wire is blank", () => {
    const r = build(node("video-mask", { prompt: "the cat" }), { videoUrl: "https://x/c.mp4", prompt: "   " })
    expect(r.payload.prompt).toBe("the cat")
  })

  it("refuses a run with no prompt anywhere (before any reservation, like the route's 400)", () => {
    expect(() => build(node("video-mask", { prompt: "  " }), { videoUrl: "https://x/c.mp4" })).toThrow(/no prompt/)
  })

  it("holds a threshold written straight into workflow JSON to the model's range", () => {
    expect(build(node("video-mask", { prompt: "x", threshold: 1 }), { videoUrl: "https://x/c.mp4" }).payload.threshold).toBe(0.95)
    expect(build(node("video-mask", { prompt: "x", threshold: 0 }), { videoUrl: "https://x/c.mp4" }).payload.threshold).toBe(0.05)
    expect(build(node("video-mask", { prompt: "x", threshold: "high" }), { videoUrl: "https://x/c.mp4" }).payload.threshold).toBe(0.5)
  })

  it("refuses a run with no video", () => {
    expect(() => build(node("video-mask", { prompt: "x" }), {})).toThrow()
  })
})

describe("mask-composite payload", () => {
  it("sends the three resolved videos and the normalised settings at the flat row", () => {
    const r = build(node("mask-composite", { feather: 50, audioSource: "mix" }), {
      videoUrl: "https://x/fg.mp4", backgroundVideoUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4",
    })
    expect(r.modelIdentifier).toBe("mask-composite")
    expect(r.payload).toMatchObject({
      foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4",
      invertMask: false, feather: 20, grow: 0, backgroundFit: "cover", audioSource: "mix",
    })
  })

  it("refuses a missing mask, and never passes a guard it then cannot honour", () => {
    expect(() => build(node("mask-composite"), { videoUrl: "https://x/fg.mp4", backgroundVideoUrl: "https://x/bg.mp4" })).toThrow()
    // A node carrying data.maskUrl passes the guard AND reaches the worker with it.
    const r = build(node("mask-composite", { maskUrl: "https://x/m.mp4" }), { videoUrl: "https://x/fg.mp4", backgroundVideoUrl: "https://x/bg.mp4" })
    expect(r.payload.maskUrl).toBe("https://x/m.mp4")
  })
})
