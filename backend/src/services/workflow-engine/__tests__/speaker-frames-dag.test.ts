/**
 * Speaker Frames on a canvas (P3.6), through the REAL resolver into the REAL
 * builder and the REAL output readers:
 *  - input lanes: the edit on `edl` — a clip pack FOLDED into one run (P3-24
 *    (a)), never one job per clip — the transcript on `transcript`, carried
 *    as given (Camera Switch's renamed transcript keeps its `speakerNames`, the
 *    map transcript-led identity reads), a bare video on `video`;
 *  - payload builder: the plugin's `SpeakerFramesJobPayload`, the scope the
 *    plugin would refuse refused first, and "not priced yet" — the plugin's
 *    own words — until P3.7;
 *  - output readers: the descriptor on the `tracks` handle, live and saved.
 *
 * The plugin's own queue payload is copied below as the cross-repo fixture
 * (contract.ts `SPEAKER_FRAMES_JOB_PAYLOAD_EXAMPLE`, plugins main bdfa8cbc).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const flag = vi.hoisted(() => ({ priced: false }))
vi.mock("@nodaro/render-rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/render-rules")>()
  return { ...actual, get SPEAKER_FRAMES_PRICED() { return flag.priced } }
})

import { buildPayload } from "../payload-builder.js"
import { resolveNodeInputs } from "../input-resolver.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import { speakerFramesJobBudgetMs } from "../../../providers/video/speaker-frames-budget.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

/** The keys of the plugin's `SpeakerFramesJobPayload` (contract.ts). */
const PLUGIN_PAYLOAD_KEYS = new Set(["jobId", "usageLogId", "edl", "videoUrl", "transcript", "excludeSourceIds", "reservedCreditId", "workflowId", "nodeId"])

/** The plugin's real queue payload for a two-camera edit (`SPEAKER_FRAMES_JOB_PAYLOAD_EXAMPLE`). */
const PLUGIN_EXAMPLE = {
  jobId: "00000000-0000-4000-8000-0000000000d1",
  usageLogId: "00000000-0000-4000-8000-0000000000d2",
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
      { id: "s1", inMs: 45_000, outMs: 75_000, video: "camB", speaker: "Guest", transition: { type: "cut" } },
    ],
  },
  transcript: { version: 1, words: [{ text: "Welcome", startMs: 200, endMs: 640, speaker: "Host" }] },
  excludeSourceIds: [] as string[],
  reservedCreditId: "speaker-frames",
  workflowId: "00000000-0000-4000-8000-0000000000d3",
  nodeId: "speaker-frames-1",
}

const EDL = PLUGIN_EXAMPLE.edl
const CLIP2 = { ...EDL, segments: [{ id: "c2", inMs: 100_000, outMs: 110_000, video: "camA", speaker: "Host" }] }
const RENAMED = {
  version: 1,
  words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Host" }, { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "Guest" }],
  speakerNames: { speaker_0: "Host", speaker_1: "Guest" },
}

const SF = "sf"
function canvas(data: Record<string, unknown> = {}, opts: { pack?: boolean; video?: boolean } = {}) {
  const nodes: SimpleNode[] = [
    { id: "plan", type: "edit-plan", data: { label: "Plan" } },
    { id: "cs", type: "camera-switch", data: { label: "Camera Switch" } },
    { id: "vid", type: "upload-video", data: { label: "Video" } },
    { id: SF, type: "speaker-frames", data: { label: "Speaker Frames", ...data } },
  ]
  const edges: SimpleEdge[] = opts.video
    ? [{ id: "e0", source: "vid", target: SF, sourceHandle: "video", targetHandle: "video" }]
    : [
        { id: "e1", source: "plan", target: SF, sourceHandle: "edl", targetHandle: "edl" },
        { id: "e2", source: "cs", target: SF, sourceHandle: "transcript", targetHandle: "transcript" },
      ]
  const plan = opts.pack
    ? { status: "completed", output: { json: [EDL, CLIP2], listResults: [JSON.stringify(EDL), JSON.stringify(CLIP2)] } }
    : { status: "completed", output: { json: EDL } }
  const states: Record<string, NodeExecutionState> = {
    plan: plan as unknown as NodeExecutionState,
    cs: { status: "completed", output: { json: { edl: EDL, transcript: RENAMED } } } as unknown as NodeExecutionState,
    vid: { status: "completed", output: { videoUrl: "https://media.example/bare.mp4" } } as unknown as NodeExecutionState,
  }
  return { nodes, edges, states }
}
function built(g: ReturnType<typeof canvas>) {
  const node = g.nodes.find((n) => n.id === SF)!
  return buildPayload(node, "job-1", resolveNodeInputs(node, g.edges, g.states, g.nodes), "usage-1", { nodes: g.nodes, edges: g.edges, nodeStates: g.states, listRow: undefined })
}

