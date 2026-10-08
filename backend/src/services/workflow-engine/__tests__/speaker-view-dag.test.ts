/**
 * Speaker View on a canvas (C3.2), through the REAL resolver into the REAL
 * builder and the REAL output readers — the cases C3.1 deferred.
 *
 *  - input-resolver: an Edit Plan / Camera Switch EDL into `edl`, a diarized
 *    transcript into `transcript`, as stringified json lanes;
 *  - payload-builder: the plugin's `SpeakerViewJobPayload`, with the rule's own
 *    refusals before the reserve and "not priced yet" — in the plugin's words —
 *    until C4;
 *  - output readers: the finished job's `json` is an EDL (never a Transcript),
 *    the video comes on its default handle, and a render's stamps ride along.
 *
 * The plugin's own queue payload is copied below as a cross-repo fixture
 * (contract.ts `SPEAKER_VIEW_JOB_PAYLOAD_EXAMPLE`, plugins main d49e63d3): the
 * app's rule must accept it, and every key this builder writes must be one the
 * plugin's payload type declares.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const flag = vi.hoisted(() => ({ priced: false }))
vi.mock("@nodaro/render-rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/render-rules")>()
  return { ...actual, get SPEAKER_VIEW_PRICED() { return flag.priced } }
})

import { findSpeakerViewIssues } from "@nodaro/render-rules"
import { buildPayload } from "../payload-builder.js"
import { resolveNodeInputs } from "../input-resolver.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

/** The keys of the plugin's `SpeakerViewJobPayload` (contract.ts). */
const PLUGIN_PAYLOAD_KEYS = new Set([
  "jobId", "usageLogId", "edl", "transcript", "quality", "targetAspect", "layout", "switch", "emphasis", "accentColor",
  "speakerRegions", "clipKey", "planBasis", "renderBasis", "reservedCreditId", "workflowId", "nodeId",
])

/** The plugin's real queue payload for a two-camera preview at 9:16. */
const PLUGIN_EXAMPLE = {
  jobId: "00000000-0000-4000-8000-0000000000a1",
  usageLogId: "00000000-0000-4000-8000-0000000000b2",
  edl: {
    version: 1,
    clock: "master",
    sources: [
      { id: "mic", url: "https://media.example/mic.wav", kind: "audio", role: "master-audio" },
      { id: "camA", url: "https://media.example/cam-a.mp4", kind: "video", speakers: ["Host"] },
      { id: "camB", url: "https://media.example/cam-b.mp4", kind: "video", offsetMs: 4_000, speakers: ["Guest"] },
    ],
    segments: [
      { id: "s0", inMs: 0, outMs: 30_000, video: "camA", speaker: "Host" },
      { id: "s1", inMs: 30_000, outMs: 75_000, video: "camB", speaker: "Guest", transition: { type: "cut" } },
    ],
    meta: { targetAspect: "9:16" },
  },
  transcript: { version: 1, words: [{ text: "Welcome", startMs: 200, endMs: 640, speaker: "Host" }] },
  quality: "proxy",
  targetAspect: "9:16",
  layout: "single",
  switch: { type: "cut" },
  speakerRegions: [{ source: "camA", speaker: "Host", region: { x: 0.2, y: 0, w: 0.5, h: 1 } }],
  clipKey: "0-75000",
  reservedCreditId: "speaker-view:proxy",
}

const EDL = PLUGIN_EXAMPLE.edl
const DIARIZED = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "speaker_0" }, { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "speaker_1" }] }

