import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { resolveNodeInputs } from "../input-resolver.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

// B4 (decided 2026-09-25) through the REAL resolver into the REAL builder, on
// a podcast canvas: a mic (the master) and two cameras, wired into Audio Sync
// AND Edit Plan; the mic transcribed. The builder must fold the measured
// offsets onto edit-plan's sources, stamp the transcript's recording, and
// refuse — before the reserve — anything that would render out of sync.

const EP = "edit-plan"
const upload = (id: string, kind: "audio" | "video", label: string): SimpleNode =>
  kind === "audio"
    ? { id, type: "upload-audio", data: { label, url: `https://media.test/${id}.m4a` } }
    : { id, type: "upload-video", data: { label, url: `https://media.test/${id}.mp4` } }

const transcriptJson = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 800 }, { text: "bye", startMs: 59_000, endMs: 60_000 }] }
const syncJson = {
  version: 1,
  reference: "mic",
  offsets: [
    { sourceId: "mic", offsetMs: 0, confidence: 1, driftMsPerHour: 0 },
    { sourceId: "cam-a", offsetMs: 2_000, confidence: 0.92, driftMsPerHour: 3 },
    { sourceId: "cam-b", offsetMs: -1_500, confidence: 0.88, driftMsPerHour: 1 },
  ],
  notes: [],
}

function canvas(opts: { transcribeFrom?: string; viaExtractAudio?: boolean; syncDone?: boolean } = {}) {
  const from = opts.transcribeFrom ?? "mic"
  const nodes: SimpleNode[] = [
    upload("mic", "audio", "Zoom H6"),
    upload("cam-a", "video", "Camera A"),
    upload("cam-b", "video", "Wide"),
    { id: "tx", type: "transcribe", data: { label: "Transcribe" } },
    { id: "sync", type: "audio-sync", data: { label: "Audio Sync" } },
    { id: EP, type: "edit-plan", data: { label: "Edit Plan", mode: "tighten", planTier: "standard", sourceConfig: { mic: { role: "master-audio" } } } },
    ...(opts.viaExtractAudio ? [{ id: "ea", type: "extract-audio", data: { label: "Extract Audio" } } as SimpleNode] : []),
  ]
  const edge = (source: string, target: string, sourceHandle: string | null, targetHandle: string): SimpleEdge =>
    ({ id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle, targetHandle })
  const edges: SimpleEdge[] = [
    ...(opts.viaExtractAudio
      ? [edge(from, "ea", null, "in"), edge("ea", "tx", null, "audio")]
      : [edge(from, "tx", null, "audio")]),
    ...["mic", "cam-a", "cam-b"].map((id) => edge(id, "sync", null, "sources")),
    edge("tx", EP, "json", "transcript"),
    edge("sync", EP, "json", "offsets"),
    ...["mic", "cam-a", "cam-b"].map((id) => edge(id, EP, null, "sources")),
  ]
  const states: Record<string, NodeExecutionState> = {
    tx: { status: "completed", output: { json: transcriptJson, text: "hi bye" } } as unknown as NodeExecutionState,
    ...(opts.syncDone === false ? {} : { sync: { status: "completed", output: { json: syncJson } } as unknown as NodeExecutionState }),
  }
  return { nodes, edges, states }
}

function built(g: ReturnType<typeof canvas>) {
  const node = g.nodes.find((n) => n.id === EP)!
  const inputs = resolveNodeInputs(node, g.edges, g.states, g.nodes)
  return buildPayload(node, "job-1", inputs, "usage-1")
}

type Payload = { sources: Array<{ id: string; offsetMs?: number }>; transcript: { sourceId?: string; words: unknown[] } }

describe("edit-plan on a synced podcast canvas (B4)", () => {
  it("each camera's measured offset lands on its source, and the transcript is stamped as the master's", () => {
    const payload = built(canvas()).payload as unknown as Payload
    expect(payload.sources.map((s) => [s.id, s.offsetMs])).toEqual([["mic", undefined], ["cam-a", 2_000], ["cam-b", -1_500]])
    expect(payload.transcript.sourceId).toBe("mic")
    expect(payload.transcript.words).toHaveLength(2)
  })

  it("a transcript made from a camera is refused before the reserve, naming both recordings", () => {
    expect(() => built(canvas({ transcribeFrom: "cam-a" })))
      .toThrow(/the transcript was made from "Camera A", which is 2000 ms off the master "Zoom H6"/)
  })

  it("…also through extract-audio, which keeps the camera's clock", () => {
    expect(() => built(canvas({ transcribeFrom: "cam-a", viaExtractAudio: true })))
      .toThrow(/the transcript was made from "Camera A"/)
  })

  it("an Audio Sync that produced nothing fails the plan rather than letting it run unsynced", () => {
    expect(() => built(canvas({ syncDone: false }))).toThrow(/the offsets carry no Audio Sync result/)
  })
})
