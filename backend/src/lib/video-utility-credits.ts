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
 * back out here) — for Trim, Loop and Combine Videos through the shared rule
 * that applies the frame grace (`videoUtilityUnitsOf`), which the editor quotes
 * from too; the PRICE of a unit is the
 * node's `model_pricing` row, the row a quote reads, never `CREDIT_UNIT`
 * itself, so an administrator's retune moves the quote and the charge together.
 */
import { VIDEO_UTIL_PRICING, assembleNarratedVideoCredits } from "@nodaro/shared/credits"
import { loopVideoRunFields, trimVideoRunFields, VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, videoUtilityUnitsOf } from "@nodaro/render-rules"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import type { ClipLengthReading } from "./video-utility-probe.js"

type Body = Readonly<Record<string, unknown>>

const num = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined)

/** The estimators price units × CREDIT_UNIT; a run's unit count is that over the unit. */
const unitsOf = (estimatorCredits: number): number => estimatorCredits / VIDEO_UTIL_PRICING.CREDIT_UNIT

/**
 * Trim, Loop and Combine Videos count their units by the one shared rule
 * (`videoUtilityUnitsOf`, @nodaro/render-rules: each clip less the frame grace,
 * then the node's own formula) — the rule the editor's quote counts by too —
 * at the lengths the body carries (`upstreamDuration` / `upstreamDurations`:
 * the measured lengths on a run, the planned ones on an estimate).
 */
export function trimVideoUnits(body: Body): number {
  return videoUtilityUnitsOf("trim-video", body, [num(body.upstreamDuration)])!
}

export function loopVideoUnits(body: Body): number {
  return videoUtilityUnitsOf("loop-video", body, [num(body.upstreamDuration)])!
}

export function combineVideosUnits(body: Body): number {
  const urls = Array.isArray(body.videoUrls) ? body.videoUrls : []
  const rawDurations = Array.isArray(body.upstreamDurations) ? body.upstreamDurations : []
  // Align by position; drop length mismatches (estimator falls back per-position).
  const aligned = rawDurations.length === urls.length
    ? (rawDurations as unknown[]).map(num)
    : urls.map(() => undefined)
  return videoUtilityUnitsOf("combine-videos", body, aligned)!
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

/**
 * The video-utility jobs charged by the measured length of the clips they are
 * given (lib/video-utility-length.ts): every run measures each input before
 * anything is reserved, and the render re-measures what it downloads.
 */
export const MEASURED_VIDEO_UTILITY_JOBS: ReadonlySet<string> = new Set(["trim-video", "loop-video", "combine-videos"])

/**
 * A clip a run will make, as a quote prices it before it exists: its planned
 * seconds plus the slack a made clip carries past its length
 * (`VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC`); the frame grace comes off inside the
 * units rule (`videoUtilityUnitsOf`), as on every Trim, Loop and Combine Videos
 * quote. Anything but a positive number of seconds stays unknown: the
 * estimators' 8-second stand-in, a minimum. The UGC join's quotes (the
 * canvas's `ugc-estimate.ts` and the MCP planner's `ugc-quote.ts`) both price
 * each clip through this.
 */
export function plannedMadeClipSec(sec: unknown): number | undefined {
  return typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? sec + VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC : undefined
}

/** The most clips one Combine Videos run joins: a longer list is refused before any clip is fetched or looked up. */
export const COMBINE_VIDEOS_MAX_CLIPS = 100

/** What a Combine Videos of more clips than {@link COMBINE_VIDEOS_MAX_CLIPS} is answered, on every surface. */
export function combineVideosTooManyClipsMessage(count: number): string {
  return `Combine Videos joins at most ${COMBINE_VIDEOS_MAX_CLIPS} clips; this run has ${count}.`
}

/**
 * The length a measured video-utility job reads each clip at — the one its
 * worker joins or cuts by: Combine Videos each clip's video stream
 * (`getVideoStreamDuration`, where it joins), Trim and Loop the container. The
 * charge before a run and the render's check read the same.
 */
export function videoUtilityClipReading(jobName: string): ClipLengthReading {
  return jobName === "combine-videos" ? "video-stream" : "container"
}

/** The clips a measured video-utility request hands its run, in order: Trim and Loop its `videoUrl`, Combine Videos its `videoUrls`. */
export function videoUtilityInputUrls(jobName: string, body: Body): readonly unknown[] {
  if (jobName === "combine-videos") return Array.isArray(body.videoUrls) ? body.videoUrls : []
  return [body.videoUrl]
}

/**
 * A request body with `secs` — each input clip's length, in the order of
 * {@link videoUtilityInputUrls} — in place of any length it carried
 * (`upstreamDuration` / `upstreamDurations`), so the unit count prices the
 * clips the run measured, never a length a caller sent.
 */
export function withMeasuredInputLengths(jobName: string, body: Body, secs: readonly number[]): Record<string, unknown> {
  return jobName === "combine-videos" ? { ...body, upstreamDurations: [...secs] } : { ...body, upstreamDuration: secs[0] }
}

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
 * applies (payload-builder.ts; a Trim's the fields of its mode,
 * `trimVideoRunFields`), the clips and blocks its wires bring, and no
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
    case "trim-video":
      return { ...data, ...trimVideoRunFields(data) }
    case "loop-video":
      return { ...data, ...loopVideoRunFields(data) }
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
