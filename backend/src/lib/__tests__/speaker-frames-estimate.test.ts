// @test-units-by-name estimates only speaker-frames nodes
/**
 * What a Speaker Frames run is ESTIMATED at before it runs (P3.7, decided
 * 2026-10-16): `speakerFramesEstimateBlocks`, the one rule the editor's pill,
 * Run button, confirm and precheck and the server's run quote and listing all
 * read. It leans high: the edit wired in when it is known now, a video's
 * recorded length, else the ceiling of 180 minutes on each of 6 cameras
 * (130 blocks). The reserve counts
 * the run's own frames on the server, and the charge the frames it sampled.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => false,
}))

import type { Edl } from "@nodaro/shared/edl"
import { SPEAKER_FRAMES_CEILING_BLOCKS, editPlanProducerKind, editPlanSourceKind, speakerFramesBlocks, speakerFramesEstimateBlocks } from "@nodaro/render-rules"
import { CreditsService } from "../../ee/billing/credits.js"

const MIC = { id: "mic", url: "https://media.test/mic.wav", kind: "audio" as const, role: "master-audio" }
const cam = (id: string) => ({ id, url: `https://media.test/${id}.mp4`, kind: "video" as const })
/** Two cameras over 10 minutes: 1,204 frames each (2,408 → 3 blocks; one camera → 2). */
const TWO_CAMS: Edl = {
  version: 1,
  clock: "master",
  sources: [MIC, cam("a"), cam("b")],
  segments: [{ id: "s0", inMs: 0, outMs: 300_000, video: "a" }, { id: "s1", inMs: 300_000, outMs: 600_000, video: "b" }],
} as Edl
const clip = (startMs: number): Edl =>
  ({ version: 1, clock: "master", sources: [MIC, cam("a")], segments: [{ id: "s0", inMs: startMs, outMs: startMs + 56_000, video: "a" }] }) as Edl

const NONE: ReadonlySet<string> = new Set()
const sf = (data: Record<string, unknown> = {}) => ({ id: "sf", type: "speaker-frames", data })
const edlEdge = (source: string) => ({ source, target: "sf", targetHandle: "edl" })

