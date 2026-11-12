import {
  normalizeVideoRequestParams,
  type ModelInputAdjustment,
} from "@nodaro/shared/model-catalog"
import {
  pricedVideoSelection,
} from "@nodaro/shared/credits"
import {
  resolveSeedanceTaskType,
  type DeclaredSeedanceTaskType,
} from "@nodaro/shared/models"

/**
 * The normalized + priced video params for one request — the values a video
 * lane prices, persists to `input_data` and sends on the wire. They must be the
 * SAME values at all three billing sites (credit-identifier preHandler,
 * `computeCredits`, reservation) because `commit_credits` (migration 176) only
 * ever refunds a surplus and never collects a shortfall, so the reservation IS
 * the final charge.
 */
export interface VideoRequestNorm {
  /** Catalog-snapped aspect ratio. Billing-neutral; rides along so the wire and
   *  `input_data` record what we actually sent. */
  aspectRatio?: string
  /** Catalog-snapped resolution, or — when the request omitted one — the band
   *  the credit identifier prices, where the platform declares it. */
  resolution?: string
  /** The length to send when it is not the requested one: the seeded tier a
   *  duration-tiered price keys on (LTX), a length-priced model's own length,
   *  or the length a declared reference task type runs at. `undefined` means
   *  "send the requested duration". */
  duration?: number
  /** Levers the caller asked for and did not get, for disclosure. */
  adjustments: ModelInputAdjustment[]
  /** The reference task type this request declares, resolved
   *  (`resolveSeedanceTaskType`; a draft declares as any other run). Absent:
   *  nothing is declared (`auto`, a model that takes none, media that does not
   *  qualify). */
  referenceTaskType?: DeclaredSeedanceTaskType
  /** The ratio and length the declared task type moved the request to, as the
   *  resolver returned them (before the catalog steps). Present only when it
   *  moved one: pricing reads the request through it ({@link videoRequestAsRun}). */
  referenceTaskShape?: { aspectRatio: string | undefined; duration: number | undefined }
}

/**
 * A request's reference media, as the reference task type is decided on:
 * true reference media only. A start or end frame is never counted.
 */
export interface VideoRequestReferenceMedia {
  /** Reference images (`referenceImageUrls`). */
  imageCount: number
  /** Reference audio clips (`referenceAudioUrls`). */
  audioCount: number
  /** One entry per reference video; `undefined` = its length was not measured. */
  videoSec: ReadonlyArray<number | undefined>
}

const countOf = (list: unknown): number => (Array.isArray(list) ? list.length : 0)

/**
 * The reference media of a video request body, with each reference video's
 * length from the route's measurement (`req.refVideoDurationsSec`, index-aligned
 * with `referenceVideoUrls`). A failed probe is stored as NaN and a clip past
 * the measured ones has no entry: both are unmeasured. The pricing resolver and
 * the handler both build it here, from the reference arrays as sent, so the two
 * resolve the same declaration.
 */
export function videoRequestReferenceMedia(
  body: { referenceImageUrls?: unknown; referenceVideoUrls?: unknown; referenceAudioUrls?: unknown },
  measuredSec: readonly number[] | undefined,
): VideoRequestReferenceMedia {
  const videos = Array.isArray(body.referenceVideoUrls) ? body.referenceVideoUrls : []
  return {
    imageCount: countOf(body.referenceImageUrls),
    audioCount: countOf(body.referenceAudioUrls),
    videoSec: videos.map((_, i) => {
      const sec = measuredSec?.[i]
      return typeof sec === "number" && Number.isFinite(sec) ? sec : undefined
    }),
  }
}

/** A request's length as a number, read the way the pricing helpers read it. */
function parsedDuration(duration: number | string | undefined): number | undefined {
  const parsed = typeof duration === "string" ? parseInt(duration, 10) : duration
  return parsed === undefined || Number.isNaN(parsed) ? undefined : parsed
}

