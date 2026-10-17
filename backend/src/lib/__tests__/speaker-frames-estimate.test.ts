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
import { SPEAKER_FRAMES_CEILING_BLOCKS, speakerFramesEstimateBlocks } from "@nodaro/render-rules"
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
