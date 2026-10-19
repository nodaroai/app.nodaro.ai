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

// `priced`: Speaker View; `frames`: Speaker Frames. Video mode runs only with both (R15).
const flag = vi.hoisted(() => ({ priced: false, frames: true }))
vi.mock("../../../lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("@nodaro/render-rules", async (importOriginal) =>
  (await import("../../../__tests__/helpers/speaker-view-video-gate-mock.js")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag),
)

import { SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE, SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE, findSpeakerViewIssues, isWholeClipEdl, speakerViewVideoEdit, type SpeakerViewTracksRunDeps } from "@nodaro/render-rules"
import { resolveSpeakerViewTracksOfNode } from "../../../lib/speaker-view-tracks-io.js"
import { buildPayload } from "../payload-builder.js"
import { resolveNodeInputs } from "../input-resolver.js"
import { runPreviewStops } from "../../../lib/preview-review-gate.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

/** The keys of the plugin's `SpeakerViewJobPayload` (contract.ts). */
const PLUGIN_PAYLOAD_KEYS = new Set([
  "jobId", "usageLogId", "edl", "transcript", "quality", "targetAspect", "layout", "switch", "emphasis", "accentColor",
  "speakerRegions", "tracks", "motion", "clipKey", "planBasis", "renderBasis", "reservedCreditId", "reservedCreditsPerMinute", "workflowId", "nodeId",
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

beforeEach(() => { flag.priced = false; flag.frames = true })

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

  it("refuses a run with no edit and no video wired, naming both inputs", () => {
    const g = canvas()
    g.edges.splice(0, 1)
    expect(() => built(g)).toThrow(/connect an edit .* or a video to the Video input/i)
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

    it("autoRegions: the default thirds on the edit's one camera reach the job — the same body the canvas sends", () => {
      const oneCamera = {
        version: 1,
        clock: "master",
        sources: [{ id: "a", url: "https://x/a.mp4", kind: "video" }],
        segments: [
          { id: "s0", inMs: 0, outMs: 5000, video: "a", speaker: "Host" },
          { id: "s1", inMs: 5000, outMs: 10000, video: "a", speaker: "Guest" },
        ],
      }
      const thirds = [
        { source: "a", speaker: "Host", region: { x: 0.0918, y: 0, w: 0.3164, h: 1 } },
        { source: "a", speaker: "Guest", region: { x: 0.5918, y: 0, w: 0.3164, h: 1 } },
      ]
      const on = built(canvas({ layout: "single", targetAspect: "9:16", autoRegions: true }, { edl: oneCamera }))
      expect(on.payload.speakerRegions).toEqual(thirds)
      expect(on.payload).not.toHaveProperty("autoRegions")
      const off = built(canvas({ layout: "single", targetAspect: "9:16" }, { edl: oneCamera }))
      expect(off.payload).not.toHaveProperty("speakerRegions")
    })

    it("autoRegions on a fan-out row (one clip of a pack, decided 2026-10-14): the boxes of every speaker in the episode's transcript, whoever is on screen — the same rows the editor's run sends", () => {
      // Only speaker_1 is on screen in this clip; the episode's transcript names speaker_0 first.
      const guestOnly = {
        version: 1,
        clock: "master",
        sources: [{ id: "a", url: "https://x/a.mp4", kind: "video" }],
        segments: [{ id: "s1", inMs: 5000, outMs: 10000, video: "a", speaker: "speaker_1" }],
      }
      const g = canvas({ layout: "single", targetAspect: "9:16", autoRegions: true }, { edl: guestOnly })
      const node = g.nodes.find((n) => n.id === SV)!
      const row = buildPayload(node, "job-1", resolveNodeInputs(node, g.edges, g.states, g.nodes), "usage-1", { nodes: g.nodes, edges: g.edges, nodeStates: g.states, listRow: 1 })
      expect(row.payload.speakerRegions).toEqual([
        { source: "a", speaker: "speaker_0", region: { x: 0.0918, y: 0, w: 0.3164, h: 1 } },
        { source: "a", speaker: "speaker_1", region: { x: 0.5918, y: 0, w: 0.3164, h: 1 } },
      ])
      // Run once (not a row), the same clip shows one speaker: no box.
      expect(built(g).payload).not.toHaveProperty("speakerRegions")
    })

    it("autoRegions on a fan-out row: a stray one-word label gets no share (decided 2026-10-18) — halves, the rows the editor's run sends", () => {
      const guestOnly = {
        version: 1,
        clock: "master",
        sources: [{ id: "a", url: "https://x/a.mp4", kind: "video" }],
        segments: [{ id: "s1", inMs: 70_000, outMs: 75_000, video: "a", speaker: "speaker_1" }],
      }
      const stray = { version: 1, words: [
        { text: "hi", startMs: 0, endMs: 60_000, speaker: "speaker_0" },
        { text: "um", startMs: 60_000, endMs: 60_300, speaker: "speaker_2" },
        { text: "yo", startMs: 61_000, endMs: 121_000, speaker: "speaker_1" },
      ] }
      const g = canvas({ layout: "single", targetAspect: "9:16", autoRegions: true }, { edl: guestOnly, transcript: stray })
      const node = g.nodes.find((n) => n.id === SV)!
      const row = buildPayload(node, "job-1", resolveNodeInputs(node, g.edges, g.states, g.nodes), "usage-1", { nodes: g.nodes, edges: g.edges, nodeStates: g.states, listRow: 1 })
      expect(row.payload.speakerRegions).toEqual([
        { source: "a", speaker: "speaker_0", region: { x: 0.0918, y: 0, w: 0.3164, h: 1 } },
        { source: "a", speaker: "speaker_1", region: { x: 0.5918, y: 0, w: 0.3164, h: 1 } },
      ])
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

// P3.9: Speaker Frames' face tracks into Speaker View's `tracks` (the stored
// file's descriptor), through the REAL resolver, the shared funnel and the REAL
// builder.
describe("face tracks (P3.9)", () => {
  const FRAMES_JOB = "11111111-2222-4333-8444-555555555555"
  const TRACKS = {
    version: 1,
    sampleFps: 2,
    detector: { id: "yunet" },
    url: `https://media.example/users/u1/speaker-tracks/${FRAMES_JOB}.json`,
    sha256: "e".repeat(64),
    bytes: 1_200,
    sources: [
      { sourceId: "camA", clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: 0, endMs: 32_000 }], tracks: [{ id: "camA/t1", speaker: "speaker_0", attribution: { method: "mouth-motion", confidence: 0.8, rawSpeaker: "speaker_0" }, boxCount: 64 }] },
      { sourceId: "camB", clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: 24_000, endMs: 73_000 }], tracks: [{ id: "camB/t1", boxCount: 98 }] },
    ],
  }
  const RENAMED = { ...DIARIZED, speakerNames: { speaker_0: "Host", speaker_1: "Guest" } }
  function tracked(data: Record<string, unknown> = {}, frames: Record<string, unknown> = {}) {
    const g = canvas({ quality: "proxy", ...data }, { transcript: RENAMED })
    g.nodes.push({ id: "sf", type: "speaker-frames", data: { label: "Speaker Frames", generatedJson: TRACKS, ...frames } })
    g.edges.push({ id: "e3", source: "sf", target: SV, sourceHandle: "tracks", targetHandle: "tracks" })
    g.states.sf = { status: "completed", output: { json: TRACKS } } as unknown as NodeExecutionState
    return g
  }
  const framesJob = { input_data: { edl: EDL }, output_data: { json: TRACKS } }
  const deps: SpeakerViewTracksRunDeps = { loadFramesJob: async (id: string) => (id === FRAMES_JOB ? framesJob : null), readTrackBody: async () => { throw new Error("not needed") } }
  async function builtTracked(g: ReturnType<typeof tracked>, d: SpeakerViewTracksRunDeps = deps) {
    const node = g.nodes.find((n) => n.id === SV)!
    const inputs = resolveNodeInputs(node, g.edges, g.states, g.nodes)
    // The executor's own glue (node-executor → resolveSpeakerViewTracksOfNode), not a copy of it.
    const speakerViewTracks = await resolveSpeakerViewTracksOfNode(node, inputs, d)
    return buildPayload(node, "job-1", inputs, "usage-1", { nodes: g.nodes, edges: g.edges, nodeStates: g.states, listRow: undefined, ...(speakerViewTracks ? { speakerViewTracks } : {}) })
  }

  it("routes the descriptor on `tracks`, with the corrections its Speaker Frames node holds", () => {
    const g = tracked({}, { trackAssignments: [{ trackId: "camB/t1", speaker: "Guest" }] })
    const inputs = resolveNodeInputs(g.nodes.find((n) => n.id === SV)!, g.edges, g.states, g.nodes)
    expect(JSON.parse(inputs.tracks as string)).toEqual(TRACKS)
    expect(inputs.trackAssignments).toEqual([{ trackId: "camB/t1", speaker: "Guest" }])
  })

  describe("once priced", () => {
    beforeEach(() => { flag.priced = true })

    it("sends the descriptor with the app's labels (rename map, then corrections) and glide by default", async () => {
      const out = await builtTracked(tracked({}, { trackAssignments: [{ trackId: "camB/t1", speaker: "Guest" }] }))
      const sent = out.payload.tracks as typeof TRACKS
      expect(sent.url).toBe(TRACKS.url)
      expect(sent.sources[0]!.tracks[0]).toMatchObject({ id: "camA/t1", speaker: "Host", attribution: { rawSpeaker: "speaker_0" } })
      expect(sent.sources[1]!.tracks[0]).toMatchObject({ id: "camB/t1", speaker: "Guest", attribution: { method: "manual" } })
      expect(out.payload.motion).toBe("glide")
      expect(Object.keys(out.payload).filter((k) => !PLUGIN_PAYLOAD_KEYS.has(k))).toEqual([])
    })

    it("keeps a motion the person chose", async () => {
      expect((await builtTracked(tracked({ motion: "static" }))).payload.motion).toBe("static")
    })

    it("never sends a motion without tracks (v1 exactly)", () => {
      const out = built(canvas({ motion: "static" }))
      expect("motion" in out.payload).toBe(false)
      expect("tracks" in out.payload).toBe(false)
    })

    it("refuses a camera whose offset changed since Speaker Frames ran (P3-20, the app's check)", async () => {
      const moved = { input_data: { edl: { ...EDL, sources: EDL.sources.map((s) => (s.id === "camB" ? { ...s, offsetMs: 0 } : s)) } }, output_data: { json: TRACKS } }
      await expect(builtTracked(tracked(), { ...deps, loadFramesJob: async () => moved })).rejects.toThrow(/Face tracks for "camB" were made with the camera at offset 0 ms; it is now at 4000 ms/)
    })

    it("refuses a tracks wire whose Speaker Frames has no output — never a silent v1 render (§5)", async () => {
      const g = tracked({}, { generatedJson: undefined })
      delete g.states.sf
      const inputs = resolveNodeInputs(g.nodes.find((n) => n.id === SV)!, g.edges, g.states, g.nodes)
      expect(inputs.tracks).toBeNull()
      await expect(builtTracked(g)).rejects.toThrow(SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE)
    })

    it("refuses when the wired Speaker Frames failed", async () => {
      const g = tracked({}, { generatedJson: undefined })
      g.states.sf = { status: "failed", error: "boom" } as unknown as NodeExecutionState
      await expect(builtTracked(g)).rejects.toThrow(SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE)
    })

    it("reads tracks only from the wire: an inline `tracks` on the node is ignored (as the editor's run ignores it)", async () => {
      const g = canvas({ quality: "proxy", tracks: TRACKS }, { transcript: RENAMED })
      const out = await builtTracked(g)
      expect("tracks" in out.payload).toBe(false)
      expect("motion" in out.payload).toBe(false)
    })

    it("refuses tracks no Speaker Frames run of this account made", async () => {
      await expect(builtTracked(tracked(), { ...deps, loadFramesJob: async () => null })).rejects.toThrow(/not from a Speaker Frames run on this account/)
    })

    it("refuses a followed camera the tracks never sampled where the edit reads it", async () => {
      const bare = { ...TRACKS, sources: [TRACKS.sources[0]!, { ...TRACKS.sources[1]!, sampledSpans: [{ startMs: 200_000, endMs: 210_000 }] }] }
      const g = tracked()
      g.states.sf = { status: "completed", output: { json: bare } } as unknown as NodeExecutionState
      await expect(builtTracked(g, { ...deps, loadFramesJob: async () => ({ ...framesJob, output_data: { json: bare } }) })).rejects.toThrow(/Face tracks don't cover "camB"/)
    })

    it("stamps a basis that a relabel or a motion change moves, and an untracked render keeps", async () => {
      const a = (await builtTracked(tracked())).payload.renderBasis
      expect((await builtTracked(tracked({ motion: "static" }))).payload.renderBasis).not.toBe(a)
      expect((await builtTracked(tracked({}, { trackAssignments: [{ trackId: "camB/t1", speaker: "Host" }] }))).payload.renderBasis).not.toBe(a)
      expect(built(canvas({ quality: "proxy" }, { transcript: RENAMED })).payload.renderBasis).not.toBe(a)
    })
  })
})

// Speaker View's Video input (decided 2026-10-11): a bare video instead of an
// edit. The same resolver, the same builder and the same rule the canvas run
// reads (`speakerViewVideoEdit`), over a length measured once upstream (D16).
describe("Video input: a bare video instead of an edit", () => {
  const VIDEO = "https://cdn.example.test/uploads/videos/clip.mp4"
  const CLIP = { durationMs: 14_600, width: 3840, height: 2160 }
  const TWO = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Alex" }, { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "Sam" }] }

  function videoCanvas(data: Record<string, unknown> = {}, opts: { transcript?: unknown; withTranscript?: boolean; withEdl?: boolean } = {}) {
    const nodes: SimpleNode[] = [
      { id: "up", type: "upload-video", data: { label: "Video", url: VIDEO } },
      { id: "tx", type: "transcribe", data: { label: "Transcribe" } },
      { id: "plan", type: "edit-plan", data: { label: "Plan", generatedJson: EDL } },
      { id: SV, type: "speaker-view", data: { label: "Speaker View", ...data } },
    ]
    const edges: SimpleEdge[] = [
      { id: "e1", source: "up", target: SV, sourceHandle: "video", targetHandle: "video" },
      ...(opts.withTranscript === false ? [] : [{ id: "e2", source: "tx", target: SV, sourceHandle: "json", targetHandle: "transcript" } as SimpleEdge]),
      ...(opts.withEdl ? [{ id: "e3", source: "plan", target: SV, sourceHandle: "edl", targetHandle: "edl" } as SimpleEdge] : []),
    ]
    const states: Record<string, NodeExecutionState> = {
      up: { status: "completed", output: { videoUrl: VIDEO } } as unknown as NodeExecutionState,
      tx: { status: "completed", output: { json: opts.transcript ?? TWO } } as unknown as NodeExecutionState,
      plan: { status: "completed", output: { json: EDL } } as unknown as NodeExecutionState,
    }
    return { nodes, edges, states }
  }
  const builtVideo = (g: ReturnType<typeof videoCanvas>, clip: Record<string, unknown> | null = CLIP) => {
    const node = g.nodes.find((n) => n.id === SV)!
    return buildPayload(node, "job-1", resolveNodeInputs(node, g.edges, g.states, g.nodes), "usage-1", {
      nodes: g.nodes, edges: g.edges, nodeStates: g.states, listRow: undefined,
      ...(clip ? { speakerViewClip: clip as never } : {}),
    })
  }

  it("routes the wired video onto the generic video lane Speaker Frames' bare video takes, the same string the upload emits", () => {
    const g = videoCanvas()
    const inputs = resolveNodeInputs(g.nodes.find((n) => n.id === SV)!, g.edges, g.states, g.nodes)
    expect(inputs.videoUrl).toBe(VIDEO)
    expect(inputs.edl).toBeUndefined()
    expect(JSON.parse(inputs.transcript as string)).toEqual(TWO)
  })

  it("carries the corrections \"Which face is …?\" saved on Speaker Frames into a video-fed Speaker View (tap-first, decided 2026-10-13)", () => {
    const tracks = { version: 1, sampleFps: 2, detector: { id: "yunet" }, url: "https://media.example/speaker-tracks/j.json", sha256: "e".repeat(64), bytes: 10,
      sources: [{ sourceId: "video", clock: "source", frame: { w: 640, h: 360 }, sampledSpans: [{ startMs: 0, endMs: 14_000 }], tracks: [{ id: "video/t1", boxCount: 4 }] }] }
    const corrections = [{ trackId: "video/t1", speaker: "Sam", rawSpeaker: "Sam" }]
    const g = videoCanvas()
    g.nodes.push({ id: "sf", type: "speaker-frames", data: { label: "Speaker Frames", generatedJson: tracks, trackAssignments: corrections } })
    g.edges.push({ id: "e8", source: "sf", target: SV, sourceHandle: "tracks", targetHandle: "tracks" } as SimpleEdge)
    g.states.sf = { status: "completed", output: { json: tracks } } as unknown as NodeExecutionState
    const inputs = resolveNodeInputs(g.nodes.find((n) => n.id === SV)!, g.edges, g.states, g.nodes)
    expect(inputs.videoUrl).toBe(VIDEO)
    expect(JSON.parse(inputs.tracks as string)).toEqual(tracks)
    expect(inputs.trackAssignments).toEqual(corrections)
  })

  it("hands Speaker View and Speaker Frames the SAME string for one upload: the tracks' file check compares them byte for byte", () => {
    const g = videoCanvas()
    g.nodes.push({ id: "sf", type: "speaker-frames", data: { label: "Speaker Frames" } })
    g.edges.push({ id: "e9", source: "up", target: "sf", sourceHandle: "video", targetHandle: "video" } as SimpleEdge)
    const forView = resolveNodeInputs(g.nodes.find((n) => n.id === SV)!, g.edges, g.states, g.nodes)
    const forFrames = resolveNodeInputs(g.nodes.find((n) => n.id === "sf")!, g.edges, g.states, g.nodes)
    expect(forView.videoUrl).toBe(forFrames.videoUrl)
    expect(typeof forView.videoUrl).toBe("string")
  })

  it("is closed while Speaker View is unpriced (R15), and says so before it asks for a clip", () => {
    expect(() => builtVideo(videoCanvas(), null)).toThrow(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE)
  })

  it("R15: Speaker View priced but Speaker Frames not: still closed, before it asks for a clip", () => {
    flag.priced = true
    flag.frames = false
    expect(() => builtVideo(videoCanvas(), null)).toThrow(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE)
    expect(() => builtVideo(videoCanvas())).toThrow(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE)
  })

  it("R15: with face tracks wired and Speaker Frames not run, says only that video mode is not open — never \"run Speaker Frames first\", which cannot run", async () => {
    flag.priced = true
    flag.frames = false
    const g = videoCanvas()
    g.nodes.push({ id: "sf", type: "speaker-frames", data: { label: "Speaker Frames" } })
    g.edges.push({ id: "e8", source: "sf", target: SV, sourceHandle: "tracks", targetHandle: "tracks" } as SimpleEdge)
    const node = g.nodes.find((n) => n.id === SV)!
    const inputs = resolveNodeInputs(node, g.edges, g.states, g.nodes)
    // The executor's own glue (node-executor → resolveSpeakerViewTracksOfNode), as a run reads the wire.
    const speakerViewTracks = await resolveSpeakerViewTracksOfNode(node, inputs, { loadFramesJob: async () => null, readTrackBody: async () => { throw new Error("not needed") } })
    expect(speakerViewTracks).toMatchObject({ unproduced: true })
    const build = () => buildPayload(node, "job-1", inputs, "usage-1", { nodes: g.nodes, edges: g.edges, nodeStates: g.states, listRow: undefined, speakerViewClip: CLIP as never, ...(speakerViewTracks ? { speakerViewTracks } : {}) })
    expect(build).toThrow(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE)
    expect(build).not.toThrow(SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE)
  })

  it("R15: an edit-driven Speaker View is not behind the video gate", () => {
    flag.priced = true
    flag.frames = false
    const g = videoCanvas({}, { withEdl: true })
    const editOnly = { ...g, edges: g.edges.filter((e) => e.targetHandle !== "video") }
    expect(builtVideo(editOnly, null).payload.edl).toBeDefined()
  })

  describe("once priced", () => {
    beforeEach(() => { flag.priced = true })

    it("builds the plugin's job from the whole-clip edit over the measured length", () => {
      const out = builtVideo(videoCanvas({ quality: "proxy" }))
      expect(isWholeClipEdl(out.payload.edl)).toBe(true)
      expect(out.payload.edl).toEqual((speakerViewVideoEdit({ url: VIDEO, clip: CLIP, transcript: TWO }) as { edl: unknown }).edl)
      expect(out.payload).toMatchObject({ quality: "proxy", reservedCreditId: "speaker-view:proxy" })
      expect((out.payload.edl as { meta: { targetAspect: string } }).meta.targetAspect).toBe("9:16")
      const edl = out.payload.edl as { sources: Array<{ speakers?: string[] }>; segments: Array<{ outMs: number }> }
      expect(edl.segments[0]?.outMs).toBe(14_600)
      expect(edl.sources[0]?.speakers).toEqual(["Alex", "Sam"])
    })

    it("draws at the node's own aspect when it has one", () => {
      const out = builtVideo(videoCanvas({ targetAspect: "1:1" }))
      expect(out.payload.targetAspect).toBe("1:1")
      expect((out.payload.edl as { meta: { targetAspect: string } }).meta.targetAspect).toBe("1:1")
    })

    it("seeds Cut and 9:16 for a node written straight into the graph (D14): nothing is sent that would Pan", () => {
      const out = builtVideo(videoCanvas())
      // The plugin reads the aspect off the edit's own meta when the request names none.
      expect((out.payload.edl as { meta: { targetAspect: string } }).meta.targetAspect).toBe("9:16")
      expect((out.payload.switch as { type?: string } | undefined)?.type ?? "cut").toBe("cut")
    })

    it("writes only keys the plugin's job payload declares", () => {
      const stray = Object.keys(builtVideo(videoCanvas()).payload).filter((k) => !PLUGIN_PAYLOAD_KEYS.has(k))
      expect(stray).toEqual([])
    })

    it("refuses an edit and a video together, in a plain sentence", () => {
      expect(() => builtVideo(videoCanvas({}, { withEdl: true }))).toThrow(/not both/i)
    })

    it("requires the transcript (D3): Transcribe with speaker detection", () => {
      expect(() => builtVideo(videoCanvas({}, { withTranscript: false }))).toThrow(/Transcribe.*speaker detection/)
      expect(() => builtVideo(videoCanvas({}, { transcript: { version: 1, words: [{ text: "x", startMs: 0, endMs: 1 }] } }))).toThrow(/no speaker labels/)
    })

    it("refuses a clip that was not measured", () => {
      expect(() => builtVideo(videoCanvas(), null)).toThrow(/length was not measured/)
    })

    it("D18: refuses a source at or narrower than the target, before any charge", () => {
      expect(() => builtVideo(videoCanvas(), { durationMs: 5_000, width: 1080, height: 1920 })).toThrow(/1080×1920/)
    })

    // F6 (decided 2026-10-12): with no Edit Plan behind it the plan stamps are simply
    // absent, and the stop rule reads the render like any other.
    it("degrades cleanly with no Edit Plan: no clipKey and no planBasis on the job, and the build does not throw", () => {
      const out = builtVideo(videoCanvas({ quality: "proxy" }))
      expect(out.payload).not.toHaveProperty("clipKey")
      expect(out.payload).not.toHaveProperty("planBasis")
    })

    it("the stop rule reads a Preview video-fed Speaker View like any Preview render, and a Final one as nothing", () => {
      const caption = { id: "cap", type: "add-captions", data: { label: "Captions" } } as SimpleNode
      const tail = (g: ReturnType<typeof videoCanvas>) => ({
        nodes: [...g.nodes.filter((n) => n.id !== "plan"), caption],
        edges: [...g.edges, { id: "e9", source: SV, target: "cap", sourceHandle: "video", targetHandle: "video" } as SimpleEdge],
      })
      const preview = tail(videoCanvas({ quality: "proxy" }))
      const stops = runPreviewStops(preview.nodes, preview.edges, { nodeSubset: null })
      expect(stops.previewRenderIds).toEqual([SV])
      expect([...stops.gatedNodeIds]).toEqual(["cap"])
      const final = tail(videoCanvas({ quality: "final" }))
      const none = runPreviewStops(final.nodes, final.edges, { nodeSubset: null })
      expect(none.previewRenderIds).toEqual([])
      expect([...none.gatedNodeIds]).toEqual([])
    })

    it("R2: a node that opts in refuses a clip the detector found no face in, at its own dispatch; one that does not renders", () => {
      const faceless = { ...CLIP, faces: "none" }
      expect(() => builtVideo(videoCanvas({ requireFaces: true }), faceless)).toThrow(/no faces/i)
      expect(() => builtVideo(videoCanvas({}), faceless)).not.toThrow()
      // Could not look: never a refusal.
      expect(() => builtVideo(videoCanvas({ requireFaces: true }), { ...CLIP, faces: "unknown" })).not.toThrow()
    })

    it("writes no speakers on the source for a single label (D15)", () => {
      const one = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Alex" }] }
      const edl = builtVideo(videoCanvas({}, { transcript: one })).payload.edl as { sources: Array<{ speakers?: string[] }> }
      expect(edl.sources[0]?.speakers).toBeUndefined()
    })
  })
})
