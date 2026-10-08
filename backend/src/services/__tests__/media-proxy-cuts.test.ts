import { describe, it, expect } from "vitest"
import { Readable } from "node:stream"
import {
  SCENE_CUT,
  SCENE_CUT_RECIPE,
  findSceneCuts,
  isSceneCutList,
  mergeSceneCuts,
  readSceneScores,
  sceneCutFilter,
  segmentCutsToSourceMs,
  type SceneFrameScore,
} from "../media-proxy-cuts.js"

/** What `metadata=mode=print` writes after `scdet` (ffmpeg n8.1.2): a header
 *  line per frame, then every key the frame carries. */
const PRINTED = [
  "frame:0    pts:0       pts_time:0",
  "lavfi.scd.mafd=0.000",
  "lavfi.scd.score=0.000",
  "frame:1    pts:1001    pts_time:0.033367",
  "lavfi.scd.mafd=0.412",
  "lavfi.scd.score=0.412",
  "frame:299704 pts:299704 pts_time:10000.123467",
  "lavfi.scd.mafd=31.250",
  "lavfi.scd.score=30.838",
  "lavfi.scd.time=10000.123467",
  "",
].join("\n")

const lines = (text: string) => Readable.from(text.split("\n").map((l) => `${l}\n`))

/** A 25 fps run of frames: quiet motion (score 0.3, mafd 0.4) unless `at` says otherwise. */
function run(seconds: number, at: Record<number, Partial<SceneFrameScore>> = {}): SceneFrameScore[] {
  return Array.from({ length: Math.round(seconds * 25) }, (_, k) => ({ t: k / 25, score: k === 0 ? 0 : 0.3, mafd: k === 0 ? 0 : 0.4, ...at[k] }))
}

describe("sceneCutFilter", () => {
  it("scores every decoded frame and prints each frame's scores to the given file, passing every frame on", () => {
    expect(sceneCutFilter("/tmp/media-proxy-ab12/cuts-0001.txt")).toBe(
      "scdet=threshold=100,metadata=mode=print:file=/tmp/media-proxy-ab12/cuts-0001.txt",
    )
  })

  it("refuses a path the filtergraph would re-parse (a colon, comma, quote, bracket or space)", () => {
    for (const bad of ["/tmp/a:b/cuts.txt", "/tmp/a,b/cuts.txt", "/tmp/a'b/cuts.txt", "/tmp/a[b]/cuts.txt", "/tmp/a b/cuts.txt"]) {
      expect(() => sceneCutFilter(bad), bad).toThrow(/scene-cut file path/)
    }
  })

  it("names every constant of the rule in the recipe, so any change keys a new proxy", () => {
    expect(SCENE_CUT_RECIPE).toBe(
      `t${SCENE_CUT.threshold}-r${SCENE_CUT.isolation}-f${SCENE_CUT.flashReturn}x${SCENE_CUT.flashFrames}-w${SCENE_CUT.windowMs}`,
    )
    expect(SCENE_CUT.flashFrames).toBe(3)
    expect(SCENE_CUT_RECIPE).toMatch(/^[A-Za-z0-9.-]+$/) // safe inside an object key
  })
})

describe("readSceneScores", () => {
  it("reads each frame's time (s, from the seek point, full precision), score and mafd from a line stream", async () => {
    expect(await readSceneScores(lines(PRINTED))).toEqual([
      { t: 0, score: 0, mafd: 0 },
      { t: 0.033367, score: 0.412, mafd: 0.412 },
      { t: 10000.123467, score: 30.838, mafd: 31.25 },
    ])
  })

  it("an empty file is no frames", async () => {
    expect(await readSceneScores(lines(""))).toEqual([])
  })

  it("skips a frame with no time (NOPTS) or a missing score rather than inventing one", async () => {
    const text = "frame:3    pts:NOPTS   pts_time:NOPTS\nlavfi.scd.mafd=40\nlavfi.scd.score=40\nframe:4    pts:4004   pts_time:0.1335\nlavfi.scd.mafd=1\n"
    expect(await readSceneScores(lines(text))).toEqual([])
  })
})