const SV = "sv"
function canvas(data: Record<string, unknown> = {}, opts: { edl?: unknown; transcript?: unknown; planNode?: "edit-plan" | "camera-switch" } = {}) {
  const planType = opts.planNode ?? "edit-plan"
  const nodes: SimpleNode[] = [
    { id: "tx", type: "transcribe", data: { label: "Transcribe" } },
    // The plan as the canvas holds it: an Edit Plan's saved plan, a Camera Switch's saved pair.
    { id: "plan", type: planType, data: { label: "Plan", generatedJson: planType === "camera-switch" ? { edl: opts.edl ?? EDL } : (opts.edl ?? EDL) } },
    { id: SV, type: "speaker-view", data: { label: "Speaker View", ...data } },
  ]
  const edges: SimpleEdge[] = [
    { id: "e1", source: "plan", target: SV, sourceHandle: "edl", targetHandle: "edl" },
    { id: "e2", source: "tx", target: SV, sourceHandle: "json", targetHandle: "transcript" },
  ]
  const states: Record<string, NodeExecutionState> = {
    tx: { status: "completed", output: { json: opts.transcript ?? DIARIZED } } as unknown as NodeExecutionState,
    // A Camera Switch's output is the { edl, transcript } pair on one slot, two handles.
    plan: { status: "completed", output: { json: planType === "camera-switch" ? { edl: opts.edl ?? EDL, transcript: DIARIZED } : (opts.edl ?? EDL) } } as unknown as NodeExecutionState,
  }
  return { nodes, edges, states }
}
function built(g: ReturnType<typeof canvas>) {
  const node = g.nodes.find((n) => n.id === SV)!
  return buildPayload(node, "job-1", resolveNodeInputs(node, g.edges, g.states, g.nodes), "usage-1", { nodes: g.nodes, edges: g.edges, nodeStates: g.states, listRow: undefined })
}

beforeEach(() => { flag.priced = false })

describe("the plugin's own payload, copied as a cross-repo fixture", () => {
  it("is an edit the app's rule accepts, with the settings it carries", () => {
    const v = findSpeakerViewIssues({
      edl: PLUGIN_EXAMPLE.edl,
      transcript: PLUGIN_EXAMPLE.transcript,
      settings: { layout: PLUGIN_EXAMPLE.layout, switch: PLUGIN_EXAMPLE.switch, targetAspect: PLUGIN_EXAMPLE.targetAspect, speakerRegions: PLUGIN_EXAMPLE.speakerRegions },
    })
    expect(v.issues).toEqual([])
    expect(v.ok).toBe(true)
  })
})

describe("input lanes: the edit and the transcript, as stringified json", () => {
  it("routes the wired EDL and transcript by their target handles, from an Edit Plan or a Camera Switch", () => {
    for (const planNode of ["edit-plan", "camera-switch"] as const) {
      const g = canvas({}, { planNode })
      const inputs = resolveNodeInputs(g.nodes.find((n) => n.id === SV)!, g.edges, g.states, g.nodes)
      expect(JSON.parse(inputs.edl as string)).toEqual(EDL)
      expect(JSON.parse(inputs.transcript as string)).toEqual(DIARIZED)
    }
  })
})

