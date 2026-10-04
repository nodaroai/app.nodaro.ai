/**
 * The BASE price of a video-utility run (Trim Video, Loop Video, Combine
 * Videos, Assemble Narrated Video), read from its request body.
 *
 * One mapping for both places such a run is charged: the single-node route's
 * credit guard (`computeCredits`) and the workflow run's reservation
 * (`node-executor.ts`), whose payload carries the same field names. Before it
 * existed the workflow path reserved the node's flat row whatever the length,
 * so the same trim cost differently depending on where it ran. The estimators
 * themselves live in `@nodaro/shared`, which the editor quotes from too.
 */
import {
  assembleNarratedVideoCredits,
  estimateCombineVideosCredits,
  estimateLoopVideoCredits,
  estimateTrimVideoCredits,
  type CombineVideosEstimatorInput,
  type LoopVideoEstimatorInput,
  type TrimVideoEstimatorInput,
} from "@nodaro/shared"

type Body = Readonly<Record<string, unknown>>

const num = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined)

export function trimVideoBaseCredits(body: Body): number {
  return estimateTrimVideoCredits(
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
  )
}

export function loopVideoBaseCredits(body: Body): number {
  return estimateLoopVideoCredits(
    {
      mode: body.mode as LoopVideoEstimatorInput["mode"],
      repeatCount: num(body.repeatCount),
      targetDuration: num(body.targetDuration),
      smartLoopCutBeforeRepeat: body.smartLoopCutBeforeRepeat as boolean | undefined,
      smartLoopCutLookback: num(body.smartLoopCutLookback),
    },
    num(body.upstreamDuration),
  )
}

export function combineVideosBaseCredits(body: Body): number {
  const urls = Array.isArray(body.videoUrls) ? body.videoUrls : []
  const rawDurations = Array.isArray(body.upstreamDurations) ? body.upstreamDurations : []
  // Align by position; drop length mismatches (estimator falls back per-position).
  const aligned = rawDurations.length === urls.length
    ? (rawDurations as Array<number | undefined>)
    : urls.map(() => undefined)
  return estimateCombineVideosCredits(
    {
      transition: body.transition as CombineVideosEstimatorInput["transition"],
      transitionDuration: num(body.transitionDuration),
      trimStartFrames: num(body.trimStartFrames),
      trimEndFrames: num(body.trimEndFrames),
    },
    aligned,
  )
}

/** Read the block count before any defaults: 1..60 blocks, the route's own bound. */
export function assembleNarratedVideoBaseCredits(body: Body): number {
  const n = Array.isArray(body.blocks) ? body.blocks.length : 0
  return assembleNarratedVideoCredits(Math.max(1, Math.min(60, n)))
}

const BASE_CREDITS_BY_JOB: Readonly<Record<string, (body: Body) => number>> = {
  "trim-video": trimVideoBaseCredits,
  "loop-video": loopVideoBaseCredits,
  "combine-videos": combineVideosBaseCredits,
  "assemble-narrated-video": assembleNarratedVideoBaseCredits,
}

/** The base price of a video-utility job, or undefined for any other job. */
export function videoUtilityBaseCredits(jobName: string, body: Body): number | undefined {
  return BASE_CREDITS_BY_JOB[jobName]?.(body)
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
  if (!(node.type in BASE_CREDITS_BY_JOB)) return undefined
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
