/**
 * The editor quotes a Video Overlay with a video layer at the base length the
 * graph gives — the reading the server's run estimate uses — and at the 60 s
 * cap when the graph gives none. It never falls back to a length the upstream
 * node merely stores (an upload's earlier file), which the server does not
 * read: a quote is never below the run, and the same on every path.
 */
import { describe, it, expect } from "vitest"
import { VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC } from "@nodaro/render-rules"
import { videoOverlayPricingUnits, videoOverlayQuotedSec, videoOverlayWireBaseSec } from "@/lib/video-utility-estimate"
import { videoOverlayLengthWarning } from "@/lib/video-overlay-limits"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const overlay = { id: "x", type: "video-overlay", position: { x: 0, y: 0 }, data: { label: "x", layers: [{ videoUrl: "https://m.test/c.mp4", start: 0 }] } } as unknown as WorkflowNode
const upload = (data: Record<string, unknown>) => ({ id: "b", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "b", ...data } }) as unknown as WorkflowNode
const edges = [{ id: "e", source: "b", target: "x", targetHandle: "video" }] as WorkflowEdge[]

describe("the editor's Video Overlay base length", () => {
  it("an upload's own recorded length for its current file: priced by it", () => {
    const nodes = [overlay, upload({ url: "https://m.test/b.mp4", duration: 23 })]
    expect(videoOverlayQuotedSec(overlay, nodes, edges)).toBe(23)
    expect(videoOverlayPricingUnits(overlay, nodes, edges)).toBe(5)
  })

  it("an upload whose current url matches no saved result, with a stale stored length: the cap, as the server quotes it", () => {
    const nodes = [overlay, upload({ url: "https://m.test/new.mp4", videoDurationSec: 10, generatedResults: [{ url: "https://m.test/old.mp4", duration: 10 }] })]
    expect(videoOverlayQuotedSec(overlay, nodes, edges)).toBeNull()
    expect(videoOverlayPricingUnits(overlay, nodes, edges)).toBe(12)
  })
})

describe("the panel's base length (videoOverlayWireBaseSec): the quote's own reading, before the cap", () => {
  const layers = [{ videoUrl: "https://m.test/c.mp4", start: 0 }]
  const base = (node: Record<string, unknown>) => [overlay, { position: { x: 0, y: 0 }, ...node, id: "b" } as unknown as WorkflowNode]

  it("a generation the overlay's run makes: its planned length plus the slack, which the price ignores", () => {
    const nodes = base({ type: "generate-video", data: { label: "b", provider: "kling-4", duration: 10 } })
    expect(videoOverlayWireBaseSec(overlay, nodes, edges)).toBeCloseTo(10 + VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC, 9)
    expect(videoOverlayQuotedSec(overlay, nodes, edges)).toBeCloseTo(10 + VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC, 9)
  })

  it("a planned 60 s clip plus the slack is not past the cap: no warning; a 61 s upload is", () => {
    const render = base({ type: "pro-3d-render", data: { label: "b" } })
    const sec = videoOverlayWireBaseSec(overlay, render, edges)
    expect(sec).toBeCloseTo(60 + VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC, 9)
    expect(videoOverlayLengthWarning(layers, sec)).toBeUndefined()
    const long = [overlay, upload({ url: "https://m.test/b.mp4", duration: 61 })]
    expect(videoOverlayWireBaseSec(overlay, long, edges)).toBe(61)
    expect(videoOverlayLengthWarning(layers, 61)).toBeDefined()
  })

  it("a base whose length is not known (a VEO extension): none, so no warning", () => {
    const ext = { id: "ext", type: "extend-video", position: { x: 0, y: 0 }, data: { label: "ext", duration: 5 } } as unknown as WorkflowNode
    const nodes = [overlay, upload({ url: "https://m.test/b.mp4", duration: 10 }), ext]
    const wired = [{ id: "e1", source: "b", target: "ext", targetHandle: "video" }, { id: "e2", source: "ext", target: "x", targetHandle: "video" }] as WorkflowEdge[]
    expect(videoOverlayWireBaseSec(overlay, nodes, wired)).toBeNull()
  })
})