describe("the payload builder", () => {
  it("says it is not priced yet — the plugin's own words — before anything is reserved", () => {
    expect(() => built(canvas())).toThrow("Speaker View is not priced yet")
  })

  it("refuses an edit the plugin would refuse, in the rule's words, before the price (the plugin's own order)", () => {
    const unnamed = { ...EDL, segments: EDL.segments.map(({ speaker: _s, ...rest }) => rest) }
    expect(() => built(canvas({}, { edl: unnamed, transcript: { version: 1, words: [{ text: "x", startMs: 0, endMs: 1 }] } }))).toThrow(/speaker-view: invalid EDL — .*Wire Camera Switch/)
  })

  it("refuses a run with no edit wired", () => {
    const g = canvas()
    g.edges.splice(0, 1)
    expect(() => built(g)).toThrow(/connect an edit/)
  })

  describe("once priced (C4 flips the flag)", () => {
    beforeEach(() => { flag.priced = true })

    it("builds the plugin's job: its name, the quality's credit id, the edit and transcript as objects", () => {
      const out = built(canvas({ quality: "proxy", layout: "side-by-side", targetAspect: "9:16", switchType: "pan", switchDurationMs: 600, emphasisStyle: "scale+border", emphasisDurationMs: 300, accentColor: "#FFAA00" }))
      expect(out.jobName).toBe("speaker-view")
      expect(out.queueName).toBe("video-generation")
      expect(out.modelIdentifier).toBe("speaker-view:proxy")
      const p = out.payload
      expect(p.edl).toEqual(EDL)
      expect(p.transcript).toEqual(DIARIZED)
      expect(p).toMatchObject({
        quality: "proxy",
        reservedCreditId: "speaker-view:proxy",
        nodeId: SV,
        usageLogId: "usage-1",
        // The layout the aspect rules out is snapped against the REAL edit, not sent as stored.
        layout: "stacked",
        targetAspect: "9:16",
        switch: { type: "pan", durationMs: 600 },
        emphasis: { style: "scale+border", durationMs: 300 },
        accentColor: "#FFAA00",
      })
    })

    it("bills a final on `speaker-view`, whatever the node's other settings", () => {
      const out = built(canvas({ quality: "final" }))
      expect(out.modelIdentifier).toBe("speaker-view")
      expect(out.payload.quality).toBe("final")
      expect(out.payload.reservedCreditId).toBe("speaker-view")
    })

    it("writes only keys the plugin's job payload declares", () => {
      const out = built(canvas({ layout: "grid", switchType: "cut", emphasisStyle: "dim", accentColor: "#FFFFFF", speakerRegions: PLUGIN_EXAMPLE.speakerRegions }))
      const stray = Object.keys(out.payload).filter((k) => !PLUGIN_PAYLOAD_KEYS.has(k))
      expect(stray).toEqual([])
    })

    it("stamps the render's basis: 16 hex, stable, changed by a picture-changing setting, not by the quality", () => {
      const basis = (data: Record<string, unknown>) => built(canvas(data)).payload.renderBasis as string
      expect(basis({})).toMatch(/^[0-9a-f]{16}$/)
      expect(basis({})).toBe(basis({}))
      expect(basis({ layout: "grid" })).not.toBe(basis({ layout: "pip" }))
      expect(basis({ quality: "proxy" })).toBe(basis({ quality: "final" }))
    })

    it("carries the plan clip it cuts (A1b) — the clip its list row reads of the Edit Plan behind it — and the plan value (A3-1)", () => {
      const clip = (a: number, b: number) => ({ ...EDL, segments: [{ id: `s${a}`, inMs: a, outMs: b, video: "camA", speaker: "Host" }] })
      const clips = [clip(0, 5_000), clip(10_000, 20_000)]
      const nodes: SimpleNode[] = [
        { id: "plan", type: "edit-plan", data: { generatedJson: clips } },
        { id: SV, type: "speaker-view", data: { quality: "final" } },
      ]
      const edges: SimpleEdge[] = [{ id: "e", source: "plan", target: SV, sourceHandle: "edl", targetHandle: "edl", data: { outputMode: "each" } } as SimpleEdge]
      const nodeStates = { plan: { status: "completed", output: { json: clips, listResults: clips.map((c) => JSON.stringify(c)) } } } as unknown as Record<string, NodeExecutionState>
      const out = buildPayload(nodes[1]!, "job-1", { edl: JSON.stringify(clips[1]) }, "usage-1", { nodes, edges, nodeStates, listRow: 1 })
      expect(out.payload.clipKey).toBe("10000-20000")
      expect(out.payload.planBasis).toMatch(/^[0-9a-f]{16}$/)
    })

    it("sends the transcript as given, and nothing when none is wired", () => {
      const g = canvas()
      g.edges.pop()
      expect("transcript" in built(g).payload).toBe(false)
    })
  })
})

describe("the output readers", () => {
  const drawn = { ...EDL, meta: { targetAspect: "9:16", notes: "1 segment: grid of 3 → grid of 2" } }
  const jobOutput = { videoUrl: "https://r2.test/sv.mp4", thumbnailUrl: "https://r2.test/sv.jpg", json: drawn, quality: "proxy", clipKey: "0-75000", planBasis: "0123456789abcdef", renderBasis: "fedcba9876543210" }

  it("reads a finished job: the video, and the EDL as drawn on json, with the render's stamps", () => {
    const out = buildNodeOutputFromJobData(jobOutput, "speaker-view")
    expect(out.videoUrl).toBe("https://r2.test/sv.mp4")
    expect(out.json).toEqual(drawn)
    expect(out).toMatchObject({ quality: "proxy", clipKey: "0-75000", planBasis: "0123456789abcdef", renderBasis: "fedcba9876543210" })
  })

  it("hands the video on its default handle and the EDL — never a Transcript — on json", () => {
    const out = buildNodeOutputFromJobData(jobOutput, "speaker-view")
    expect(getPrimaryOutput(out, "speaker-view", undefined)).toBe("https://r2.test/sv.mp4")
    expect(getPrimaryOutput(out, "speaker-view", "video")).toBe("https://r2.test/sv.mp4")
    expect(getPrimaryOutput(out, "speaker-view", "json")).toBe(JSON.stringify(drawn))
  })

  it("hydrates BOTH from saved node data (a skipped node, Run from here), with the selected take's stamps", () => {
    const node: SimpleNode = {
      id: SV,
      type: "speaker-view",
      data: { generatedVideoUrl: "https://r2.test/sv.mp4", generatedJson: drawn, generatedResults: [{ url: "https://r2.test/sv.mp4", jobId: "j", timestamp: "t", quality: "proxy" }] },
    }
    const saved = extractSavedNodeOutput(node)
    expect(saved?.videoUrl).toBe("https://r2.test/sv.mp4")
    expect(saved?.json).toEqual(drawn)
    expect(saved?.quality).toBe("proxy")
  })
})