describe("speakerFramesEstimateBlocks", () => {
  it("the ceiling is 180 minutes on each of 6 cameras: 129,600 frames, 130 blocks", () => {
    expect(SPEAKER_FRAMES_CEILING_BLOCKS).toBe(130)
  })

  it("a Camera Switch that holds its edit now and does not re-run: that edit's frames on the ticked cameras", () => {
    const cs = { id: "cs", type: "camera-switch", data: { generatedJson: { edl: TWO_CAMS, transcript: {} } } }
    expect(speakerFramesEstimateBlocks(sf(), [cs, sf()], [edlEdge("cs")], NONE)).toBe(3)
    const unticked = sf({ excludeSourceIds: ["b"] })
    expect(speakerFramesEstimateBlocks(unticked, [cs, unticked], [edlEdge("cs")], NONE)).toBe(2)
  })

  it("a clip batch Camera Switch ran once per clip is ONE run over their union", () => {
    // Each run's `edl` output, as the batch holds it (a JSON string; an empty entry delivered nothing).
    const cs = { id: "cs", type: "camera-switch", data: { __listResults: [...Array.from({ length: 8 }, (_, i) => JSON.stringify(clip(i * 100_000 + 10_000))), ""] } }
    expect(speakerFramesEstimateBlocks(sf(), [cs, sf()], [edlEdge("cs")], NONE)).toBe(1)
  })

  it("a producer that re-runs in this run, or holds nothing yet: the ceiling", () => {
    const cs = { id: "cs", type: "camera-switch", data: { generatedJson: { edl: TWO_CAMS } } }
    expect(speakerFramesEstimateBlocks(sf(), [cs, sf()], [edlEdge("cs")], new Set(["cs"]))).toBe(130)
    const empty = { id: "cs", type: "camera-switch", data: {} }
    expect(speakerFramesEstimateBlocks(sf(), [empty, sf()], [edlEdge("cs")], NONE)).toBe(130)
  })

  it("a video instead of an edit: its recorded length at 2 fps, as Speaker View reads it (decided 2026-10-16)", () => {
    const videoIn = (source: string) => [{ source, target: "sf", targetHandle: "video" }]
    // The docs' examples: 14 s → 28 frames, 1 block; 45 min → 5,400 frames, 6 blocks.
    const short = { id: "up", type: "upload-video", data: { url: "https://media.test/clip.mp4", duration: 14 } }
    expect(speakerFramesEstimateBlocks(sf(), [short, sf()], videoIn("up"), NONE)).toBe(1)
    const long = { id: "up", type: "upload-video", data: { url: "https://media.test/ep.mp4", duration: 45 * 60 } }
    expect(speakerFramesEstimateBlocks(sf(), [long, sf()], videoIn("up"), NONE)).toBe(6)
    // A Trim passes on its own length: keep the first 30 s of the 45-minute upload → 60 frames, 1 block.
    const trim = { id: "tr", type: "trim-video", data: { trimMode: "keep-first-seconds", keepFirstSeconds: 30 } }
    expect(speakerFramesEstimateBlocks(sf(), [long, trim, sf()], [{ source: "up", target: "tr", targetHandle: "in" }, ...videoIn("tr")], NONE)).toBe(1)
    // At most 180 minutes (a longer video is refused before any reserve).
    const huge = { id: "up", type: "upload-video", data: { url: "https://media.test/x.mp4", duration: 200 * 60 } }
    expect(speakerFramesEstimateBlocks(sf(), [huge, sf()], videoIn("up"), NONE)).toBe(22)
  })

  it("a video whose length is not known before the run: the ceiling", () => {
    const link = { id: "up", type: "upload-video", data: { url: "https://media.test/clip.mp4" } }
    expect(speakerFramesEstimateBlocks(sf(), [link, sf()], [{ source: "up", target: "sf", targetHandle: "video" }], NONE)).toBe(130)
  })

  it("nothing wired: an edit set on the node itself, else one block (the run is refused before it reserves)", () => {
    expect(speakerFramesEstimateBlocks(sf({ edl: TWO_CAMS }), [], [], NONE)).toBe(3)
    expect(speakerFramesEstimateBlocks(sf(), [], [], NONE)).toBe(1)
  })
})

