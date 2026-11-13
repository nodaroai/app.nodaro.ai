/**
 * Leading repeats: the frames at the start of a native extension's kept new
 * part that repeat the new frame before them. PixVerse V6's new part can open
 * on a brief hold (a few near-identical frames, a stall at the join); the
 * extend stitch (`extend-stitch.ts`, `dropLeadingRepeats`) drops them after
 * the cut and counts them in its start trim.
 *
 * - The rule runs on PixVerse's own frames, at its own frame rate: the
 *   stitch's conform to the source's rate shows one PixVerse frame on several
 *   output frames when PixVerse's rate is lower, identical neighbours that are
 *   no hold. What it drops is then taken out of the output by time
 *   (`outputSkipOf`), so it is right at any output rate.
 * - The rule (`leadingRepeatDrop`, pure): each new frame is compared with its
 *   neighbour IN THE NEW PART, never with the source. The candidates start at
 *   the PixVerse frame the cut keeps first (`firstRepeatCandidate`): after a
 *   match, that frame, compared with the one before it (the matcher's dropped
 *   twin, or a frame the cut dropped); with no cut, the frame after the first
 *   one shown, which has nothing before it in the new part and so is never
 *   dropped by this rule. A frame at `REPEAT_MIN_PSNR_DB` or more is a repeat
 *   and is dropped; the first frame below it ends the run, at most
 *   `MAX_LEADING_REPEATS` PixVerse frames are dropped, and the new part's last
 *   frame is never a candidate.
 * - The measure (`leadingRepeatProbeArgs`, `measureLeadingRepeats`): one
 *   ffmpeg run over the new part alone, at its own rate (no conform), that
 *   writes no file. The frame before the first candidate and the candidates
 *   after it are scaled to a small picture (`REPEAT_PROBE_WIDTH` wide, as the
 *   matcher's) and each is compared with the next by ffmpeg's `psnr`: its
 *   average over the three planes, `inf` for identical frames. Nothing lossy
 *   comes between the decode and the comparison.
 */
import { runFfmpeg } from "./ffmpeg-utils.js"
import type { FrameSkip } from "./extend-stitch-args.js"

/** The PSNR at or above which a frame repeats the one before it, in dB (a held frame scores 66–72, motion 23–30). */
export const REPEAT_MIN_PSNR_DB = 50
/** The most leading repeats dropped, in PixVerse's own frames. */
export const MAX_LEADING_REPEATS = 12
/** The width the frames are compared at, as the matcher's proxies are. */
export const REPEAT_PROBE_WIDTH = 192

/** The new part's own frame rate and the stitch's output rate (the source's), in frames per second. */
export interface RepeatRates { native: number; output: number }

/** One rate for both: a PixVerse frame is an output frame. */
const SAME_RATE: RepeatRates = { native: 1, output: 1 }

/** Slack for a ratio that lands exactly on a whole number in exact arithmetic. */
const EPSILON = 1e-9

/**
 * The output frame at which the new part's own frame `nativeFrame` is first
 * shown: its start at the output rate, rounded to the nearest frame (half
 * up), as the stitch's conform (`fps`) rounds it.
 */
export function outputFrameOf(nativeFrame: number, rates: RepeatRates): number {
  return Math.round((nativeFrame * rates.output) / rates.native)
}

/**
 * The new part's own frame that output frame `outputFrame` shows: the last
 * one first shown there or earlier (`outputFrameOf`), as the conform keeps the
 * latest frame that reaches an output frame.
 */
export function nativeFrameShownAt(outputFrame: number, rates: RepeatRates): number {
  return Math.max(0, Math.ceil(((outputFrame + 0.5) * rates.native) / rates.output - EPSILON) - 1)
}

/**
 * The first PixVerse frame that can be a repeat, given the cut's start trim
 * (`keptStart`, output frames): the frame the first kept output frame shows,
 * compared with the frame before it; with no cut (0), the frame after the
 * first one shown, which is kept. Never frame 0, which has nothing before it.
 */
export function firstRepeatCandidate(keptStart: number, rates: RepeatRates = SAME_RATE): number {
  const shown = nativeFrameShownAt(keptStart, rates)
  return keptStart === 0 ? shown + 1 : Math.max(shown, 1)
}

/**
 * The leading repeats to drop, in PixVerse's own frames (pure): from
 * `firstRepeatCandidate(keptStart, rates)`, the run of frames whose PSNR
 * against the frame before them (`psnrToPrevious(k)`: frame k against frame
 * k − 1) is `REPEAT_MIN_PSNR_DB` or more, at most `MAX_LEADING_REPEATS`. A
 * frame with no number (unread, or past what was measured) ends the run.
 */
