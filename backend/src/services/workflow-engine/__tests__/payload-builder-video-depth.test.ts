/**
 * Payload-builder tests for the `video-depth` node type.
 *
 * Raw workflow JSON (imports, templates, MCP writes, FieldMappings) reaches
 * buildPayload without the route's Zod, so every enum the worker indexes is
 * coerced here rather than trusted: the provider (unknown → the default), the
 * model size (unknown → large) and the colormap (`resolveVideoDepthColormap`:
 * a colormap the provider cannot render → grayscale). Levers a provider does
 * not honour are dropped, never sent. The bucket price row is NOT picked here:
 * node-executor measures the clip and swaps it in (`stampVideoDepthInput`).
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

const CLIP = "https://cdn.example.com/clip.mp4"

const node = (data: Record<string, unknown>): SimpleNode => ({ id: "vd-1", type: "video-depth", data })
const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })
const build = (data: Record<string, unknown>, resolved: { videoUrl?: string } = { videoUrl: CLIP }) => {
  const n = node(data)
  return buildPayload(n, "job-vd-1", resolved, "usage-vd-1", ctx(n))
}

describe("buildPayload — video-depth", () => {
  it("Replicate: keeps provider + size, coerces an unoffered colormap to grayscale, drops the fal-only levers", () => {
    const r = build({
      provider: "depth-anything-frames",
      modelSize: "small",
      colormap: "turbo",
      resolution: "720p",
      sideBySide: true,
      outputFps: 24,
    })
    expect(r.jobName).toBe("video-depth")
    expect(r.queueName).toBe("video-generation")
    expect(r.modelIdentifier).toBe("depth-anything-frames")
    expect(r.payload).toEqual({
      jobId: "job-vd-1",
      videoUrl: CLIP,
      provider: "depth-anything-frames",
      modelSize: "small",
      colormap: "grayscale",
      usageLogId: "usage-vd-1",
    })
  })

  it("Replicate keeps inferno, its other native colormap", () => {
    expect(build({ provider: "depth-anything-frames", colormap: "inferno" }).payload.colormap).toBe("inferno")
  })

  it("fal (the default when no provider is set): every lever passes, colormap as requested", () => {
    const r = build({ modelSize: "base", colormap: "turbo", resolution: "720p", sideBySide: true })
    expect(r.modelIdentifier).toBe("video-depth-anything")
    expect(r.payload).toMatchObject({
      provider: "video-depth-anything",
      modelSize: "base",
      colormap: "turbo",
      resolution: "720p",
      sideBySide: true,
    })
  })

  it("never sends a legacy outputFps a saved node still carries (the lever was removed)", () => {
    expect(build({ outputFps: 24 }).payload).not.toHaveProperty("outputFps")
  })

  it("fal with no levers set: grayscale, large, nothing optional sent", () => {
    const r = build({})
    expect(r.payload).toEqual({
      jobId: "job-vd-1",
      videoUrl: CLIP,
      provider: "video-depth-anything",
      modelSize: "large",
      colormap: "grayscale",
      usageLogId: "usage-vd-1",
    })
  })

  it("coerces an unknown provider to the default and an unknown model size to large", () => {
    const r = build({ provider: "nope", modelSize: "huge", colormap: "nope" })
    expect(r.modelIdentifier).toBe("video-depth-anything")
    expect(r.payload).toMatchObject({ provider: "video-depth-anything", modelSize: "large", colormap: "grayscale" })
  })

  it("drops fal lever values the route would reject (resolution outside the enum, a non-boolean side-by-side)", () => {
    for (const bad of [{ resolution: "4k" }, { sideBySide: "yes" }]) {
      const p = build(bad).payload
      expect(p.resolution, JSON.stringify(bad)).toBeUndefined()
      expect(p.sideBySide, JSON.stringify(bad)).toBeUndefined()
    }
  })

  it("falls back to the node's own videoUrl when nothing is wired", () => {
    expect(build({ videoUrl: "https://cdn.example.com/own.mp4" }, {}).payload.videoUrl).toBe("https://cdn.example.com/own.mp4")
  })

  it("refuses with video_required when no video is wired or set", () => {
    try {
      build({}, {})
      expect.unreachable("buildPayload should refuse a video-depth node with no video")
    } catch (e) {
      expect((e as { code?: string }).code).toBe("video_required")
    }
  })
})
