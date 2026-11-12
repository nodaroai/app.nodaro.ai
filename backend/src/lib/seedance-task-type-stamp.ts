import { resolveVideoRequestNorm, videoRequestAsRun, videoRequestReferenceMedia } from "./video-request-norm.js"
import { videoCreditIdOf, type VideoCreditIdArgs } from "./video-credit-id.js"

/**
 * The workflow run's twin of the video routes' reference task type resolution.
 *
 * A payload builder lane may put a REQUESTED `referenceTaskType` on a video
 * payload (the Video to Video node's Seedance edit requests `edit`), but the
 * builder is synchronous and cannot measure the reference clips — and `edit`
 * may only be declared when every one is measured inside the edit's lengths.
 * The node executor therefore calls this once the clips are measured, BEFORE
 * input_data is written and before anything is reserved, so the job record,
 * the reservation and the queued job all read the RESOLVED value.
 *
 * The decision is the routes' own: `resolveVideoRequestNorm`, fed the
 * payload's reference media and the executor's measurement through
 * `videoRequestReferenceMedia` (a failed probe, NaN, and a clip past the
 * measured ones are unmeasured). Nothing about the rule is restated here.
 *
 * Returns:
 *  - the SAME object when the payload requests nothing (no `referenceTaskType`
 *    key), so every other job is untouched;
 *  - otherwise a copy carrying the resolved value, or no key at all when nothing
 *    is declared. Every other field is left as built — the catalog snaps and
 *    priced fills the resolver also returns are the builder's to make — except
 *    the ratio and length a declaration moves (`videoRequestAsRun`). The edit
 *    lane already runs at the edit shape, so a requested edit moves neither.
 *    A lane whose request CAN be moved must also recompute its credit id from
 *    the moved length before the reservation; this stamp does not —
 *    {@link stampSeedanceReferenceTaskTypeForRun} does, and is what the executor calls.
 *
 * Never mutates `payload`.
 */
export function stampSeedanceReferenceTaskType(
  payload: Readonly<Record<string, unknown>>,
  refVideoDurationsSec: readonly number[] | undefined,
): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(payload, "referenceTaskType")) return payload as Record<string, unknown>
  const { referenceTaskType: requested, ...rest } = payload
  const norm = resolveVideoRequestNorm({
    provider: typeof payload.provider === "string" ? payload.provider : "",
    aspectRatio: typeof payload.aspectRatio === "string" ? payload.aspectRatio : undefined,
    resolution: typeof payload.resolution === "string" ? payload.resolution : undefined,
    duration: typeof payload.duration === "number" || typeof payload.duration === "string" ? payload.duration : undefined,
    draft: payload.draft === true,
    referenceTaskType: requested,
    referenceMedia: videoRequestReferenceMedia(payload, refVideoDurationsSec),
  })
  const asRun = videoRequestAsRun(rest, norm)
  return norm.referenceTaskType ? { ...asRun, referenceTaskType: norm.referenceTaskType } : asRun
}

/** A built job as the executor holds it when the reference clips are measured. */
export interface SeedanceTaskTypeBuiltRun {
  readonly payload: Readonly<Record<string, unknown>>
  /** The id the build priced the run at. */
  readonly modelIdentifier: string
  /** The arguments that id was built from (`PayloadResult.videoCreditIdArgs`). */
  readonly videoCreditIdArgs?: VideoCreditIdArgs
}

/** The run the executor records, reserves and queues. */
export interface SeedanceTaskTypeRun {
  payload: Record<string, unknown>
  /** The id the run is reserved under: the built one, unless the length moved. */
  modelIdentifier: string
  /**
   * The declaration would have moved the length, but the build carried no
   * arguments to re-price from: it was dropped and the run goes out as built.
   * The caller says so in its log.
   */
  droppedUnpriced: boolean
}

/** A length as the pricing reads it: a numeric string is its number. */
function lengthOf(duration: unknown): unknown {
  return typeof duration === "string" ? parseInt(duration, 10) : duration
}

/**
 * {@link stampSeedanceReferenceTaskType}, and the credit id that follows the
 * run it resolves. When the resolution moves the length (`edit` runs at Auto;
 * `extend` turns an Auto length into a fixed one), the id is rebuilt from the
 * lane's own price arguments with the moved length (`videoCreditIdOf`), so the
 * reservation is made for the length that runs — the id the video routes
 * reserve for the same request. A ratio alone is not priced and needs nothing.
 *
 * Fail safe, never mis-priced: when the length would move but the build carries
 * no price arguments, the payload goes out AS BUILT with the request removed
 * (undeclared, at the built ratio and length) and the built id, and
 * `droppedUnpriced` says so.
 *
 * Pure; never mutates `built`.
 */
export function stampSeedanceReferenceTaskTypeForRun(
  built: SeedanceTaskTypeBuiltRun,
  refVideoDurationsSec: readonly number[] | undefined,
): SeedanceTaskTypeRun {
  const asBuilt = { payload: built.payload as Record<string, unknown>, modelIdentifier: built.modelIdentifier, droppedUnpriced: false }
  const stamped = stampSeedanceReferenceTaskType(built.payload, refVideoDurationsSec)
  if (stamped === built.payload) return asBuilt
  if (Object.is(lengthOf(stamped.duration), lengthOf(built.payload.duration))) {
    return { ...asBuilt, payload: stamped }
  }
  const args = built.videoCreditIdArgs
  if (!args) {
    const { referenceTaskType: _dropped, ...undeclared } = built.payload
    return { ...asBuilt, payload: undeclared, droppedUnpriced: true }
  }
  return {
    payload: stamped,
    modelIdentifier: videoCreditIdOf({ ...args, duration: stamped.duration as number | string | undefined }),
    droppedUnpriced: false,
  }
}