export function leadingRepeatDrop(keptStart: number, psnrToPrevious: (k: number) => number, rates: RepeatRates = SAME_RATE): FrameSkip {
  const from = firstRepeatCandidate(keptStart, rates)
  let count = 0
  while (count < MAX_LEADING_REPEATS && psnrToPrevious(from + count) >= REPEAT_MIN_PSNR_DB) count += 1
  return { from, count }
}

/**
 * The output frames that show the dropped PixVerse frames (`drop`), so their
 * time is what the stitch drops: from the output frame where the first of
 * them starts to the one where the frame after them starts (`outputFrameOf`).
 * Never an output frame before the first kept one (`keptStart`; with no cut,
 * the first one, whose PixVerse frame is kept), never the last output frame
 * (`outputFrames − 1`).
 */
export function outputSkipOf(drop: FrameSkip, keptStart: number, rates: RepeatRates, outputFrames: number): FrameSkip {
  const from = Math.max(outputFrameOf(drop.from, rates), keptStart === 0 ? 1 : keptStart)
  if (drop.count < 1) return { from, count: 0 }
  const to = Math.min(outputFrameOf(drop.from + drop.count, rates), outputFrames - 1)
  return { from, count: Math.max(0, to - from) }
}

/** Each compared pair's average PSNR from ffmpeg's `psnr` stats, in order: `inf` (identical frames) as Infinity. */
export function parsePsnrStats(stdout: string): number[] {
  return stdout
    .split("\n")
    .map((line) => /\bpsnr_avg:(\S+)/.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => (value === "inf" ? Infinity : Number(value)))
}

/** What the repeat measure reads (`leadingRepeatProbeArgs`). */
export interface LeadingRepeatProbe {
  /** The new part (the stitch's extension). */
  extensionPath: string
  /** The first candidate, in the new part's own frames (`firstRepeatCandidate`); the frame before it is read too. */
  from: number
  /** How many candidates are compared, each with the frame before it (1 to `MAX_LEADING_REPEATS`). */
  pairs: number
}

/**
 * The repeat measure's ffmpeg arguments (pure): the new part's own frames
 * [from − 1, from + pairs), at its own rate, `REPEAT_PROBE_WIDTH` wide, each
 * compared with the next: `pairs` comparisons, frame `from + j` against the
 * frame before it, their stats on stdout, nothing written.
 */
export function leadingRepeatProbeArgs(p: LeadingRepeatProbe): string[] {
  const start = p.from - 1
  const span = `trim=${start > 0 ? `start_frame=${start}:` : ""}end_frame=${p.from + p.pairs},setpts=PTS-STARTPTS`
  const graph = [
    `[0:v:0]${span},scale=${REPEAT_PROBE_WIDTH}:-2,setsar=1,format=yuv420p,setpts=N,split[ra][rb]`,
    `[ra]trim=end_frame=${p.pairs},setpts=PTS-STARTPTS[rp]`,
    "[rb]trim=start_frame=1,setpts=PTS-STARTPTS[rn]",
    "[rn][rp]psnr=stats_file=-:shortest=1",
  ].join(";")
  return ["-v", "error", "-i", p.extensionPath, "-filter_complex", graph, "-an", "-fps_mode", "passthrough", "-f", "null", "-"]
}

/** The new part's leading repeats: in its own frames (`native`), and the output frames that show them (`output`). */
export interface LeadingRepeats { native: FrameSkip; output: FrameSkip }

/**
 * Measure the new part's leading repeats after the cut, on its own frames
 * (`leadingRepeatDrop`), and the output frames that show them
 * (`outputSkipOf`). `keptStart` and `outputFrames` are at the output rate,
 * `nativeFrames` (its own frame count) at `rates.native`. Throws when ffmpeg
 * fails; the stitch then drops none.
 */
export async function measureLeadingRepeats(
  input: { extensionPath: string; rates: RepeatRates; keptStart: number; nativeFrames: number; outputFrames: number },
  launch?: { peakMemoryMiB: number },
): Promise<LeadingRepeats> {
  const { rates, keptStart } = input
  const from = firstRepeatCandidate(keptStart, rates)
  const pairs = Math.min(MAX_LEADING_REPEATS, input.nativeFrames - 1 - from)
  const none = { native: { from, count: 0 }, output: outputSkipOf({ from, count: 0 }, keptStart, rates, input.outputFrames) }
  if (pairs < 1) return none
  const stdout = await runFfmpeg(leadingRepeatProbeArgs({ extensionPath: input.extensionPath, from, pairs }), undefined, launch)
  const psnrs = parsePsnrStats(stdout).slice(0, pairs)
  const native = leadingRepeatDrop(keptStart, (k) => psnrs[k - from] ?? Number.NaN, rates)
  return { native, output: outputSkipOf(native, keptStart, rates, input.outputFrames) }
}
