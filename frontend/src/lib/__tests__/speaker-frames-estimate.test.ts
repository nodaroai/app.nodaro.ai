/**
 * The editor prices Speaker Frames through the one shared rule
 * (`speakerFramesEstimateBlocks`, `@nodaro/render-rules`) the server's run
 * quote, precheck and listing read (P3.7, decided 2026-10-16): the pill, the
 * Run button and the run-start check quote a video wired instead of an edit at
 * its recorded length, and the 130-block ceiling only when no length is known.
 */
import { describe, it, expect } from "vitest"
import { getExactPricingUnits, NO_RERUNS, PRICING_UNIT_NODE_TYPES } from "@/components/editor/workflow-editor/types"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const sf = node("sf", "speaker-frames")
const videoIn = [{ id: "e", source: "up", target: "sf", targetHandle: "video" }] as unknown as WorkflowEdge[]

describe("Speaker Frames in the editor's estimate", () => {
  it("is a per-unit node, priced in blocks of 1,000 sampled frames", () => {
    expect(PRICING_UNIT_NODE_TYPES).toContain("speaker-frames")
  })

  it("quotes a video at its recorded length: 14 s → 1 block, 45 min → 6 blocks", () => {
    const short = node("up", "upload-video", { url: "https://m.test/a.mp4", duration: 14 })
    expect(getExactPricingUnits(sf, [short, sf], videoIn, NO_RERUNS)).toBe(1)
    const long = node("up", "upload-video", { url: "https://m.test/a.mp4", duration: 45 * 60 })
    expect(getExactPricingUnits(sf, [long, sf], videoIn, NO_RERUNS)).toBe(6)
  })

  it("quotes an edit an Edit Plan is about to make from its recording's length (decided 2026-10-17)", () => {
    const up = node("up", "upload-video", { url: "https://m.test/a.mp4", metadata: { durationSeconds: 3600 } })
    const tx = node("tx", "transcribe")
    const plan = node("plan", "edit-plan", { mode: "tighten" })
    const edges = [
      { id: "e1", source: "up", sourceHandle: "video", target: "plan", targetHandle: "sources" },
      { id: "e2", source: "up", sourceHandle: "video", target: "tx", targetHandle: "audio" },
      { id: "e3", source: "tx", sourceHandle: "json", target: "plan", targetHandle: "transcript" },
      { id: "e4", source: "plan", sourceHandle: "edl", target: "sf", targetHandle: "edl" },
    ] as unknown as WorkflowEdge[]
    // One hour on one camera, with the 2 s margins: 7,208 frames, 8 blocks — not the 130-block ceiling.
    expect(getExactPricingUnits(sf, [up, tx, plan, sf], edges, new Set(["tx", "plan"]))).toBe(8)
  })

  it("quotes the 130-block ceiling only when no length is known", () => {
    const link = node("up", "upload-video", { url: "https://m.test/a.mp4" })
    expect(getExactPricingUnits(sf, [link, sf], videoIn, NO_RERUNS)).toBe(130)
  })
})