/**
 * The ONE place a video request's catalog-governed params become the values we
 * price, persist and send. Both video routes call it at all three billing sites
 * and in their handler, and the orchestrator's video branches call it too; it is
 * pure, so those sites cannot disagree by construction.
 *
 * Three steps, in order — each reads the one before:
 *   0. `resolveSeedanceTaskType` decides the reference task type the request
 *      declares, on the RAW ratio and length. A declaration can force both
 *      (`edit`: the video's own shape and length; `extend`: its shape and a set
 *      length); the steps below then read the forced values, so every billing
 *      site prices the run that is sent. A request that declares nothing, or
 *      whose declaration moves nothing, reaches them exactly as sent.
 *   1. `normalizeVideoRequestParams` snaps aspectRatio/resolution onto the
 *      model's catalog list (NEAREST, case-canonicalised, never dropped —
 *      dropping a resolution would LOWER the reserved tier).
 *   2. `pricedVideoSelection` fills what the credit identifier ASSUMES for a
 *      lever the request omitted (only where the platform declares that band as
 *      the provider's own default) and carries the seeded LTX duration tier.
 *      Without it a route reserves 1080p and sends no resolution at all, letting
 *      the provider apply its own undocumented default — and reserves the 6s LTX
 *      tier while sending 7s.
 *
 * `referenceMedia` omitted means the request has none, so a declaration is
 * dropped: a caller that does not pass it gets exactly the two catalog steps.
 *
 * Lives in `lib/` rather than beside its first caller so the orchestrator can
 * reach it without importing a route module (the video routes statically import
 * `ee/billing/credits.js`, which core code may not pull in transitively).
 */
export function resolveVideoRequestNorm(input: {
  provider: string
  aspectRatio?: string
  resolution?: string
  duration?: number | string
  /** Seedance Draft: a draft-capable model is priced AND sent at 480p,
   *  whatever resolution came with it (`normalizeVideoRequestParams`). */
  draft?: boolean
  /** The request's `referenceTaskType`, unvalidated: anything the model does not
   *  list is `auto` (nothing declared). */
  referenceTaskType?: unknown
  /** Omitted = no reference media: a declaration is dropped (today's request). */
  referenceMedia?: VideoRequestReferenceMedia
}): VideoRequestNorm {
  const media = input.referenceMedia
  const task = resolveSeedanceTaskType({
    provider: input.provider,
    requested: media ? input.referenceTaskType : undefined,
    referenceImageCount: media?.imageCount ?? 0,
    referenceAudioCount: media?.audioCount ?? 0,
    referenceVideoSec: media?.videoSec ?? [],
    aspectRatio: input.aspectRatio,
    duration: parsedDuration(input.duration),
  })
  const shape = task.taskType !== undefined
    && (task.aspectRatio !== input.aspectRatio || task.duration !== parsedDuration(input.duration))
    ? { aspectRatio: task.aspectRatio, duration: task.duration }
    : undefined

  const norm = normalizeVideoRequestParams(input.provider, {
    aspectRatio: shape ? shape.aspectRatio : input.aspectRatio,
    resolution: input.resolution,
    draft: input.draft,
  })
  const priced = pricedVideoSelection({
    provider: input.provider,
    resolution: norm.resolution,
    duration: shape ? shape.duration : input.duration,
  })
  return {
    aspectRatio: norm.aspectRatio,
    resolution: norm.resolution ?? priced.resolution,
    // An Auto length is left alone by step 2, so the forced one is carried here.
    duration: priced.duration ?? shape?.duration,
    adjustments: [...task.adjustments, ...norm.adjustments, ...priced.adjustments],
    ...(task.taskType ? { referenceTaskType: task.taskType } : {}),
    ...(shape ? { referenceTaskShape: shape } : {}),
  }
}

/**
 * `body` as the run sends it: when a declared reference task type moved the
 * request's ratio or length, those two fields carry the moved values; any other
 * request comes back as the SAME object. A route's `computeCredits` reads the
 * body through this, so a declared run prices exactly as the same body sent
 * with that ratio and length — and no reader of the body there can pick up the
 * ratio or length the declaration replaced.
 */
export function videoRequestAsRun<T extends Record<string, unknown>>(body: T, norm: VideoRequestNorm | undefined): T {
  const shape = norm?.referenceTaskShape
  if (!shape) return body
  return { ...body, aspectRatio: shape.aspectRatio, duration: shape.duration }
}