beforeEach(() => {
  flag.priced = false
})

describe("the plugin's own payload, copied as a cross-repo fixture", () => {
  it("is one the budget leaf sizes", () => {
    expect(speakerFramesJobBudgetMs(PLUGIN_EXAMPLE)).toBeGreaterThan(0)
  })
})

describe("the payload builder", () => {
  it("says it is not priced yet — the plugin's own words — before anything is reserved", () => {
    expect(() => built(canvas())).toThrow("Speaker Frames is not priced yet")
  })

  it("builds the plugin's job payload, every key one the plugin declares", () => {
    flag.priced = true
    const { jobName, payload, modelIdentifier } = built(canvas({ excludeSourceIds: ["camB"] })) as { jobName: string; payload: Record<string, unknown>; modelIdentifier: string }
    expect(jobName).toBe("speaker-frames")
    expect(modelIdentifier).toBe("speaker-frames")
    expect(payload).toMatchObject({ jobId: "job-1", edl: EDL, transcript: RENAMED, excludeSourceIds: ["camB"], reservedCreditId: "speaker-frames", nodeId: SF, usageLogId: "usage-1" })
    for (const key of Object.keys(payload)) expect(PLUGIN_PAYLOAD_KEYS.has(key), key).toBe(true)
  })

  it("carries the renamed transcript's speakerNames map to the plugin", () => {
    flag.priced = true
    const { payload } = built(canvas()) as unknown as { payload: { transcript: { speakerNames?: unknown } } }
    expect(payload.transcript.speakerNames).toEqual({ speaker_0: "Host", speaker_1: "Guest" })
  })

  it("folds a clip pack into ONE job over the union of its clips (P3-24 (a))", () => {
    flag.priced = true
    const { payload } = built(canvas({}, { pack: true })) as unknown as { payload: { edl: unknown } }
    expect(payload.edl).toEqual([EDL, CLIP2])
  })

  it("takes a bare video whole", () => {
    flag.priced = true
    const { payload } = built(canvas({}, { video: true })) as { payload: Record<string, unknown> }
    expect(payload.videoUrl).toBe("https://media.example/bare.mp4")
    expect(payload.edl).toBeUndefined()
  })

  it("refuses the scope the plugin would refuse, before the price", () => {
    expect(() => built(canvas({ excludeSourceIds: ["camA", "camB"] }))).toThrow(/nothing left to sample/)
    const g = canvas()
    g.edges = []
    expect(() => built(g)).toThrow(/connect an edit/)
  })
})

describe("output readers", () => {
  const descriptor = { version: 1, sampleFps: 2, detector: { id: "yunet" }, sources: [], url: "https://r2.example/speaker-tracks/job-1.json", sha256: "a".repeat(64), bytes: 10 }

  it("a finished job's descriptor is the `tracks` handle's json", () => {
    const out = buildNodeOutputFromJobData({ json: descriptor, notes: ["n"] }, "speaker-frames")
    expect(out.json).toEqual(descriptor)
    expect(JSON.parse(getPrimaryOutput(out, "speaker-frames", "tracks")!)).toEqual(descriptor)
    expect(JSON.parse(getPrimaryOutput(out, "speaker-frames", null)!)).toEqual(descriptor)
  })

  it("a saved node hands its descriptor on without re-running", () => {
    const out = extractSavedNodeOutput({ id: SF, type: "speaker-frames", data: { generatedJson: descriptor } })
    expect(out?.json).toEqual(descriptor)
    expect(extractSavedNodeOutput({ id: SF, type: "speaker-frames", data: {} })).toBeUndefined()
  })
})