describe("the transcript output (decided 2026-10-08): the wired transcript remapped through the edit as drawn", () => {
  const drawn = { ...EDL, meta: { targetAspect: "9:16" } }
  const remapped = { version: 1, words: [{ text: "Welcome", startMs: 200, endMs: 640, speaker: "Host" }] }
  const VIDEO = "https://r2.test/sv.mp4"
  const jobOutput = { videoUrl: VIDEO, json: drawn, transcript: remapped, quality: "proxy" }

  it("reads it off a finished job beside the EDL, and hands it on `transcript` — the EDL stays on json, the video on the default", () => {
    const out = buildNodeOutputFromJobData(jobOutput, "speaker-view")
    expect(out.json).toEqual(drawn)
    expect(out.transcript).toEqual(remapped)
    expect(getPrimaryOutput(out, "speaker-view", "transcript")).toBe(JSON.stringify(remapped))
    expect(getPrimaryOutput(out, "speaker-view", "json")).toBe(JSON.stringify(drawn))
    expect(getPrimaryOutput(out, "speaker-view", undefined)).toBe(VIDEO)
  })

  it("an older plugin's job carries none: the transcript pip hands nothing — never the video url", () => {
    const out = buildNodeOutputFromJobData({ videoUrl: VIDEO, json: drawn, quality: "proxy" }, "speaker-view")
    expect(out.transcript).toBeUndefined()
    expect(getPrimaryOutput(out, "speaker-view", "transcript")).toBeUndefined()
  })

  it("Apply EDL keeps its transcript on json and reads nothing new", () => {
    const out = buildNodeOutputFromJobData({ videoUrl: VIDEO, json: remapped, transcript: { stray: true } }, "apply-edl")
    expect(out.json).toEqual(remapped)
    expect(out.transcript).toBeUndefined()
  })

  it("hydrates it from saved node data (`generatedTranscript`) for a skipped node or Run from here", () => {
    const node: SimpleNode = {
      id: SV,
      type: "speaker-view",
      data: { generatedVideoUrl: VIDEO, generatedJson: drawn, generatedTranscript: remapped, generatedResults: [{ url: VIDEO, jobId: "j", timestamp: "t" }] },
    }
    const saved = extractSavedNodeOutput(node)!
    expect(saved.json).toEqual(drawn)
    expect(saved.transcript).toEqual(remapped)
    expect(getPrimaryOutput(saved, "speaker-view", "transcript")).toBe(JSON.stringify(remapped))
  })

  describe("into Add Captions", () => {
    const graph = (output: Record<string, unknown>) => {
      const nodes: SimpleNode[] = [
        { id: SV, type: "speaker-view", data: { label: "Speaker View" } },
        { id: "cap", type: "add-captions", data: { label: "Caption Video" } },
      ]
      const edges: SimpleEdge[] = [
        { id: "v", source: SV, target: "cap", sourceHandle: "video", targetHandle: "in" },
        { id: "t", source: SV, target: "cap", sourceHandle: "transcript", targetHandle: "transcript" },
      ]
      const states: Record<string, NodeExecutionState> = { [SV]: { status: "completed", output: buildNodeOutputFromJobData(output, "speaker-view") } as unknown as NodeExecutionState }
      return resolveNodeInputs(nodes[1]!, edges, states, nodes)
    }

    it("receives the video on `in` and the remapped transcript on `transcript`", () => {
      const inputs = graph(jobOutput)
      expect(inputs.videoUrl).toBe(VIDEO)
      expect(JSON.parse(inputs.transcript as string)).toEqual(remapped)
    })

    it("from an older plugin, the transcript lane reads nothing — the video is never routed into it, nor a second video", () => {
      const inputs = graph({ videoUrl: VIDEO, json: drawn })
      expect(inputs.videoUrl).toBe(VIDEO)
      expect(inputs.transcript).toBeUndefined()
      expect(inputs.videoUrls ?? []).not.toContain(VIDEO)
    })
  })
})
