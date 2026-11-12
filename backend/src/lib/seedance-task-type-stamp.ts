import { resolveVideoRequestNorm, videoRequestAsRun, videoRequestReferenceMedia } from "./video-request-norm.js"

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
 *    the moved length before the reservation; this stamp does not.
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
