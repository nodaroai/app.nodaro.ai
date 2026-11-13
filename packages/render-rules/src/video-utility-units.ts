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

function trimUnits(body: Body, clipSec: number | undefined): number {
  return Math.max(...trimVideoBranches(body).map((branch) => trimBranchUnits(branch, body, clipSec)))
}

function trimBranchUnits(branch: TrimVideoBranch, body: Body, clipSec: number | undefined): number {
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
 * `undefined` where a clip's length is not known). `undefined` for any other
 * type.
 */
export function videoUtilityUnitsOf(type: string, body: Body, clipSecs: ReadonlyArray<number | undefined>): number | undefined {
  switch (type) {
    case "trim-video":
      return trimUnits(body, videoUtilityPricedClipSec(clipSecs[0]))
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
    case "combine-videos":
      return unitsOf(estimateCombineVideosCredits(
        {
          transition: body.transition as CombineVideosEstimatorInput["transition"],
          transitionDuration: num(body.transitionDuration),
          trimStartFrames: num(body.trimStartFrames),
          trimEndFrames: num(body.trimEndFrames),
        },
        clipSecs.map(videoUtilityPricedClipSec),
      ))
    default:
      return undefined
  }
}
