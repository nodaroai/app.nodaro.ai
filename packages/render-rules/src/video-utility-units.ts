/**
 * The pricing units of a Trim Video, Loop Video or Combine Videos run, from
 * its settings and the length of each clip it is given: the ONE rule the
 * charge (the routes, the workflow run, a pipeline step), the render's check,
 * the server's workflow estimate, the app listing and the editor's quote all
 * count units by. The formula is each node's own (`@nodaro/shared`'s
 * estimators: 5 seconds of output a unit, at least one); this rule decides the
 * length each clip is priced at:
 * - each clip less {@link VIDEO_UTILITY_PRICE_GRACE_SEC} (a frame past a
 *   5-second mark is free), floored at 0, and less a float-noise hair (a sum of
 *   lengths that lands a hair past a mark is not a unit more);
 * - a clip of unknown length stays unknown: the estimators' 8-second
 *   stand-in, a minimum (the run is charged what it measures).
 * Trim's clip, Loop's clip (before its copies multiply it), and each clip a
 * Combine Videos joins get the grace once.
 *
 * Trim is priced by what it cuts: the branch its worker runs, read from the
 * fields the request sets, in the worker's own order (`trimVideoBranches`) —
 * never by the `trimMode` it names, which the worker does not read. A time
 * cut with no end runs to the clip's end and is priced from its start to the
 * clip's end (the clip less the grace, less the start); a time cut whose end
 * is past the clip ends at the clip too, so it is priced up to the clip's end
 * when the clip's length is known (an unknown clip is not cut at the 8-second
 * stand-in: a longer clip would then be charged above its quote). A start at
 * or past the clip's end is the one-unit minimum.
 *
 * Frame trims are cut at the clip's real frame rate (decided 2026-11-14: the
 * `r_frame_rate` the worker cuts by; the charge and the render's check read
 * it from the probed file, a quote from the rate the graph knows —
 * `runWireFps`). A Trim's frames become seconds at its clip's rate; a Combine
 * Videos' at the one rate the join conforms its clips to
 * ({@link combineTargetFps}), and only where they are cut (decided 2026-11-14,
 * "charge what is cut"): at each of its n − 1 joins, the end of the clip before
 * and the start of the clip after — never the film's own first and last frames.
 * Each join takes off its own transition's overlap (a request's per-join
 * `transitions`; the global one where it sets none). With Smart cut on, the
 * trims are found during the render, so the fixed trim values price it; a
 * smart-cut boundary mask (an intentional hard cut, no trims) is set only by
 * the platform's own plugin combines, never by a charged Combine Videos run. A rate that is not known cuts no frames: the
 * uncut clip, a bound (the run cuts by the rate it reads, and a Trim whose
 * rate cannot be read fails before anything is kept).
 */
import {
  estimateCombineVideosCredits,
  estimateLoopVideoCredits,
  estimateTrimVideoCredits,
  VIDEO_UTIL_PRICING,
  type CombineVideosEstimatorInput,
  type LoopVideoEstimatorInput,
  type TrimVideoEstimatorInput,
} from "@nodaro/shared/credits"
import { VIDEO_UTILITY_PRICE_GRACE_SEC } from "./measured-wire-length"

/** The steps this rule prices. */
export const GRACED_VIDEO_UTILITY_TYPES: ReadonlySet<string> = new Set(["trim-video", "loop-video", "combine-videos"])

/**
 * Float noise: a length that is arithmetic (planned + slack − grace, a sum of
 * clips) can land a hair past a mark and must not round up for it — the
 * `priced-clip-seconds` pattern, in the user's favour.
 */
const FLOAT_NOISE_SEC = 1e-9

type Body = Readonly<Record<string, unknown>>
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/** A clip's length as these steps price it: less the grace and the float noise, at least 0; unknown stays unknown. */
export function videoUtilityPricedClipSec(sec: number | undefined): number | undefined {
  return sec === undefined || !Number.isFinite(sec) ? undefined : Math.max(0, sec - VIDEO_UTILITY_PRICE_GRACE_SEC - FLOAT_NOISE_SEC)
}

