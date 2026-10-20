// @test-units-by-name estimates only speaker-frames nodes
/**
 * What a Speaker Frames run is ESTIMATED at before it runs (P3.7, decided
 * 2026-10-16): `speakerFramesEstimateBlocks`, the one rule the editor's pill,
 * Run button, confirm and precheck and the server's run quote and listing all
 * read. It leans high: the edit wired in when it is known now, a video's
 * recorded length; a length not known before the run is 180 minutes on each
 * camera the run will frame (decided 2026-10-20: one for a video, the cameras
 * a plan or map reads, at most 6); else the ceiling of 180 minutes on each of
 * 6 cameras (130 blocks). The reserve counts
 * the run's own frames on the server, and the charge the frames it sampled.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => false,
}))

import type { Edl } from "@nodaro/shared/edl"
import { MULTICAM_SPEAKER_MAP_TYPE, SPEAKER_FRAMES_CEILING_BLOCKS, editPlanProducerKind, editPlanSourceKind, speakerFramesBlocks, speakerFramesCeilingBlocks, speakerFramesEstimateBlocks } from "@nodaro/render-rules"
import { CreditsService } from "../../ee/billing/credits.js"
import { speakerFramesReserveFrames } from "../speaker-frames-plan.js"

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

  it("a video whose length is not known before the run: 180 minutes on its one camera, 22 blocks (decided 2026-10-20)", () => {
    const link = { id: "up", type: "upload-video", data: { url: "https://media.test/clip.mp4" } }
    expect(speakerFramesEstimateBlocks(sf(), [link, sf()], [{ source: "up", target: "sf", targetHandle: "video" }], NONE)).toBe(22)
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

  it("a recording of unknown length: 180 minutes on its one camera (decided 2026-10-20); a plan with no video source still prices the ceiling", () => {
    const edges = [wire("v", "video", "plan", "sources"), ...heard("v"), toFrames]
    expect(speakerFramesEstimateBlocks(fr, [up("v"), tx, plan(), fr], edges, PLAN)).toBe(22)
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
      // Its length this run is not known: 180 minutes on the plan's one camera.
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, new Set(["t", "tx", "plan"]))).toBe(22)
      // Held (not running again), it hands on what it holds: 1,800 s → 3,608 frames, 4 blocks.
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(4)
    })

    it("an upload is read at its length even in a whole-workflow quote that counts it among the running nodes", () => {
      const nodes = [up("v", 3600), tx, plan(), fr]
      const edges = [wire("v", "video", "plan", "sources"), ...heard("v"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, new Set(["v", "tx", "plan", "sf"]))).toBe(8)
    })

    it("a transcript not made by a Transcribe here: the ceiling (the plugin plans over the transcript's end, which no recording bounds)", () => {
      const doc = { id: "doc", type: "text-prompt", data: { text: "{}" } }
      const nodes = [up("v", 3600), doc, plan(), fr]
      const edges = [wire("v", "video", "plan", "sources"), wire("doc", "text", "plan", "transcript"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
      expect(speakerFramesEstimateBlocks(fr, [up("v", 3600), plan(), fr], [wire("v", "video", "plan", "sources"), toFrames], PLAN)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    })

    it("a Transcribe over media of unknown length that is not a source: the ceiling (its transcript may outrun every camera)", () => {
      const nodes = [up("v", 3600), up("other"), tx, plan(), fr]
      const edges = [wire("v", "video", "plan", "sources"), ...heard("other"), toFrames]
      expect(speakerFramesEstimateBlocks(fr, nodes, edges, PLAN)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    })

    it("length unknown: 180 minutes a camera only when the Transcribe hears the plan's master; a non-master recording keeps the ceiling", () => {
      const nodes = [up("a"), up("m", undefined, "upload-audio"), tx, plan({ sourceConfig: { m: { role: "master-audio" } } }), fr]
      const sources = [wire("a", "video", "plan", "sources"), wire("m", "audio", "plan", "sources")]
      // Heard from the master (the run refuses a master over 180 minutes): the one camera, 22 blocks.
      expect(speakerFramesEstimateBlocks(fr, nodes, [...sources, ...heard("m", "audio"), toFrames], PLAN)).toBe(22)
      // Heard from a camera that is not the master: it may run longer than the master, so the ceiling.
      expect(speakerFramesEstimateBlocks(fr, nodes, [...sources, ...heard("a"), toFrames], PLAN)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
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

    it("a Transcribe that does not run again and holds no readable transcript: the ceiling (what it heard is not known)", () => {
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

  it("a video of unknown length quotes its one camera's 22 blocks at 2 a block (decided 2026-10-20); a recorded one its own blocks", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([up, sf()], [{ source: "up", target: "sf", targetHandle: "video" }])).toBe(44)
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

describe("a length not known before the run counts the cameras the run will frame (decided 2026-10-20)", () => {
  const up = (id: string, type = "upload-video") => ({ id, type, data: {} })
  const fr = sf()
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ source, sourceHandle, target, targetHandle })
  const tx = { id: "tx", type: "transcribe", data: {} }
  const camIds = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`)
  /** An Edit Plan over `n` cameras (and a mic) of unknown length, about to run. */
  const planGraph = (n: number) => {
    const nodes = [...camIds(n).map((id) => up(id)), up("mic", "upload-audio"), tx, { id: "plan", type: "edit-plan", data: { sourceConfig: { mic: { role: "master-audio" } } } }, fr]
    const edges = [
      ...camIds(n).map((id) => wire(id, "video", "plan", "sources")),
      wire("mic", "audio", "plan", "sources"),
      wire("mic", "audio", "tx", "audio"),
      wire("tx", "json", "plan", "transcript"),
      wire("plan", "edl", "sf", "edl"),
    ]
    return { nodes, edges, rerun: new Set(["tx", "plan", "sf"]) }
  }
  /** A Speaker Map over `n` cameras (and a mic) of unknown length, about to run. */
  const mapGraph = (n: number) => {
    const nodes = [...camIds(n).map((id) => up(id)), up("mic", "upload-audio"), { id: "map", type: MULTICAM_SPEAKER_MAP_TYPE, data: {} }, fr]
    const edges = [
      ...camIds(n).map((id) => wire(id, "video", "map", "sources")),
      wire("mic", "audio", "map", "sources"),
      wire("map", "edl", "sf", "edl"),
    ]
    return { nodes, edges, rerun: new Set(["map", "sf"]) }
  }
  /** The longest edit the run can hold for: 180 minutes kept on `n` cameras, its 2 s margins unclamped. */
  const longestEdit = (n: number): Edl =>
    ({
      version: 1,
      clock: "master",
      sources: [MIC, ...camIds(n).map((id) => cam(id))],
      segments: [{ id: "s0", inMs: 5_000, outMs: 5_000 + 180 * 60_000, video: "c1" }],
    }) as Edl
  const noProbe = async (): Promise<number> => {
    throw new Error("unreadable")
  }
  /** The blocks the run reserves for a payload, counted on the server. */
  const holdBlocks = async (payload: Record<string, unknown>) => speakerFramesBlocks((await speakerFramesReserveFrames(payload, noProbe))!)

  it("the ceiling per camera count: 1 → 22, 2 → 44, 3 → 65, 4 → 87, 5 → 109, 6 → 130, never past 6", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12].map(speakerFramesCeilingBlocks)).toEqual([22, 44, 65, 87, 109, 130, 130, 130])
    // A count that cannot be read is the ceiling (never low).
    expect([0, -1, 1.5, Number.NaN].map(speakerFramesCeilingBlocks)).toEqual([130, 130, 130, 130])
  })

  it("an Edit Plan over 1 camera: 22 blocks; over 3 cameras: 65; over 6: 130", () => {
    for (const [n, blocks] of [[1, 22], [3, 65], [6, 130]] as const) {
      const g = planGraph(n)
      expect(speakerFramesEstimateBlocks(fr, g.nodes, g.edges, g.rerun)).toBe(blocks)
    }
  })

  it("a Speaker Map over 3 cameras: 65 blocks; through a re-running Camera Switch the same", () => {
    const g = mapGraph(3)
    expect(speakerFramesEstimateBlocks(fr, g.nodes, g.edges, g.rerun)).toBe(65)
    const sw = { id: "sw", type: "camera-switch", data: {} }
    const edges = [...g.edges.filter((e) => e.target !== "sf"), wire("map", "edl", "sw", "edl"), wire("sw", "edl", "sf", "edl")]
    expect(speakerFramesEstimateBlocks(fr, [...g.nodes, sw], edges, new Set([...g.rerun, "sw"]))).toBe(65)
  })

  it("more than 6 cameras: the 130-block ceiling", () => {
    const g = planGraph(8)
    expect(speakerFramesEstimateBlocks(fr, g.nodes, g.edges, g.rerun)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
  })

  it("cameras that cannot be counted keep the 130-block ceiling", () => {
    // Another producer about to run, a plan that holds nothing and is not about to run, an edit that cannot be read.
    const other = { id: "o", type: "apply-edl", data: {} }
    expect(speakerFramesEstimateBlocks(fr, [other, fr], [wire("o", "edl", "sf", "edl")], new Set(["o"]))).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    const g = planGraph(1)
    expect(speakerFramesEstimateBlocks(fr, g.nodes, g.edges, NONE)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    expect(speakerFramesEstimateBlocks(sf({ edl: "not an edit" }), [], [], NONE)).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    // No wiring sent to the server's quote at all.
    expect(CreditsService.estimateWorkflowBaseCredits([sf()], undefined)).toBe(2 * SPEAKER_FRAMES_CEILING_BLOCKS)
  })

  it("a known length is unchanged: one camera over an hour is 8 blocks, not 22", () => {
    const g = planGraph(1)
    const nodes = g.nodes.map((n) => (n.id === "c1" || n.id === "mic" ? { ...n, data: { metadata: { durationSeconds: 3600 } } } : n))
    expect(speakerFramesEstimateBlocks(fr, nodes, g.edges, g.rerun)).toBe(8)
  })

  it("is never below what the run holds: the longest edit on N cameras, and a bare video that cannot be probed", async () => {
    for (let n = 1; n <= 6; n++) {
      const hold = await holdBlocks({ edl: longestEdit(n) })
      expect(hold).toBe(speakerFramesCeilingBlocks(n))
      const p = planGraph(n)
      expect(speakerFramesEstimateBlocks(fr, p.nodes, p.edges, p.rerun)).toBeGreaterThanOrEqual(hold)
      const m = mapGraph(n)
      expect(speakerFramesEstimateBlocks(fr, m.nodes, m.edges, m.rerun)).toBeGreaterThanOrEqual(hold)
    }
    // A bare video the server cannot probe is held at 180 minutes: 21,600 frames, 22 blocks.
    const bare = await holdBlocks({ videoUrl: "https://media.test/clip.mp4" })
    expect(bare).toBe(22)
    // So is a longer one (the job refuses it before sampling, and the reserve is refunded): 4 hours → 22, not 29.
    const fourHours = speakerFramesBlocks((await speakerFramesReserveFrames({ videoUrl: "https://media.test/long.mp4" }, async () => 4 * 3600))!)
    expect(fourHours).toBe(22)
    const link = { id: "up", type: "upload-video", data: { url: "https://media.test/clip.mp4" } }
    const quote = speakerFramesEstimateBlocks(fr, [link, fr], [wire("up", "video", "sf", "video")], NONE)
    expect(quote).toBeGreaterThanOrEqual(bare)
    expect(quote).toBeGreaterThanOrEqual(fourHours)
  })

  it("the master at the run's 3 s tolerance, cut with a 3 s gap and its start pad unclamped, still holds no more than the quote", async () => {
    // Kept 180 min over a 10,803 s span: the margins merge across the gap, 10,807 s → 21,614 frames a camera.
    const tolerance = (n: number): Edl =>
      ({
        version: 1,
        clock: "master",
        sources: [MIC, ...camIds(n).map((id) => cam(id))],
        segments: [
          { id: "s0", inMs: 5_000, outMs: 5_000 + 5_400_000, video: "c1" },
          { id: "s1", inMs: 5_000 + 5_403_000, outMs: 5_000 + 10_803_000, video: "c1" },
        ],
      }) as Edl
    for (let n = 1; n <= 6; n++) {
      expect((await speakerFramesReserveFrames({ edl: tolerance(n) }, noProbe))! / n).toBe(21_614)
      const p = planGraph(n)
      expect(speakerFramesEstimateBlocks(fr, p.nodes, p.edges, p.rerun)).toBeGreaterThanOrEqual(await holdBlocks({ edl: tolerance(n) }))
    }
  })

  it("Speaker Map counts cameras by the run's rule: a node that hands on either kind is a camera on its video pip (known and unknown length)", async () => {
    // cam1 an upload; cam2 a video through Adjust Volume (its `video-out` pip); cam3 a Voice Changer's video; a mic.
    const graph = (micSec?: number) => {
      const nodes = [
        up("cam1"), up("raw"), { id: "cam2", type: "adjust-volume", data: {} }, { id: "cam3", type: "voice-changer", data: {} },
        { id: "mic", type: "upload-audio", data: micSec ? { metadata: { durationSeconds: micSec } } : {} },
        { id: "map", type: MULTICAM_SPEAKER_MAP_TYPE, data: { masterSourceId: "mic" } }, fr,
      ]
      const edges = [
        wire("raw", "video", "cam2", "in"),
        wire("cam1", "video", "map", "sources"),
        wire("cam2", "video-out", "map", "sources"),
        wire("cam3", "video", "map", "sources"),
        wire("mic", "audio", "map", "sources"),
        wire("map", "edl", "sf", "edl"),
      ]
      return { nodes, edges, rerun: new Set(["cam2", "cam3", "map", "sf"]) }
    }
    // Unknown length: three cameras at 180 minutes — 65 blocks, never below the longest edit on three.
    const unknown = graph()
    const unknownQuote = speakerFramesEstimateBlocks(fr, unknown.nodes, unknown.edges, unknown.rerun)
    expect(unknownQuote).toBe(65)
    expect(unknownQuote).toBeGreaterThanOrEqual(await holdBlocks({ edl: longestEdit(3) }))
    // A one-hour master: three cameras over 3,604 s — 21,624 frames, 22 blocks (was 8: one camera).
    const known = graph(3600)
    const knownQuote = speakerFramesEstimateBlocks(fr, known.nodes, known.edges, known.rerun)
    expect(knownQuote).toBe(22)
    const hour: Edl = { version: 1, clock: "master", sources: [MIC, ...camIds(3).map((id) => cam(id))], segments: [{ id: "s0", inMs: 0, outMs: 3_600_000, video: "c1" }] } as Edl
    expect(knownQuote).toBeGreaterThanOrEqual(await holdBlocks({ edl: hour }))
    // On its audio pip the same node is sound only, as the run reads it.
    const soundOnly = { ...known, edges: known.edges.map((e) => (e.source === "cam2" && e.target === "map" ? { ...e, sourceHandle: "audio-out" } : e)) }
    expect(speakerFramesEstimateBlocks(fr, soundOnly.nodes, soundOnly.edges, soundOnly.rerun)).toBe(speakerFramesBlocks(2 * (3604 * 2)))
  })

  it("the server's run quote reads the same figures: 3 cameras of unknown length quote 65 blocks at 2 a block", () => {
    const g = planGraph(3)
    const nodes = g.nodes.filter((n) => n.id !== "sf")
    const total = CreditsService.estimateWorkflowBaseCredits([...nodes, fr], g.edges)
    const without = CreditsService.estimateWorkflowBaseCredits(nodes, g.edges.filter((e) => e.target !== "sf"))
    expect(total - without).toBe(2 * 65)
  })
})
