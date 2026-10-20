/**
 * A Speaker Map's whole-recording edit is clocked to the recording the RUN
 * picks (decided 2026-10-20): its master while that node is still wired, else
 * the first source in its own Cameras order (`sourceOrder`) — never a stale
 * master or the first wire in wire order. The estimate reads the same pick
 * (`speakerMapClockOrigin`), so Speaker View's minutes and Speaker Frames'
 * blocks over that edit are never below what the run holds.
 */
import { describe, it, expect } from "vitest"
import {
  MULTICAM_SPEAKER_MAP_TYPE,
  persistedEdlPlan,
  resolveApplyEdlEstimateMinutes,
  speakerFramesEstimateBlocks,
  speakerMapClockOrigin,
  speakerMapRunInputs,
  wholeEpisodeEdl,
} from "@nodaro/render-rules"

const upload = (id: string, type: "upload-video" | "upload-audio", sec: number) => ({ id, type, data: { url: `https://r2/${id}`, metadata: { durationSeconds: sec } } })
// cam1 is short; cam2 and the mic run the whole conversation.
const cam1 = upload("cam1", "upload-video", 600)
const cam2 = upload("cam2", "upload-video", 3600)
const mic = upload("mic", "upload-audio", 3700)
const LENGTH: Record<string, number> = { cam1: 600, cam2: 3600, mic: 3700 }
const wired = [cam1, cam2, mic]
const transcript = JSON.stringify({ version: 1, words: [{ text: "a", startMs: 0, endMs: 500, speaker: "speaker_0" }] })

function graph(data: Record<string, unknown>) {
  const map = { id: "map", type: MULTICAM_SPEAKER_MAP_TYPE, data }
  const sv = { id: "sv", type: "speaker-view", data: { quality: "final" } }
  const frames = { id: "frames", type: "speaker-frames", data: {} }
  const nodes = [...wired, map, sv, frames]
  const edges = [
    // Wired in this order: cam1 first.
    ...wired.map((n) => ({ source: n.id, target: "map", sourceHandle: n.type === "upload-audio" ? "audio" : "video", targetHandle: "sources" })),
    { source: "map", target: "sv", sourceHandle: "edl", targetHandle: "edl" },
    { source: "map", target: "frames", sourceHandle: "edl", targetHandle: "edl" },
  ]
  return { map, sv, frames, nodes, edges, rerun: new Set(["map", "sv", "frames"]) }
}

/** The clock the run uses: speakerMapRunInputs' rows (in the node's order) and master, then the provider's pick. */
function runClock(data: Record<string, unknown>): string {
  const rows = wired.map((n) => ({ id: n.id, url: n.data.url, kind: n.type === "upload-audio" ? ("audio" as const) : ("video" as const) }))
  const r = speakerMapRunInputs({ sources: rows, transcript }, data)
  if (!("body" in r)) throw new Error(JSON.stringify(r.problem))
  return r.body.masterSourceId ?? r.body.sources[0]!.id
}

/** What the run holds for Speaker Frames over the edit: every camera over the clock, padded 2 s each side, at 2 fps. */
const framesHoldBlocks = (clockSec: number) => Math.ceil((2 * Math.ceil((clockSec + 4) * 2)) / 1000)

describe("Speaker Map's clock: the estimate picks what the run picks", () => {
  const cases: ReadonlyArray<{ readonly name: string; readonly data: Record<string, unknown>; readonly clock: string }> = [
    { name: "reordered cameras, no master: the first in the Cameras order, not the first wire", data: { sourceOrder: ["cam2", "cam1", "mic"] }, clock: "cam2" },
    { name: "a stale master (no longer wired) is dropped: the first in the Cameras order", data: { sourceOrder: ["cam2", "cam1", "mic"], masterSourceId: "gone" }, clock: "cam2" },
    { name: "a wired master is the clock, wherever it stands", data: { sourceOrder: ["cam1", "cam2", "mic"], masterSourceId: "mic" }, clock: "mic" },
    { name: "no order and no master: the first wire", data: {}, clock: "cam1" },
  ]
  for (const c of cases) {
    it(c.name, () => {
      const g = graph(c.data)
      expect(runClock(c.data)).toBe(c.clock)
      expect(speakerMapClockOrigin(g.map, g.nodes, g.edges)?.id).toBe(c.clock)
      const sec = LENGTH[c.clock]!
      // Speaker View over the edit: at least the clock's minutes.
      expect(resolveApplyEdlEstimateMinutes(g.sv, g.nodes, g.edges, g.rerun)).toBeGreaterThanOrEqual(Math.ceil(sec / 60))
      // Speaker Frames over the edit: at least the run's hold (both cameras over the clock).
      expect(speakerFramesEstimateBlocks(g.frames, g.nodes, g.edges, g.rerun)).toBeGreaterThanOrEqual(framesHoldBlocks(sec))
    })
  }
})

describe("a held Speaker Map's edit is its generatedEdl, never its map (generatedJson)", () => {
  // The edit a Speaker Map run makes: ten minutes on the master's clock, both cameras sources.
  const made = wholeEpisodeEdl({
    sources: [
      { id: "cam1", url: "https://r2/cam1", kind: "video", durationMs: 600_000 },
      { id: "cam2", url: "https://r2/cam2", kind: "video", durationMs: 600_000 },
      { id: "mic", url: "https://r2/mic", kind: "audio", durationMs: 600_000 },
    ],
    masterSourceId: "mic",
  })
  if (!("edl" in made)) throw new Error(made.problem)
  const held = { generatedJson: { version: 1, speakerMap: { speaker_0: "cam2" } }, generatedEdl: made.edl, sourceOrder: ["cam2", "cam1", "mic"], masterSourceId: "mic" }
  it("persistedEdlPlan reads the edit", () => {
    expect(persistedEdlPlan({ id: "map", type: MULTICAM_SPEAKER_MAP_TYPE, data: held })).toBe(made.edl)
  })
  it("a render over a held (not re-running) Speaker Map is quoted at the edit's 10 minutes, not the ceiling", () => {
    const g = graph(held)
    expect(resolveApplyEdlEstimateMinutes(g.sv, g.nodes, g.edges, new Set(["sv"]))).toBe(10)
  })
  it("Speaker Frames over it samples that edit's two cameras (2 × ⌈604 × 2⌉ = 2,416 frames: 3 blocks), not the ceiling", () => {
    const g = graph(held)
    expect(speakerFramesEstimateBlocks(g.frames, g.nodes, g.edges, new Set(["frames"]))).toBe(3)
  })
})