const unitsOf = (estimatorCredits: number): number => estimatorCredits / VIDEO_UTIL_PRICING.CREDIT_UNIT

/** A clip's frame rate, when it is one (a positive, finite number of frames a second). */
const rateOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)

/** The rate Combine Videos reads a clip at whose rate cannot be read (the worker's `getVideoFps`). */
export const UNREADABLE_CLIP_FPS = 30

/** The rate Combine Videos conforms an empty set of clips to (the worker's own default). */
const COMBINE_DEFAULT_FPS = 24

/**
 * The one frame rate Combine Videos conforms its clips to before it joins and
 * trims them (the worker's `pickTargetFps`): the rate most clips share, keyed
 * to 0.001 (29.97 = 30000/1001), a tie to the higher; 24 for no clips; at
 * least 1 and at most 60. `rates` are the clips' own, as the worker reads each
 * (a rate it cannot read counts as the worker's 30).
 */
export function combineTargetFps(rates: readonly number[]): number {
  const counts = new Map<number, number>()
  for (const r of rates) {
    const rate = Math.round(r * 1000) / 1000
    counts.set(rate, 1 + (counts.get(rate) ?? 0))
  }
  let best = { fps: COMBINE_DEFAULT_FPS, count: 0 }
  for (const [fps, count] of counts) {
    if (count > best.count || (count === best.count && fps > best.fps)) best = { fps, count }
  }
  return Math.min(60, Math.max(1, best.fps))
}

/** The rate a Combine Videos of `clipCount` clips cuts its frame trims at: its target over every clip's rate, when all are known. */
function combineTrimFps(clipFps: ReadonlyArray<number | undefined>, clipCount: number): number | undefined {
  const rates = Array.from({ length: clipCount }, (_, i) => rateOf(clipFps[i]))
  return clipCount > 0 && rates.every((r) => r !== undefined) ? combineTargetFps(rates as number[]) : undefined
}

/** The cuts a Trim run can make, as the estimator names them. */
export type TrimVideoBranch = NonNullable<TrimVideoEstimatorInput["trimMode"]>

const isSet = (v: unknown): boolean => v !== undefined && v !== null
const positive = (v: unknown): boolean => (num(v) ?? 0) > 0

/**
 * The branch a Trim run cuts by, as its worker decides it (the trim handler and
 * `trimVideo`), in the worker's own order:
 * 1. `smartLoopCut` → the smart loop cut;
 * 2. a keep or seconds field set → keep the last N, else keep the first N,
 *    else trim seconds off the ends (the worker's own precedence among them);
 * 3. a frames field set → trim frames;
 * 4. otherwise the time range — whatever `trimMode` the request names: with no
 *    field of another branch set, the worker cuts by time (a
 *    `keep-first-seconds` with no seconds given cuts the whole time range, not
 *    nothing; a `smart-loop-cut` without `smartLoopCut: true` cuts no loop).
 * Fields of two branches set in one request (a keep field and a frames field)
 * give both: the request is priced at the larger, since the worker's later
 * branch overrides only part of the earlier one's cut.
 */
export function trimVideoBranches(body: Body): readonly TrimVideoBranch[] {
  if (body.smartLoopCut === true) return ["smart-loop-cut"]
  const branches: TrimVideoBranch[] = []
  if (isSet(body.keepLastSeconds) || isSet(body.keepFirstSeconds) || isSet(body.trimStartSeconds) || isSet(body.trimEndSeconds)) {
    branches.push(positive(body.keepLastSeconds) ? "keep-last-seconds" : positive(body.keepFirstSeconds) ? "keep-first-seconds" : "seconds")
  }
  if (isSet(body.trimStartFrames) || isSet(body.trimEndFrames)) branches.push("frames")
  return branches.length > 0 ? branches : ["time"]
}