describe("findSceneCuts — a cut is an isolated spike that does not return", () => {
  it("a hard cut: one frame scoring over the threshold, with quiet frames around it", () => {
    const frames = run(4, { 50: { score: 9.4, mafd: 9.8 } })
    expect(findSceneCuts(frames)).toEqual([2])
  })

  it("a low cut still counts when it stands out (maz's 6.96 over 0.28)", () => {
    const frames = run(4, { 50: { score: SCENE_CUT.threshold + 0.1, mafd: SCENE_CUT.threshold + 0.5 } })
    expect(findSceneCuts(frames)).toEqual([2])
  })

  it("under the threshold is no cut, however isolated", () => {
    const frames = run(4, { 50: { score: SCENE_CUT.threshold - 0.1, mafd: SCENE_CUT.threshold } })
    expect(findSceneCuts(frames)).toEqual([])
  })

  it("a pan or a handheld shake is a plateau of high scores, not a cut (maz's stage pans: 5–6.8 for 2 s)", () => {
    const at: Record<number, Partial<SceneFrameScore>> = {}
    for (let k = 40; k < 90; k++) at[k] = { score: 6.8 - (k % 3) * 0.4, mafd: 7 }
    expect(findSceneCuts(run(5, at))).toEqual([])
  })

  it("a real cut inside camera motion still counts when it stands at least twice over its neighbourhood", () => {
    const at: Record<number, Partial<SceneFrameScore>> = { 50: { score: 12.07, mafd: 14 } }
    for (let k = 44; k < 50; k++) at[k] = { score: 4.6, mafd: 5 }
    expect(findSceneCuts(run(4, at))).toEqual([2])
  })

  it("a camera flash returns to the picture before it, so it is not a cut (anne's 50–60 spikes)", () => {
    // frame 50 is the flash: a jump in, then frame 51 jumps back out by as much
    const frames = run(4, { 50: { score: 51.3, mafd: 52 }, 51: { score: 0.4, mafd: 51.6 } })
    expect(findSceneCuts(frames)).toEqual([])
  })

  it("a flash held for two frames returns to the picture before it within the look-ahead, so neither its jump in nor its jump back is a cut", () => {
    // 50 jumps in, 51 holds the flash (no change), 52 jumps back by as much as 50 jumped in
    const frames = run(4, { 50: { score: 51.3, mafd: 52 }, 51: { score: 0, mafd: 0.3 }, 52: { score: 51.3, mafd: 51.6 } })
    expect(findSceneCuts(frames)).toEqual([])
  })

  it("a flash held for three frames is still a flash", () => {
    const frames = run(4, {
      50: { score: 51.3, mafd: 52 }, 51: { score: 0, mafd: 0.3 }, 52: { score: 0, mafd: 0.3 }, 53: { score: 51.3, mafd: 51.6 },
    })
    expect(findSceneCuts(frames)).toEqual([])
  })

  it(`a picture held for more than ${SCENE_CUT.flashFrames} frames is a shot: its jump in and its jump out are two cuts`, () => {
    const back = 50 + SCENE_CUT.flashFrames + 1
    const at: Record<number, Partial<SceneFrameScore>> = { 50: { score: 51.3, mafd: 52 }, [back]: { score: 51.3, mafd: 51.6 } }
    for (let k = 51; k < back; k++) at[k] = { score: 0, mafd: 0.3 }
    expect(findSceneCuts(run(4, at))).toEqual([2, back / 25])
  })

  it("a cut beside a held flash is judged against the flash's jump back too: it is background, not a candidate", () => {
    const frames = run(4, {
      45: { score: 9.4, mafd: 9.8 }, 50: { score: 51.3, mafd: 52 }, 51: { score: 0, mafd: 0.3 }, 52: { score: 51.3, mafd: 51.6 },
    })
    expect(findSceneCuts(frames)).toEqual([])
  })

  it(`the known cost: a real cut followed within ${SCENE_CUT.flashFrames} frames by ANY change of ${SCENE_CUT.flashReturn}× its own mafd reads as a flash, and is lost`, () => {
    // 50 is a real cut (mafd 20); 51–52 are a whip pan into the new shot. Rule 2 sees only the size of
    // 52's change, not whether it returns to the picture before 50, so at exactly flashReturn × 20 the
    // cut, the pan and everything between are a flash.
    const cutThenPan = (panMafd: number) =>
      run(4, { 50: { score: 20, mafd: 20 }, 51: { score: 4, mafd: 4 }, 52: { score: panMafd - 4, mafd: panMafd } })
    expect(findSceneCuts(cutThenPan(SCENE_CUT.flashReturn * 20))).toEqual([])
    // Just under the bound, the cut stands. (On the holdout, no real cut is followed within 3 frames by
    // more than 0.24× its own mafd.)
    expect(findSceneCuts(cutThenPan(SCENE_CUT.flashReturn * 20 - 0.1))).toEqual([2])
  })

  it("two spikes further apart than the window are two cuts", () => {
    const frames = run(6, { 25: { score: 15, mafd: 15 }, 50: { score: 15, mafd: 15 } }) // 1 s apart at 25 fps
    expect(findSceneCuts(frames)).toEqual([1, 2])
  })

  it("two hard cuts closer than the window are both cuts: A to B to C in 300 ms is not one long shot", () => {
    // 2.0 s and 2.28 s: each spike is the other's nearest neighbour, and both score alike
    const frames = run(4, { 50: { score: 28.7, mafd: 29 }, 57: { score: 27.6, mafd: 28 } })
    expect(findSceneCuts(frames)).toEqual([2, 2.28])
  })

  it("a cut beside a camera flash is still judged against the flash: a frame that returns is never a cut, so it is background", () => {
    const frames = run(4, { 50: { score: 9.4, mafd: 9.8 }, 55: { score: 51.3, mafd: 52 }, 56: { score: 0.4, mafd: 51.6 } })
    expect(findSceneCuts(frames)).toEqual([])
  })

  it("a frame at the segment's very start or end is judged on the neighbours it has", () => {
    const frames = run(2, { 1: { score: 20, mafd: 20 }, 49: { score: 20, mafd: 20 } })
    expect(findSceneCuts(frames)).toEqual([0.04, 1.96])
  })
})

