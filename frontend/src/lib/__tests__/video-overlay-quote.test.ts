/**
 * The editor quotes a Video Overlay with a video layer at the base length the
 * graph gives — the reading the server's run estimate uses — and at the 60 s
 * cap when the graph gives none. It never falls back to a length the upstream
 * node merely stores (an upload's earlier file), which the server does not
 * read: a quote is never below the run, and the same on every path.
 */
import { describe, it, expect } from "vitest"
import { videoOverlayPricingUnits, videoOverlayQuotedSec } from "@/lib/video-utility-estimate"
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
