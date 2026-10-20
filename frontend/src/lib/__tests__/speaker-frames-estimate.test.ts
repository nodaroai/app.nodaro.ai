/**
 * The editor prices Speaker Frames through the one shared rule
 * (`speakerFramesEstimateBlocks`, `@nodaro/render-rules`) the server's run
 * quote, precheck and listing read (P3.7, decided 2026-10-16): the pill, the
 * Run button and the run-start check quote a video wired instead of an edit at
 * its recorded length; a length not known before the run is 180 minutes on
 * each camera the run will frame (decided 2026-10-20), and the 130-block
 * ceiling only when the cameras cannot be counted either.
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

  it("quotes a video of unknown length at 180 minutes on its one camera: 22 blocks (decided 2026-10-20)", () => {
    const link = node("up", "upload-video", { url: "https://m.test/a.mp4" })
    expect(getExactPricingUnits(sf, [link, sf], videoIn, NO_RERUNS)).toBe(22)
  })

  it("quotes an edit of unknown length at 180 minutes on each camera the plan reads: 3 cameras → 65 blocks", () => {
    const cams = ["c1", "c2", "c3"].map((id) => node(id, "upload-video", { url: `https://m.test/${id}.mp4` }))
    const mic = node("mic", "upload-audio", { url: "https://m.test/mic.wav" })
    const tx = node("tx", "transcribe")
    const plan = node("plan", "edit-plan", { mode: "tighten", sourceConfig: { mic: { role: "master-audio" } } })
    const edges = [
      ...cams.map((c, i) => ({ id: `s${i}`, source: c.id, sourceHandle: "video", target: "plan", targetHandle: "sources" })),
      { id: "m", source: "mic", sourceHandle: "audio", target: "plan", targetHandle: "sources" },
      { id: "t1", source: "mic", sourceHandle: "audio", target: "tx", targetHandle: "audio" },
      { id: "t2", source: "tx", sourceHandle: "json", target: "plan", targetHandle: "transcript" },
      { id: "f", source: "plan", sourceHandle: "edl", target: "sf", targetHandle: "edl" },
    ] as unknown as WorkflowEdge[]
    expect(getExactPricingUnits(sf, [...cams, mic, tx, plan, sf], edges, new Set(["tx", "plan"]))).toBe(65)
  })

  it("quotes the 130-block ceiling only when the cameras cannot be counted", () => {
    const render = node("r", "apply-edl")
    const edges = [{ id: "e", source: "r", sourceHandle: "edl", target: "sf", targetHandle: "edl" }] as unknown as WorkflowEdge[]
    expect(getExactPricingUnits(sf, [render, sf], edges, new Set(["r"]))).toBe(130)
  })
})
