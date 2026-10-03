import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { getListInputForNode, resolveNodeInputs } from "../input-resolver.js"
import { buildNodeOutputFromJobData, fanOutIterationValue, getPrimaryOutput } from "../output-extractor.js"
import { assembleFanOutResult, type FanOutIterationValue } from "../../../workers/fan-out-result.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

// camera-switch (podcast B5, decided 2026-10-03) on a canvas, through the REAL
// resolver into the REAL builder: Transcribe (diarized) + Edit Plan → Camera
// Switch. The builder parses both json inputs, pre-fills the speaker table by
// order (keeping the person's choices), and refuses — before the reserve — a
// transcript with no speaker labels.

const CS = "cs"
const edl = {
  version: 1, clock: "master",
  sources: [
    { id: "mic", url: "https://m.test/mic.wav", kind: "audio", role: "master-audio" },
    { id: "camA", url: "https://m.test/a.mp4", kind: "video" },
    { id: "wide", url: "https://m.test/w.mp4", kind: "video", role: "wide" },
    { id: "camB", url: "https://m.test/b.mp4", kind: "video" },
  ],
  segments: [{ id: "seg-0", inMs: 0, outMs: 30_000, video: "camA", audio: "mic" }],
}
const diarized = { version: 1, words: [
  { text: "hi", startMs: 0, endMs: 400, speaker: "speaker_0" },
  { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "speaker_1" },
  { text: "and", startMs: 9_000, endMs: 9_400, speaker: "speaker_2" },
] }

function canvas(opts: { transcript?: unknown; data?: Record<string, unknown> } = {}) {
  const nodes: SimpleNode[] = [
    { id: "tx", type: "transcribe", data: { label: "Transcribe" } },
    { id: "ep", type: "edit-plan", data: { label: "Edit Plan" } },
    { id: CS, type: "camera-switch", data: { label: "Camera Switch", ...(opts.data ?? {}) } },
  ]
  const edges: SimpleEdge[] = [
    { id: "e1", source: "ep", target: CS, sourceHandle: "edl", targetHandle: "edl" },
    { id: "e2", source: "tx", target: CS, sourceHandle: "json", targetHandle: "transcript" },
  ]
  const states: Record<string, NodeExecutionState> = {
    tx: { status: "completed", output: { json: opts.transcript ?? diarized, text: "hi yo and" } } as unknown as NodeExecutionState,
    ep: { status: "completed", output: { json: edl } } as unknown as NodeExecutionState,
  }
  return { nodes, edges, states }
}
function built(g: ReturnType<typeof canvas>) {
  const node = g.nodes.find((n) => n.id === CS)!
  return buildPayload(node, "job-1", resolveNodeInputs(node, g.edges, g.states, g.nodes), "usage-1")
}

describe("camera-switch on a canvas (B5)", () => {
  it("parses the edit and the transcript, pre-fills the speaker table by order, flat id", () => {
    const out = built(canvas())
    expect(out.jobName).toBe("camera-switch")
    expect(out.modelIdentifier).toBe("camera-switch")
    const p = out.payload as Record<string, unknown>
    expect((p.edl as { segments: unknown[] }).segments).toHaveLength(1)
    expect((p.transcript as { words: unknown[] }).words).toHaveLength(3)
    // Cameras in source order without the mic and the wide: camA, camB.
    expect(p.speakerMap).toEqual({ speaker_0: "camA", speaker_1: "camB" })
    expect(p.reservedCreditId).toBe("camera-switch")
  })

  it("keeps the person's choices; an explicit \"\" (no camera of their own) is sent as \"\"", () => {
    const out = built(canvas({ data: { speakerMap: { speaker_0: "camB", speaker_1: "" }, speakerNames: { speaker_0: "Dana", speaker_1: " " }, minShotMs: 3_000, layoutHints: true } }))
    const p = out.payload as Record<string, unknown>
    // speaker_1 chose no camera (sent, so it beats a source listing them);
    // speaker_2 is past the last camera (unmapped).
    expect(p.speakerMap).toStrictEqual({ speaker_0: "camB", speaker_1: "" })
    expect(p.speakerNames).toEqual({ speaker_0: "Dana" })
    expect(p.minShotMs).toBe(3_000)
    expect(p.layoutHints).toBe(true)
  })

  it("refuses — before the reserve — a transcript with no speaker labels (decided 2026-10-03)", () => {
    expect(() => built(canvas({ transcript: { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400 }] } })))
      .toThrow(/the transcript has no speaker labels — turn on speaker detection in Transcribe/)
  })

  it("clamps settings into the route's ranges (a 0 s shortest shot would be a 400)", () => {
    const p = built(canvas({ data: { minShotMs: 0, leadMs: 99_000, wideEvery: 50 } })).payload as Record<string, unknown>
    expect([p.minShotMs, p.leadMs, p.wideEvery]).toEqual([500, 5_000, 20])
    expect(p.maxShotMs).toBeUndefined()
  })

  it("refuses — before the reserve — an edit the route would refuse (a clip set, a chapters plan)", () => {
    const g = canvas()
    g.states.ep = { status: "completed", output: { json: { clips: [edl] } } } as unknown as NodeExecutionState
    expect(() => built(g)).toThrow(/clip set/)
    g.states.ep = { status: "completed", output: { json: { version: 1, chapters: [] } } } as unknown as NodeExecutionState
    expect(() => built(g)).toThrow(/needs `sources` and `segments`/)
  })

  it("refuses a missing edit before the reserve", () => {
    const g = canvas()
    g.edges = g.edges.filter((e) => e.targetHandle !== "edl")
    expect(() => built(g)).toThrow(/connect an edit/)
  })
})

