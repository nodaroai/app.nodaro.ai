/**
 * B4 (decided 2026-09-25) — edit-plan's canvas inputs for multicam, on the
 * editor's own engine (mirror of the backend's edit-plan-offsets-dag test):
 * Audio Sync's result reaches `editPlanOffsets`, a wired-but-empty Offsets
 * input stays visible (so the run fails instead of planning unsynced), each
 * source row carries its label, and the transcript is traced to the
 * recording it was made from.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/ee/hooks/use-model-credits", () => ({
  getCachedCredits: vi.fn(),
  getCachedVideoProCredits: vi.fn(),
}))

import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const EP = "ep"
function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as WorkflowNode
}
const edge = (source: string, target: string, sourceHandle: string | undefined, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle, targetHandle }) as WorkflowEdge

const sync = { version: 1, reference: "mic", offsets: [{ sourceId: "mic", offsetMs: 0, confidence: 1, driftMsPerHour: 0 }, { sourceId: "cam", offsetMs: 2_000, confidence: 0.9, driftMsPerHour: 0 }], notes: [] }
const transcript = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 500 }] }

function canvas(opts: { transcribeFrom?: string; viaExtractAudio?: boolean; syncDone?: boolean } = {}) {
  const from = opts.transcribeFrom ?? "mic"
  const nodes = [
    node("mic", "upload-audio", { label: "Zoom H6", url: "https://m.test/mic.m4a", audioUrl: "https://m.test/mic.m4a" }),
    node("cam", "upload-video", { label: "Camera A", url: "https://m.test/cam.mp4", videoUrl: "https://m.test/cam.mp4" }),
    node("tx", "transcribe", { generatedJson: transcript }),
    node("sync", "audio-sync", opts.syncDone === false ? {} : { generatedJson: sync }),
    node(EP, "edit-plan", { mode: "tighten" }),
    ...(opts.viaExtractAudio ? [node("ea", "extract-audio")] : []),
  ]
  const edges = [
    ...(opts.viaExtractAudio ? [edge(from, "ea", undefined, "in"), edge("ea", "tx", undefined, "audio")] : [edge(from, "tx", undefined, "audio")]),
    edge("tx", EP, "json", "transcript"),
    edge("sync", EP, "json", "offsets"),
    edge("mic", EP, undefined, "sources"),
    edge("cam", EP, undefined, "sources"),
  ]
  return { nodes, edges }
}
const inputsOf = (g: ReturnType<typeof canvas>) => resolveNodeInputs(g.nodes.find((n) => n.id === EP)!, g.nodes, g.edges)

describe("edit-plan multicam inputs (editor engine)", () => {
  it("Audio Sync's result reaches editPlanOffsets; each source carries its node label", () => {
    const inputs = inputsOf(canvas())
    expect(JSON.parse(inputs.editPlanOffsets!)).toEqual(sync)
    expect(inputs.editPlanSources?.map((s) => [s.nodeId, s.label])).toEqual([["mic", "Zoom H6"], ["cam", "Camera A"]])
    // Nothing leaked into a generic slot.
    expect(inputs.prompt).toBeUndefined()
  })

  it("a wired Offsets input with no result yet stays visible as empty — never silently absent", () => {
    expect(inputsOf(canvas({ syncDone: false })).editPlanOffsets).toBe("")
  })

  it("traces the transcript to its recording — directly, or through extract-audio", () => {
    expect(inputsOf(canvas()).editPlanTranscriptOrigin).toBe("mic")
    expect(inputsOf(canvas({ transcribeFrom: "cam", viaExtractAudio: true })).editPlanTranscriptOrigin).toBe("cam")
  })
})
