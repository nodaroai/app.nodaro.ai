// @test-units-by-name looks up only the speaker-map unit it runs
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { resolveNodeInputs } from "../input-resolver.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

// Speaker Map in a server run, through the REAL resolver into the REAL
// builder: two uploads into Cameras, Audio Sync into Offsets, Transcribe into
// Transcript → one speaker-map job; then its result, as the job lands it,
// read downstream — Camera Switch's `speakerMap` and the two JSON pips.

const OFFSETS = { version: 1, reference: "camA", offsets: [{ sourceId: "camA", offsetMs: 0, confidence: 1 }, { sourceId: "camB", offsetMs: 120, confidence: 0.9 }], notes: [] }
const TRANSCRIPT = { words: [{ text: "hi", startMs: 0, endMs: 500, speaker: "A" }, { text: "yo", startMs: 600, endMs: 900, speaker: "B" }] }
const RESULT = {
  version: 1,
  speakerMap: { A: "camB", B: "camA" },
  confidence: { A: { camera: "camB", marginDb: 9.4 }, B: { camera: "camA", marginDb: 8.7 } },
  notes: [],
  edl: { version: 1, clock: "master", sources: [{ id: "camB", url: "https://media.test/b.mp4", kind: "video", role: "camera", speakers: ["A"] }, { id: "camA", url: "https://media.test/a.mp4", kind: "video", offsetMs: -120, role: "camera", speakers: ["B"] }], segments: [{ id: "whole", inMs: 0, outMs: 900, video: "camB" }] },
}
const PLAN_EDL = { version: 1, clock: "master", sources: [{ id: "camA", url: "https://media.test/a.mp4", kind: "video" }, { id: "camB", url: "https://media.test/b.mp4", kind: "video" }], segments: [{ id: "s", inMs: 0, outMs: 900, video: "camA" }] }

const nodes: SimpleNode[] = [
  { id: "camA", type: "upload-video", data: { label: "Camera A", url: "https://media.test/a.mp4" } },
  { id: "camB", type: "upload-video", data: { label: "Camera B", url: "https://media.test/b.mp4" } },
  { id: "sync", type: "audio-sync", data: { label: "Audio Sync", generatedJson: OFFSETS } },
  { id: "tx", type: "transcribe", data: { label: "Transcribe", generatedText: "hi yo", generatedJson: TRANSCRIPT } },
  { id: "plan", type: "edit-plan", data: { label: "Edit Plan", generatedJson: PLAN_EDL } },
  { id: "map", type: "speaker-map", data: { label: "Speaker Map", sourceOrder: ["camB"], marginDb: 6 } },
  { id: "cs", type: "camera-switch", data: { label: "Camera Switch" } },
]
const edges: SimpleEdge[] = [
  { id: "a", source: "camA", sourceHandle: "video", target: "map", targetHandle: "sources" },
  { id: "b", source: "camB", sourceHandle: "video", target: "map", targetHandle: "sources" },
  { id: "o", source: "sync", sourceHandle: "json", target: "map", targetHandle: "offsets" },
  { id: "t", source: "tx", sourceHandle: "json", target: "map", targetHandle: "transcript" },
  { id: "pe", source: "plan", sourceHandle: "edl", target: "cs", targetHandle: "edl" },
  { id: "pt", source: "tx", sourceHandle: "json", target: "cs", targetHandle: "transcript" },
  { id: "m", source: "map", sourceHandle: "json", target: "cs", targetHandle: "speakerMap" },
]
const node = (id: string) => nodes.find((n) => n.id === id)!
/** Every upstream node holds its saved output, as a run seeds a node it does not execute. */
const saved = (): Record<string, NodeExecutionState> =>
  Object.fromEntries(nodes.filter((n) => !["map", "cs"].includes(n.id)).flatMap((n) => {
    const output = extractSavedNodeOutput(n)
    return output ? [[n.id, { status: "completed", output } as NodeExecutionState]] : []
  }))

describe("Speaker Map in a server run", () => {
  it("enqueues one speaker-map job: the cameras in sourceOrder then wire order, the offsets and the transcript parsed", () => {
    const out = buildPayload(node("map"), "job-1", resolveNodeInputs(node("map"), edges, saved(), nodes), "usage-1")
    expect(out.jobName).toBe("speaker-map")
    const p = out.payload as Record<string, unknown>
    expect((p.sources as Array<{ id: string }>).map((s) => s.id)).toEqual(["camB", "camA"])
    expect(p.offsets).toEqual(OFFSETS)
    expect(p.transcript).toEqual(TRANSCRIPT)
    expect(p.marginDb).toBe(6)
  })

  it("its finished job's json reaches Camera Switch's speakerMap, which the job then sends", () => {
    const states = { ...saved(), map: { status: "completed", output: buildNodeOutputFromJobData({ json: RESULT, edl: RESULT.edl }, "speaker-map") } as NodeExecutionState }
    const inputs = resolveNodeInputs(node("cs"), edges, states, nodes)
    expect(JSON.parse(inputs.speakerMapResult!)).toEqual(RESULT)
    expect((buildPayload(node("cs"), "job-2", inputs, "usage-2").payload as { speakerMap: unknown }).speakerMap).toEqual({ A: "camB", B: "camA" })
  })

  it("its saved json and edl reach downstream as JSON strings, each on its own pip", () => {
    const output = extractSavedNodeOutput({ ...node("map"), data: { ...node("map").data, generatedJson: RESULT, generatedEdl: RESULT.edl } })!
    expect(JSON.parse(getPrimaryOutput(output, "speaker-map", "json")!)).toEqual(RESULT)
    expect(JSON.parse(getPrimaryOutput(output, "speaker-map", "edl")!)).toEqual(RESULT.edl)
  })
})