/**
 * Whether a Trim cuts a fixed time window (a time cut with an end, and no field
 * of another cut): its price is the window's, cut only at a clip shorter than
 * the window, so it never rises past the window's. The app listing lists it at
 * the window whatever the recording — a price that rises with a recording and
 * then stops would be over-stated by the listing's steepest rise per minute.
 */
export function trimVideoCutsFixedWindow(body: Body): boolean {
  const branches = trimVideoBranches(body)
  return branches.length === 1 && branches[0] === "time" && num(body.endTime) !== undefined
}

/**
 * The fields a Combine Videos run in a workflow prices by, from the node's
 * settings with the defaults the workflow run applies (payload-builder: a
 * cut, 0.5 s, the 1 + 2 frame trims). Never the per-join `transitions` a
 * request to the route may carry: a workflow run sends none, so its quote
 * reads none.
 */
export function combineVideosRunFields(data: Body): Record<string, unknown> {
  return {
    transition: data.transition ?? "cut",
    transitionDuration: data.transitionDuration ?? 0.5,
    trimStartFrames: data.trimStartFrames ?? COMBINE_DEFAULT_TRIM_START_FRAMES,
    trimEndFrames: data.trimEndFrames ?? COMBINE_DEFAULT_TRIM_END_FRAMES,
  }
}

/** The frame trims a Combine Videos join cuts when a request or a node sets none (the route's and the workflow run's defaults). */
export const COMBINE_DEFAULT_TRIM_START_FRAMES = 1
export const COMBINE_DEFAULT_TRIM_END_FRAMES = 2

/**
 * The fields a Trim run sends its worker, from the node's settings: the ones of
 * its `trimMode` (default `time`) only, as the workflow run's payload and the
 * editor's run send them, and an end time that is not after 0 left out — a
 * time cut with no end, which runs to the clip's end (the node's default end
 * is 0). What the workflow run sends and what a quote of the node prices.
 */
export function trimVideoRunFields(data: Body): Record<string, unknown> {
  const trimMode = typeof data.trimMode === "string" ? data.trimMode : "time"
  const endTime = trimMode === "time" ? (data.endTime ?? undefined) : undefined
  return {
    trimMode,
    startTime: trimMode === "time" ? data.startTime : 0,
    endTime: typeof endTime === "number" && !(endTime > 0) ? undefined : endTime,
    trimStartFrames: trimMode === "frames" ? data.trimStartFrames : undefined,
    trimEndFrames: trimMode === "frames" ? data.trimEndFrames : undefined,
    trimStartSeconds: trimMode === "seconds" ? data.trimStartSeconds : undefined,
    trimEndSeconds: trimMode === "seconds" ? data.trimEndSeconds : undefined,
    keepFirstSeconds: trimMode === "keep-first-seconds" ? data.keepFirstSeconds : undefined,
    keepLastSeconds: trimMode === "keep-last-seconds" ? data.keepLastSeconds : undefined,
    smartLoopCut: trimMode === "smart-loop-cut",
    smartLoopCutLookback: trimMode === "smart-loop-cut" ? data.smartLoopCutLookback : undefined,
  }
}

function trimUnits(body: Body, clipSec: number | undefined, clipFps: number | undefined): number {
  return Math.max(...trimVideoBranches(body).map((branch) => trimBranchUnits(branch, body, clipSec, clipFps)))
}