describe("an edit a plan is about to make (decided 2026-10-17)", () => {
  // A recording's probed length, as a use-case builder's upload node carries it.
  const up = (id: string, sec?: number, type = "upload-video", data: Record<string, unknown> = {}) => ({ id, type, data: { ...(sec ? { metadata: { durationSeconds: sec } } : {}), ...data } })
  const fr = sf()
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ source, sourceHandle, target, targetHandle })
  const plan = (data: Record<string, unknown> = {}) => ({ id: "plan", type: "edit-plan", data })
  const tx = { id: "tx", type: "transcribe", data: {} }
  /** The plan's transcript, made by a Transcribe from `id` (the plugin plans over the transcript's end). */
  const heard = (id: string, handle = "video") => [wire(id, handle, "tx", "audio"), wire("tx", "json", "plan", "transcript")]
  const toFrames = wire("plan", "edl", "sf", "edl")
  /** A Run: the Transcribe and the plan run again. */
  const PLAN = new Set(["tx", "plan"])
  // The scope samples the kept MASTER spans on every video source, padded 2 s
  // each side and clamped only at zero: per video source, at most the episode
  // plus 4 s — 3,600 s → (3,600 + 4) × 2 = 7,208 frames.
  const HOUR_FRAMES = (3600 + 4) * 2

  it("one recording of known length: the episode at 2 fps, never the ceiling", () => {
    const nodes = [up("v", 3600), tx, plan({ mode: "tighten" }), fr]
    const edges = [wire("v", "video", "plan", "sources"), ...heard("v"), toFrames]
    expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(speakerFramesBlocks(HOUR_FRAMES)) // 8
    expect(speakerFramesBlocks(HOUR_FRAMES)).toBe(8)
  })

  it("the 2 s margins count, as the reserve counts them: a 499 s episode is 1,006 frames, 2 blocks", () => {
    const nodes = [up("v", 499), tx, plan(), fr]
    const edges = [wire("v", "video", "plan", "sources"), ...heard("v"), toFrames]
    expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(2)
  })

  it("through Camera Switch, over every camera the plan reads; an audio master is not sampled", () => {
    const nodes = [up("a", 3600), up("b", 3600), up("m", 3600, "upload-audio"), tx, plan({ sourceConfig: { m: { role: "master-audio" } } }), { id: "sw", type: "camera-switch", data: {} }, fr]
    const edges = [wire("a", "video", "plan", "sources"), wire("b", "video", "plan", "sources"), wire("m", "audio", "plan", "sources"), ...heard("m", "audio"), wire("plan", "edl", "sw", "edl"), wire("sw", "edl", "sf", "edl")]
    expect(speakerFramesEstimateBlocks(fr, nodes, edges, new Set(["tx", "plan", "sw"]))).toBe(speakerFramesBlocks(2 * HOUR_FRAMES)) // 15
  })

  it("a camera whose own mic is the master is still a video the run samples", () => {
    const nodes = [up("a", 3600), up("b", 3600), tx, plan({ sourceConfig: { a: { role: "master-audio" } } }), fr]
    const edges = [wire("a", "video", "plan", "sources"), wire("b", "video", "plan", "sources"), ...heard("a"), toFrames]
    expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(speakerFramesBlocks(2 * HOUR_FRAMES)) // 15, not 8
  })

  it("a camera shorter than the episode is bounded by the episode: the reserve counts the master's spans on it", () => {
    const nodes = [up("a", 1800), up("m", 3600, "upload-audio"), tx, plan({ sourceConfig: { m: { role: "master-audio" } } }), fr]
    const edges = [wire("a", "video", "plan", "sources"), wire("m", "audio", "plan", "sources"), ...heard("m", "audio"), toFrames]
    expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(8) // not 4, its own 30 minutes
  })

  it("a recording behind a teleport is read at its origin", () => {
    const nodes = [up("a", 3600), { id: "ts", type: "teleport-send", data: {} }, { id: "tr", type: "teleport-receive", data: {} }, tx, plan(), fr]
    const edges = [wire("a", "video", "ts", "in"), wire("ts", "out", "tr", "in"), wire("tr", "out", "plan", "sources"), ...heard("a"), toFrames]
    expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(8)
  })

  it("at most 180 minutes a source, as the scope refuses past it", () => {
    const nodes = [up("v", 200 * 60), tx, plan(), fr]
    const edges = [wire("v", "video", "plan", "sources"), ...heard("v"), toFrames]
    expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(speakerFramesBlocks((180 * 60 + 4) * 2)) // 22
  })

  it("a recording of unknown length, or a plan with no video source, still prices the ceiling", () => {
    const edges = [wire("v", "video", "plan", "sources"), ...heard("v"), toFrames]
    expect(speakerFramesEstimateBlocks(fr, [up("v"), tx, plan(), fr], edges, PLAN)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    const audioEdges = [wire("v", "audio", "plan", "sources"), ...heard("v", "audio"), toFrames]
    expect(speakerFramesEstimateBlocks(fr, [up("v", 3600, "upload-audio"), tx, plan(), fr], audioEdges, PLAN)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    expect(speakerFramesEstimateBlocks(fr, [plan(), fr], [toFrames], PLAN)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
  })

  describe("camera or sound-only: exactly the run's rule (the kind set on the source, then the producer)", () => {
    it("is the one rule both run engines build Edit Plan's sources with", () => {
      expect(editPlanProducerKind("upload-video")).toBe("video")
      expect(editPlanProducerKind("upload-audio")).toBe("audio")
      expect(editPlanProducerKind("adjust-volume")).toBe("audio")
      expect(editPlanProducerKind("list")).toBe("video")
      expect(editPlanProducerKind(undefined)).toBe("video")
      expect(editPlanSourceKind("video", "audio")).toBe("video")
      expect(editPlanSourceKind("audio", "video")).toBe("audio")
      expect(editPlanSourceKind("image", "audio")).toBe("audio")
      expect(editPlanSourceKind(undefined, "video")).toBe("video")
    })

    it("a sound file the plan's source settings mark as video is sampled", () => {
      const nodes = [up("a", 3600), up("m", 3600, "upload-audio"), tx, plan({ sourceConfig: { m: { role: "master-audio", kind: "video" } } }), fr]
      const edges = [wire("a", "video", "plan", "sources"), wire("m", "audio", "plan", "sources"), ...heard("m", "audio"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(15)
    })

    it("a camera the source settings mark as audio is not", () => {
      const nodes = [up("a", 3600), up("b", 3600), tx, plan({ sourceConfig: { a: { kind: "audio" } } }), fr]
      const edges = [wire("a", "video", "plan", "sources"), wire("b", "video", "plan", "sources"), ...heard("a"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(8)
    })

    it("a List set to hand on audio is still a video to the run (it is no audio producer)", () => {
      const list = { id: "l", type: "list", data: { output: "audio", metadata: { durationSeconds: 3600 } } }
      const nodes = [up("a", 3600), list, tx, plan(), fr]
      const edges = [wire("a", "video", "plan", "sources"), wire("l", "output", "plan", "sources"), ...heard("a"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(15)
    })

    it("a camera handed on through Adjust Volume is sound-only to the run, so it is not sampled", () => {
      const vol = { id: "vol", type: "adjust-volume", data: {} }
      const nodes = [up("a", 3600), vol, up("b", 3600), up("m", 3600, "upload-audio"), tx, plan({ sourceConfig: { m: { role: "master-audio" } } }), fr]
      const edges = [wire("a", "video", "vol", "video"), wire("vol", "video", "plan", "sources"), wire("b", "video", "plan", "sources"), wire("m", "audio", "plan", "sources"), ...heard("m", "audio"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(8) // b only
    })
  })

  describe("the episode's length must be what this run plans over", () => {
    it("a master behind a step that runs again is not read at its saved length (saved 1,800 s, about to make 3,600 s)", () => {
      const trim = { id: "t", type: "trim-video", data: { generatedResults: [{ duration: 1800 }] } }
      const nodes = [trim, tx, plan(), fr]
      const edges = [wire("t", "video", "plan", "sources"), ...heard("t"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, new Set(["t", "tx", "plan"]))).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
      // Held (not running again), it hands on what it holds: 1,800 s → 3,608 frames, 4 blocks.
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(4)
    })

    it("an upload is read at its length even in a whole-workflow quote that counts it among the running nodes", () => {
      const nodes = [up("v", 3600), tx, plan(), fr]
      const edges = [wire("v", "video", "plan", "sources"), ...heard("v"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, new Set(["v", "tx", "plan", "sf"]))).toBe(8)
    })

    it("a transcript not made by a Transcribe here: the ceiling (the plugin plans over the transcript's end)", () => {
      const doc = { id: "doc", type: "text-prompt", data: { text: "{}" } }
      const nodes = [up("v", 3600), doc, plan(), fr]
      const edges = [wire("v", "video", "plan", "sources"), wire("doc", "text", "plan", "transcript"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
      expect(speakerFramesEstimateBlocks(fr, [up("v", 3600), plan(), fr], [wire("v", "video", "plan", "sources"), toFrames], PLAN)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    })

    it("a Transcribe over media of unknown length: the ceiling", () => {
      const nodes = [up("v", 3600), up("other"), tx, plan(), fr]
      const edges = [wire("v", "video", "plan", "sources"), ...heard("other"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    })

    it("a Transcribe that does not run again: the end of the transcript it holds, not its recording's length now", () => {
      // It was made from a 7,200 s recording and is now wired to the 3,600 s master;
      // Run from Edit Plan: the plan works over the held transcript's 7,200 s.
      const held = { id: "tx", type: "transcribe", data: { generatedResults: [{ transcript: { words: [{ text: "x", startMs: 7_100_000, endMs: 7_200_000 }] } }] } }
      const nodes = [up("m", 3600, "upload-audio"), up("cam", 7200), held, plan({ sourceConfig: { m: { role: "master-audio" } } }), fr]
      const edges = [wire("m", "audio", "plan", "sources"), wire("cam", "video", "plan", "sources"), ...heard("m", "audio"), toFrames]
      const hold = speakerFramesBlocks((7200 + 4) * 2) // 15: the reserve over [0, 7,200 s] on the one camera
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, new Set(["plan", "sf"]))).toBe(hold)
      // The bare active-result field and a JSON string are read alike.
      const bare = { ...held, data: { generatedJson: JSON.stringify({ words: [{ text: "x", startMs: 7_100_000, endMs: 7_200_000 }] }) } }
      expect(speakerFramesEstimateBlocks(fr, [nodes[0], nodes[1], bare, nodes[3], fr], edges, new Set(["plan", "sf"]))).toBe(hold)
      // Running again, it transcribes the master now wired: 3,600 s.
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, new Set(["tx", "plan", "sf"]))).toBe(8)
    })

    it("a Transcribe that does not run again and holds no readable transcript: the ceiling", () => {
      const nodes = [up("v", 3600), tx, plan(), fr]
      const edges = [wire("v", "video", "plan", "sources"), ...heard("v"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, new Set(["plan"]))).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    })

    it("a transcript made from a longer recording than the master: the longer one", () => {
      const nodes = [up("a", 3600), up("m", 1800, "upload-audio"), tx, plan({ sourceConfig: { m: { role: "master-audio" } } }), fr]
      const edges = [wire("a", "video", "plan", "sources"), wire("m", "audio", "plan", "sources"), ...heard("a"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(8) // not 4
    })
  })

  it("a Camera Switch that re-runs over a plan that holds its edit and does not: that edit, exactly", () => {
    const nodes = [up("a", 3600), plan({ generatedJson: TWO_CAMS }), { id: "sw", type: "camera-switch", data: {} }, fr]
    const edges = [wire("a", "video", "plan", "sources"), wire("plan", "edl", "sw", "edl"), wire("sw", "edl", "sf", "edl")]
    expect(speakerFramesEstimateBlocks(fr, nodes, edges, new Set(["sw"]))).toBe(3)
  })

  it("a re-running Camera Switch with no plan upstream still prices the ceiling", () => {
    const nodes = [{ id: "sw", type: "camera-switch", data: {} }, fr]
    expect(speakerFramesEstimateBlocks(fr, nodes, [wire("sw", "edl", "sf", "edl")], new Set(["sw"]))).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
  })

  it("a held edit and a planned one on the same handle are ONE run: frames add, then round to blocks once", () => {
    const cs = { id: "cs", type: "camera-switch", data: { generatedJson: { edl: TWO_CAMS, transcript: {} } } }
    const nodes = [up("v", 3600), tx, plan(), cs, fr]
    const edges = [wire("v", "video", "plan", "sources"), ...heard("v"), toFrames, wire("cs", "edl", "sf", "edl")]
    // TWO_CAMS samples 2,408 frames: 2,408 + 7,208 = 9,616 → 10 blocks (not 3 + 8 = 11).
    expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(10)
  })

  it("a plan that has not run and is not about to (the node's own pill) is not planned: the ceiling", () => {
    const nodes = [up("v", 3600), tx, plan(), fr]
    const edges = [wire("v", "video", "plan", "sources"), ...heard("v"), toFrames]
    expect(speakerFramesEstimateBlocks(fr, nodes, edges, NONE)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
  })
})

describe("the server's run quote reads the same rule", () => {
  const up = { id: "up", type: "upload-video", data: { url: "https://media.test/clip.mp4" } }

  it("a video of unknown length quotes the 130-block ceiling at 2 a block; a recorded one its own blocks", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([up, sf()], [{ source: "up", target: "sf", targetHandle: "video" }])).toBe(260)
    const recorded = { ...up, data: { ...up.data, duration: 14 } }
    expect(CreditsService.estimateWorkflowBaseCredits([recorded, sf()], [{ source: "up", target: "sf", targetHandle: "video" }])).toBe(2)
  })

  it("a known edit quotes its own blocks; no wiring sent at all quotes the ceiling", () => {
    const cs = { id: "cs", type: "camera-switch", data: { generatedJson: { edl: TWO_CAMS } } }
    const rerunsNothing = CreditsService.estimateWorkflowBaseCredits([cs, sf()], [edlEdge("cs")])
    // Camera Switch itself runs in a whole-workflow estimate, so the edit is the ceiling's…
    expect(rerunsNothing).toBeGreaterThanOrEqual(260)
    expect(CreditsService.estimateWorkflowBaseCredits([sf()], undefined)).toBe(260)
    expect(CreditsService.estimateWorkflowBaseCredits([sf({ edl: TWO_CAMS })], undefined)).toBe(6)
  })
})
