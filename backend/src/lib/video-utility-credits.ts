/**
 * The price of a video-utility run (Trim Video, Loop Video, Combine Videos,
 * Assemble Narrated Video), read from its request body: how many pricing UNITS
 * it is (sync, pure — `videoUtilityUnits`) and what those units are charged
 * (`videoUtilityChargeBaseCredits`: the node's own one-unit row × the units,
 * through `unitRateBaseCredits`).
 *
 * One mapping for both places such a run is charged: the single-node route's
 * credit guard (`computeCredits`) and the workflow run's reservation
 * (`node-executor.ts`), whose payload carries the same field names. Before it
 * existed the workflow path reserved the node's flat row whatever the length,
 * so the same trim cost differently depending on where it ran. The unit counts
 * come from the estimators in `@nodaro/shared` (units × CREDIT_UNIT, divided
 * back out here), which the editor quotes from too; the PRICE of a unit is the
 * node's `model_pricing` row, the row a quote reads, never `CREDIT_UNIT`
 * itself, so an administrator's retune moves the quote and the charge together.
 */
import {
  VIDEO_UTIL_PRICING,
  assembleNarratedVideoCredits,
  estimateCombineVideosCredits,
  estimateLoopVideoCredits,
  estimateTrimVideoCredits,
  type CombineVideosEstimatorInput,
  type LoopVideoEstimatorInput,
  type TrimVideoEstimatorInput,
} from "@nodaro/shared"
import { unitRateBaseCredits } from "./credit-base-cost.js"

type Body = Readonly<Record<string, unknown>>

const num = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined)

/** The estimators price units × CREDIT_UNIT; a run's unit count is that over the unit. */
const unitsOf = (estimatorCredits: number): number => estimatorCredits / VIDEO_UTIL_PRICING.CREDIT_UNIT

export function trimVideoUnits(body: Body): number {
  return unitsOf(estimateTrimVideoCredits(
    {
      trimMode: body.trimMode as TrimVideoEstimatorInput["trimMode"],
      startTime: num(body.startTime),
      endTime: num(body.endTime),
      trimStartFrames: num(body.trimStartFrames),
      trimEndFrames: num(body.trimEndFrames),
      trimStartSeconds: num(body.trimStartSeconds),
      trimEndSeconds: num(body.trimEndSeconds),
      keepFirstSeconds: num(body.keepFirstSeconds),
      keepLastSeconds: num(body.keepLastSeconds),
      smartLoopCutLookback: num(body.smartLoopCutLookback),
    },
    num(body.upstreamDuration),
  ))
}

export function loopVideoUnits(body: Body): number {
  return unitsOf(estimateLoopVideoCredits(
    {
      mode: body.mode as LoopVideoEstimatorInput["mode"],
      repeatCount: num(body.repeatCount),
      targetDuration: num(body.targetDuration),
      smartLoopCutBeforeRepeat: body.smartLoopCutBeforeRepeat as boolean | undefined,
      smartLoopCutLookback: num(body.smartLoopCutLookback),
    },
    num(body.upstreamDuration),
  ))
}

export function combineVideosUnits(body: Body): number {
  const urls = Array.isArray(body.videoUrls) ? body.videoUrls : []
  const rawDurations = Array.isArray(body.upstreamDurations) ? body.upstreamDurations : []
  // Align by position; drop length mismatches (estimator falls back per-position).
  const aligned = rawDurations.length === urls.length
    ? (rawDurations as Array<number | undefined>)
    : urls.map(() => undefined)
  return unitsOf(estimateCombineVideosCredits(
    {
      transition: body.transition as CombineVideosEstimatorInput["transition"],
      transitionDuration: num(body.transitionDuration),
      trimStartFrames: num(body.trimStartFrames),
      trimEndFrames: num(body.trimEndFrames),
    },
    aligned,
  ))
}

/** Read the block count before any defaults: 1..60 blocks, the route's own bound. */
export function assembleNarratedVideoUnits(body: Body): number {
  const n = Array.isArray(body.blocks) ? body.blocks.length : 0
  return unitsOf(assembleNarratedVideoCredits(Math.max(1, Math.min(60, n))))
}

const UNITS_BY_JOB: Readonly<Record<string, (body: Body) => number>> = {
  "trim-video": trimVideoUnits,
  "loop-video": loopVideoUnits,
  "combine-videos": combineVideosUnits,
  "assemble-narrated-video": assembleNarratedVideoUnits,
}

/** The video-utility jobs (each also its node type and its one-unit price row). */
export const VIDEO_UTILITY_JOB_NAMES: readonly string[] = Object.freeze(Object.keys(UNITS_BY_JOB))

/** The pricing units of a video-utility job (at least one), or undefined for any other job. */
export function videoUtilityUnits(jobName: string, body: Body): number | undefined {
  return UNITS_BY_JOB[jobName]?.(body)
}

/**
 * The BASE price (before the markup) a video-utility run is charged: its own
 * one-unit row × its units (`unitRateBaseCredits`), or undefined for any other
 * job. What the route's guard and the workflow run reserve.
 */
export async function videoUtilityChargeBaseCredits(jobName: string, body: Body): Promise<number | undefined> {
  const units = videoUtilityUnits(jobName, body)
  return units === undefined ? undefined : unitRateBaseCredits(jobName, units)
}

/**
 * A workflow ESTIMATE's stand-in request for a video-utility node, before
 * anything has run: the node's own settings with the defaults the workflow run
 * applies (payload-builder.ts), the clips and blocks its wires bring, and no
 * upstream length — the estimators' fallback length stands in, as in the
 * editor. Undefined for any other node.
 */
export function videoUtilityEstimateBody(
  node: { id?: string; type: string; data?: Record<string, unknown> },
  edges: ReadonlyArray<{ target: string; targetHandle?: string | null }> = [],
): Body | undefined {
  if (!(node.type in UNITS_BY_JOB)) return undefined
  const data = node.data ?? {}
  const incoming = node.id === undefined ? [] : edges.filter((e) => e.target === node.id)
  switch (node.type) {
    case "loop-video":
      return { ...data, repeatCount: data.repeatCount ?? data.loops }
    case "combine-videos":
      return {
        transition: data.transition ?? "cut",
        transitionDuration: data.transitionDuration ?? 0.5,
        trimStartFrames: data.trimStartFrames ?? 1,
        trimEndFrames: data.trimEndFrames ?? 2,
        videoUrls: incoming.map(() => ""),
      }
    case "assemble-narrated-video":
      return { blocks: incoming.filter((e) => e.targetHandle === "video").map(() => ({})) }
    default:
      return data
  }
}