function trimBranchUnits(branch: TrimVideoBranch, body: Body, clipSec: number | undefined, clipFps: number | undefined): number {
  // Frames are cut at the clip's own rate, as the worker cuts them (`startTime = frames / fps`,
  // `endTime = length − frames / fps`): the seconds cut. A rate not known cuts none — the uncut clip.
  if (branch === "frames") {
    const secOf = (frames: unknown) => (clipFps === undefined ? 0 : Math.max(0, num(frames) ?? 0) / clipFps)
    return unitsOf(estimateTrimVideoCredits({ trimMode: "seconds", trimStartSeconds: secOf(body.trimStartFrames), trimEndSeconds: secOf(body.trimEndFrames) }, clipSec))
  }
  const endTime = num(body.endTime)
  // A time cut with no end runs from its start to the clip's end: the seconds cut of its start.
  if (branch === "time" && endTime === undefined) {
    return unitsOf(estimateTrimVideoCredits({ trimMode: "seconds", trimStartSeconds: num(body.startTime) ?? 0 }, clipSec))
  }
  return unitsOf(estimateTrimVideoCredits(
    {
      trimMode: branch,
      startTime: num(body.startTime),
      // A window past the clip's end is cut at the clip (`clipSec` is already the priced clip: less the grace).
      endTime: branch === "time" && endTime !== undefined && clipSec !== undefined ? Math.min(endTime, clipSec) : endTime,
      trimStartFrames: num(body.trimStartFrames),
      trimEndFrames: num(body.trimEndFrames),
      trimStartSeconds: num(body.trimStartSeconds),
      trimEndSeconds: num(body.trimEndSeconds),
      keepFirstSeconds: num(body.keepFirstSeconds),
      keepLastSeconds: num(body.keepLastSeconds),
      smartLoopCutLookback: num(body.smartLoopCutLookback),
    },
    clipSec,
  ))
}

/**
 * The units of a `type` run (`trim-video`, `loop-video`, `combine-videos`)
 * with these settings (`body`: the request or payload a run sends, or a node's
 * settings for a quote) on clips of `clipSecs` seconds (in input order;
 * `undefined` where a clip's length is not known) at `clipFps` frames a second
 * (in the same order; `undefined`, or missing, where a clip's rate is not
 * known: its frame trims cut nothing). `undefined` for any other type.
 */
export function videoUtilityUnitsOf(
  type: string,
  body: Body,
  clipSecs: ReadonlyArray<number | undefined>,
  clipFps: ReadonlyArray<number | undefined> = [],
): number | undefined {
  switch (type) {
    case "trim-video":
      return trimUnits(body, videoUtilityPricedClipSec(clipSecs[0]), rateOf(clipFps[0]))
    case "loop-video":
      return unitsOf(estimateLoopVideoCredits(
        {
          mode: body.mode as LoopVideoEstimatorInput["mode"],
          repeatCount: num(body.repeatCount),
          targetDuration: num(body.targetDuration),
          smartLoopCutBeforeRepeat: body.smartLoopCutBeforeRepeat as boolean | undefined,
          smartLoopCutLookback: num(body.smartLoopCutLookback),
        },
        videoUtilityPricedClipSec(clipSecs[0]),
      ))
    case "combine-videos": {
      // Its frame trims at the rate the join conforms its clips to; not known, no frames cut (the bound).
      const fps = combineTrimFps(clipFps, clipSecs.length)
      const trims: Pick<CombineVideosEstimatorInput, "trimStartFrames" | "trimEndFrames" | "trimFramesPerSecond"> = fps === undefined
        ? { trimStartFrames: 0, trimEndFrames: 0 }
        // A trim the request leaves out is the one the join cuts by default (the route's and the workflow run's 1 + 2).
        : {
            trimStartFrames: num(body.trimStartFrames) ?? COMBINE_DEFAULT_TRIM_START_FRAMES,
            trimEndFrames: num(body.trimEndFrames) ?? COMBINE_DEFAULT_TRIM_END_FRAMES,
            trimFramesPerSecond: fps,
          }
      return unitsOf(estimateCombineVideosCredits(
        {
          transition: body.transition as CombineVideosEstimatorInput["transition"],
          transitionDuration: num(body.transitionDuration),
          ...trims,
          // Each join's own transition where the request sets one (`transitions`), as the join renders it.
          ...(Array.isArray(body.transitions) ? { transitions: body.transitions as CombineVideosEstimatorInput["transitions"] } : {}),
        },
        clipSecs.map(videoUtilityPricedClipSec),
      ))
    }
    default:
      return undefined
  }
}
