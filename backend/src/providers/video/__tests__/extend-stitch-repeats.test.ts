import { describe, it, expect } from "vitest"

/**
 * Leading repeats (`../extend-stitch-repeats.ts`): the frames at the start of
 * a native extension's kept new part that repeat the new frame before them,
 * which the stitch drops after the cut. Here the rule, the probe's arguments
 * and the reading of its numbers; the real ffmpeg run is in
 * `extend-stitch-output.test.ts`.
 */

import {
  firstRepeatCandidate,
  leadingRepeatDrop,
  leadingRepeatProbeArgs,
  MAX_LEADING_REPEATS,
  nativeFrameShownAt,
  outputFrameOf,
  outputSkipOf,
  parsePsnrStats,
  REPEAT_MIN_PSNR_DB,
  REPEAT_PROBE_WIDTH,
} from "../extend-stitch-repeats.js"

/**
 * A new part described frame by frame: `psnrToPrevious[k]` is new frame k
 * against new frame k − 1 (index 0, which has no frame before it, unused).
 */
const clip = (...psnrToPrevious: number[]) => (k: number): number => psnrToPrevious[k] ?? Number.NaN

/** A hold: new[1..3] repeat new[0] (byte-identical), new[4] on moves. */
const HOLD = clip(Number.NaN, Infinity, Infinity, Infinity, 25, 26, 24, 27, 25, 26, 24, 27, 25, 26)

describe("leadingRepeatDrop", () => {
  it("is 50 dB and at most 12 frames", () => {
    expect(REPEAT_MIN_PSNR_DB).toBe(50)
    expect(MAX_LEADING_REPEATS).toBe(12)
  })

  it("a hold whose first frame is the matched twin (new[0], dropped by the cut): new[1..3], repeating it, go too", () => {
    expect(leadingRepeatDrop(1, HOLD)).toEqual({ from: 1, count: 3 })
  })

  it("no matcher or no match: new[0] is kept (nothing before it in the new part), the repeats after it go", () => {
    expect(firstRepeatCandidate(0)).toBe(1)
    expect(leadingRepeatDrop(0, HOLD)).toEqual({ from: 1, count: 3 })
  })

  it("the staging clip: the matcher already dropped the hold (new[0..3]); new[4] moves, nothing more goes", () => {
    const staging = clip(Number.NaN, 68, 70, 66, 25, 26, 24)
    expect(leadingRepeatDrop(4, staging)).toEqual({ from: 4, count: 0 })
  })

  it("compares each new frame with the new frame before it, whatever the source's last frame was", () => {
    // A held part 38.8 dB from the source, its frames 66–72 dB apart: the hold goes.
    expect(leadingRepeatDrop(0, clip(Number.NaN, 66, 72, 70, 23, 30))).toEqual({ from: 1, count: 3 })
  })

  it("drops only 12 of a run of 14", () => {
    const long = clip(Number.NaN, ...Array.from({ length: 14 }, () => 70), 25)
    expect(leadingRepeatDrop(0, long)).toEqual({ from: 1, count: 12 })
    expect(leadingRepeatDrop(1, long)).toEqual({ from: 1, count: 12 })
  })

  it("counts exactly 50 dB as a repeat, and stops at the first frame below it", () => {
    expect(leadingRepeatDrop(0, clip(Number.NaN, 50, 49.99, 70))).toEqual({ from: 1, count: 1 })
    expect(leadingRepeatDrop(0, clip(Number.NaN, 49.99, 70, 70))).toEqual({ from: 1, count: 0 })
  })

  it("stops at a frame it has no number for (unread, or past what was measured)", () => {
    expect(leadingRepeatDrop(0, clip(Number.NaN, 70, Number.NaN, 70))).toEqual({ from: 1, count: 1 })
    expect(leadingRepeatDrop(0, clip(Number.NaN, 70, 70))).toEqual({ from: 1, count: 2 })
  })
})

describe("parsePsnrStats", () => {
  it("reads each pair's average PSNR, in order, an identical pair's `inf` as Infinity", () => {
    const stdout = [
      "n:1 mse_avg:0.00 mse_y:0.00 mse_u:0.00 mse_v:0.00 psnr_avg:inf psnr_y:inf psnr_u:inf psnr_v:inf ",
      "n:2 mse_avg:0.01 mse_y:0.01 mse_u:0.00 mse_v:0.00 psnr_avg:68.41 psnr_y:67.20 psnr_u:inf psnr_v:inf ",
      "n:3 mse_avg:94.12 mse_y:120.50 mse_u:20.10 mse_v:22.30 psnr_avg:28.39 psnr_y:27.32 psnr_u:35.10 psnr_v:34.65 ",
      "",
    ].join("\n")
    expect(parsePsnrStats(stdout)).toEqual([Infinity, 68.41, 28.39])
  })

  it("reads nothing from an empty output", () => {
    expect(parsePsnrStats("")).toEqual([])
  })
})