describe("segmentCutsToSourceMs", () => {
  it("puts a segment's cut times back on the SOURCE clock: the seek point plus the time from it", () => {
    expect(segmentCutsToSourceMs([1.034367, 3.737067], 10_300)).toEqual([11_334.367, 14_037.067])
  })

  it("keeps only the cuts inside the span's length (the read may decode a frame past it)", () => {
    expect(segmentCutsToSourceMs([0.5, 4.599, 4.6, 5.2], 10_300, 4600)).toEqual([10_800, 14_899])
  })

  it("never reports a cut at the segment's very first frame: nothing came before it to cut from", () => {
    expect(segmentCutsToSourceMs([0, 2], 5000)).toEqual([7000])
  })
})

describe("mergeSceneCuts / isSceneCutList", () => {
  it("joins the segments' cuts into one ascending list without duplicates", () => {
    expect(mergeSceneCuts([[14_037.067, 11_334.367], [], [40_800, 11_334.367]])).toEqual([11_334.367, 14_037.067, 40_800])
  })

  it("a stored list must be finite, non-negative and strictly ascending", () => {
    expect(isSceneCutList([])).toBe(true)
    expect(isSceneCutList([0, 1.5, 9000])).toBe(true)
    for (const bad of [undefined, null, "x", [2, 1], [1, 1], [-1], [Number.NaN], [1, "2"]]) expect(isSceneCutList(bad), JSON.stringify(bad)).toBe(false)
  })
})