describe("camera-switch output (B5)", () => {
  const outputData = { json: edl, transcript: { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Dana" }] }, viaNodaroCloud: true }
  it("the job's { json, transcript } becomes the node's { edl, transcript } pair, one handle each", () => {
    const output = buildNodeOutputFromJobData(outputData, "camera-switch")
    expect(output.json).toEqual({ edl, transcript: outputData.transcript })
    expect(JSON.parse(getPrimaryOutput(output, "camera-switch", "edl")!)).toEqual(edl)
    expect(JSON.parse(getPrimaryOutput(output, "camera-switch", "transcript")!)).toEqual(outputData.transcript)
    // No handle → the switched edit (what Apply EDL's `edl` input reads).
    expect(JSON.parse(getPrimaryOutput(output, "camera-switch", undefined)!)).toEqual(edl)
  })
})

// Clips mode (decided 2026-10-04): Edit Plan fans out one Camera Switch run per
// clip, and Camera Switch's EDL fans out on to one Apply EDL render per clip by
// default. Its transcript — the same for every clip — stays one value, in any mode.
describe("Clips mode through Camera Switch (B5)", () => {
  const clipEdl = (k: number) => JSON.stringify({ ...edl, segments: [{ id: `c${k}`, inMs: k * 10_000, outMs: k * 10_000 + 5_000, video: "camA", audio: "mic" }] })
  const named = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Dana" }] }
  function graph(transcriptMode?: string) {
    const nodes: SimpleNode[] = [
      { id: CS, type: "camera-switch", data: { label: "Camera Switch" } },
      { id: "ae", type: "apply-edl", data: { label: "Apply EDL" } },
    ]
    const edges: SimpleEdge[] = [
      { id: "e1", source: CS, target: "ae", sourceHandle: "edl", targetHandle: "edl" },
      { id: "e2", source: CS, target: "ae", sourceHandle: "transcript", targetHandle: "transcript", ...(transcriptMode ? { data: { outputMode: transcriptMode } } : {}) },
    ]
    // The REAL chain a server run takes: each clip's job output → the node
    // output → the value the iteration adds → assembleFanOutResult.
    const settled = [0, 1, 2].map((k): PromiseSettledResult<FanOutIterationValue> => {
      const output = buildNodeOutputFromJobData({ json: JSON.parse(clipEdl(k)), transcript: named, viaNodaroCloud: true }, "camera-switch")
      return { status: "fulfilled", value: { index: k, result: { output } as FanOutIterationValue["result"], resultValue: fanOutIterationValue(output, "camera-switch") } }
    })
    const states: Record<string, NodeExecutionState> = {
      [CS]: { status: "completed", output: assembleFanOutResult(settled, 3).output } as unknown as NodeExecutionState,
    }
    return { nodes, edges, states }
  }

  it("each clip's run adds its switched EDL to the node's list (it has no media or text — was \"\")", () => {
    expect(graph().states[CS]!.output!.listResults).toEqual([clipEdl(0), clipEdl(1), clipEdl(2)])
  })

  it("the EDL edge fans Apply EDL out once per clip, with no outputMode set", () => {
    const g = graph()
    expect(getListInputForNode(g.nodes[1]!, g.edges, g.states, g.nodes)).toEqual([clipEdl(0), clipEdl(1), clipEdl(2)])
  })

  it("iteration k renders clip k's switched EDL, with the one named transcript", () => {
    const g = graph()
    const inputs = resolveNodeInputs(g.nodes[1]!, g.edges, g.states, g.nodes, undefined, 2) as Record<string, unknown>
    expect(inputs.edl).toBe(clipEdl(2))
    expect(JSON.parse(String(inputs.transcript))).toEqual(named)
  })

  it("an \"each\" set by hand on the transcript edge still reads the transcript, never the clips' EDLs", () => {
    const g = graph("each")
    const inputs = resolveNodeInputs(g.nodes[1]!, g.edges, g.states, g.nodes, undefined, 1) as Record<string, unknown>
    expect(JSON.parse(String(inputs.transcript))).toEqual(named)
    expect(getListInputForNode(g.nodes[1]!, g.edges, g.states, g.nodes)).toEqual([clipEdl(0), clipEdl(1), clipEdl(2)])
  })

  it("after a single run (no per-clip results) the EDL edge is one value — no fan-out", () => {
    const g = graph()
    g.states[CS] = { status: "completed", output: buildNodeOutputFromJobData({ json: JSON.parse(clipEdl(0)), transcript: named }, "camera-switch") } as unknown as NodeExecutionState
    expect(getListInputForNode(g.nodes[1]!, g.edges, g.states, g.nodes)).toBeUndefined()
  })

  it("a Camera Switch this run did not run lists its LAST saved batch — never its accumulated history", () => {
    const g = graph()
    delete g.states[CS]
    g.nodes[0]!.data = {
      label: "Camera Switch",
      __listResults: [clipEdl(4), clipEdl(5)],
      generatedResults: [clipEdl(4), clipEdl(5), clipEdl(0), clipEdl(1), clipEdl(2)].map((url) => ({ url })),
    }
    expect(getListInputForNode(g.nodes[1]!, g.edges, g.states, g.nodes)).toEqual([clipEdl(4), clipEdl(5)])
  })
})