// The rule runs on PixVerse's own frames, at its own rate: the stitch's conform to the
// source's rate would show one PixVerse frame on several output frames, identical
// neighbours that are no hold. What it drops is then taken out of the output by time.
describe("at PixVerse's own frame rate", () => {
  const SAME = { native: 24, output: 24 }
  /** A 24 fps new part on a 60 fps source: each PixVerse frame on 2 or 3 output frames. */
  const SLOWER = { native: 24, output: 60 }
  /** A 60 fps new part on a 24 fps source: some PixVerse frames on no output frame. */
  const FASTER = { native: 60, output: 24 }

  it("at the same rate, a PixVerse frame is an output frame", () => {
    for (const n of [0, 1, 5, 47]) {
      expect(nativeFrameShownAt(n, SAME)).toBe(n)
      expect(outputFrameOf(n, SAME)).toBe(n)
    }
    expect(firstRepeatCandidate(0, SAME)).toBe(1)
    expect(firstRepeatCandidate(5, SAME)).toBe(5)
    expect(outputSkipOf({ from: 1, count: 3 }, 0, SAME, 48)).toEqual({ from: 1, count: 3 })
    expect(outputSkipOf({ from: 5, count: 3 }, 5, SAME, 48)).toEqual({ from: 5, count: 3 })
  })

  it("reads which PixVerse frame an output frame shows as the conform rounds it (nearest)", () => {
    // PixVerse frame 1 starts at 2.5 output frames (shown from 3), frame 2 at 5, frame 5 at 12.5 (from 13).
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => nativeFrameShownAt(n, SLOWER))).toEqual([0, 0, 0, 1, 1, 2, 2, 2])
    expect([0, 1, 2, 5].map((i) => outputFrameOf(i, SLOWER))).toEqual([0, 3, 5, 13])
    // Faster: PixVerse frames 0 and 1 both round to output frame 0, which shows the later.
    expect([0, 1, 2].map((n) => nativeFrameShownAt(n, FASTER))).toEqual([1, 3, 6])
  })

  it("starts the candidates at the PixVerse frame the cut keeps first; with no cut, after the first one shown", () => {
    expect(firstRepeatCandidate(0, SLOWER)).toBe(1)
    expect(firstRepeatCandidate(5, SLOWER)).toBe(2)
    // Cut inside PixVerse frame 0's output frames: frame 0 still shows, it has nothing before it.
    expect(firstRepeatCandidate(1, SLOWER)).toBe(1)
    expect(firstRepeatCandidate(0, FASTER)).toBe(2)
  })

  it("takes the dropped PixVerse frames out of the output by time: the output frames that show them", () => {
    // No cut, PixVerse frames 1–4 repeat frame 0: frame 0's 3 output frames kept, then 4/24 s (10 output frames) dropped.
    expect(outputSkipOf({ from: 1, count: 4 }, 0, SLOWER, 120)).toEqual({ from: 3, count: 10 })
    // After a cut at output frame 5 (PixVerse frame 2): frames 2–3 dropped, right after the cut.
    expect(outputSkipOf({ from: 2, count: 2 }, 5, SLOWER, 120)).toEqual({ from: 5, count: 5 })
    // Never the first output frame shown with no cut, never the last output frame.
    expect(outputSkipOf({ from: 1, count: 1 }, 0, FASTER, 48)).toEqual({ from: 1, count: 0 })
    expect(outputSkipOf({ from: 40, count: 12 }, 0, SLOWER, 120)).toEqual({ from: 100, count: 19 })
    expect(outputSkipOf({ from: 1, count: 0 }, 0, SLOWER, 120).count).toBe(0)
  })

  it("applies the rule to PixVerse's frames: a hold of frame 0 and 3 repeats keeps frame 0", () => {
    expect(leadingRepeatDrop(0, HOLD, SLOWER)).toEqual({ from: 1, count: 3 })
    expect(leadingRepeatDrop(5, HOLD, SLOWER)).toEqual({ from: 2, count: 2 })
  })
})

describe("leadingRepeatProbeArgs", () => {
  const args = leadingRepeatProbeArgs({ extensionPath: "/w/new.mov", from: 5, pairs: 12 })
  const graph = args[args.indexOf("-filter_complex") + 1]!

  it("reads the new part alone, at its own rate (no conform): the frame before the first candidate, then the candidates, 192 px wide", () => {
    expect(REPEAT_PROBE_WIDTH).toBe(192)
    expect(args.slice(0, 4)).toEqual(["-v", "error", "-i", "/w/new.mov"])
    expect(args.filter((a) => a === "-i")).toHaveLength(1)
    // PixVerse frames 4–16: frame 4 (before the first candidate), then the 12 candidates 5–16.
    expect(graph.startsWith("[0:v:0]trim=start_frame=4:end_frame=17,setpts=PTS-STARTPTS,scale=192:-2,setsar=1,format=yuv420p,")).toBe(true)
    expect(graph).not.toContain("fps=")
  })

  it("compares each frame of the sequence with the next (12 pairs), writing nothing", () => {
    expect(graph).toContain("trim=end_frame=12,")
    expect(graph).toContain("trim=start_frame=1,")
    expect(graph).toMatch(/psnr=stats_file=-:shortest=1$/)
    expect(args.slice(-3)).toEqual(["-f", "null", "-"])
  })
})
