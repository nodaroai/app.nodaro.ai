/**
 * THE completion tail for every entity-media job — Character / Face / Object /
 * Creature / Location studios, main images, asset variants and motion clips.
 *
 * ## Why this file exists
 *
 * The entity handlers are their OWN completion writers: they upload to R2,
 * `markJobCompleted` with an entity-shaped `output_data`, commit credits, and
 * then write the result back onto the user's `characters` / `locations` /
 * `objects` / `creatures` row. The generic `finalizeJobWithMedia` does none of
 * those studio writes, which is exactly why all 14 entity job types sat in
 * `NOT_GENERIC_RECOVERABLE`.
 *
 * The cost of that was a silent one: a worker that died between "provider task
 * created" and "result uploaded" left a row the reconcile cron polled, found
 * FINISHED at the provider — and then threw the finished image away, bumped
 * `reconcile_attempts`, and ~90 minutes later force-failed + refunded it. We
 * paid the provider, the user waited an hour and a half, and the asset that
 * existed upstream never reached the studio. Nine production rows in two
 * bursts (2026-09-03, 2026-09-07) are the evidence; by construction EVERY
 * entity job whose worker died mid-flight was unrecoverable.
 *
 * So the completion tail lives here, and BOTH paths call it:
 *  - `workers/handlers/entity.ts` — the live worker, which does NOT take a
 *    finalize claim (it never did: `markJobCompleted`'s CAS plus the
 *    deterministic, idempotently-overwritten R2 key already make the race
 *    benign, and a claim a crashed worker never released would block the cron
 *    for the whole TTL);
 *  - `lib/reconcile/entity-recovery.ts` — the cron (claimant "cron") and the
 *    BullMQ stall re-pick's inline reconcile (claimant "worker"), which DO
 *    claim, because there they are recovering someone else's work.
 *
 * That is the invariant, not a convention: a recovered result completes the
 * job EXACTLY as the worker would have, because it is the same code. The guard
 * is `__tests__/entity-finalize-single-writer.test.ts` — entity.ts may not
 * contain its own `markJobCompleted(` call.
 *
 * ## The attach spec has ONE parser
 *
 * The worker reads the attach fields off `job.data` (the BullMQ payload); the
 * reconciler reads them off `jobs.input_data` (the persisted body). Those are
 * different objects, so `entityAttachSpecFrom` is the single reader for both —
 * and the per-job-type `defaultColumn` below is the single definition of the
 * motion columns the routes used to inline into their queue payloads (which
 * made them invisible to the persisted row, and so unrecoverable).
 */
import {
  commitJobCredits,
  markJobCompleted,
  shouldSaveJobResult,
  uploadImageMaybeWatermark,
  uploadVideoMaybeWatermark,
} from "../workers/shared.js"
import {
  attachAssetToCharacter,
  resolveAssetColumn,
  setCharacterPortrait,
  type CharacterAssetColumn,
} from "./character-auto-attach.js"
import { autoAttachLocationAsset } from "./location-auto-attach.js"
import { autoAttachObjectAsset, setObjectMainImage } from "./object-auto-attach.js"
import { autoAttachCreatureAsset, setCreatureMainImage } from "./creature-auto-attach.js"

export type EntityMediaKind = "image" | "video"

export interface EntityJobSpec {
  /** Which uploader + which `output_data` key (`imageUrl` / `videoUrl`). */
  media: EntityMediaKind
  /** `true` for the four `-asset` lanes, whose `output_data` also carries the
   *  requested `assetType` (the studio groups variants by it). */
  includeAssetType: boolean
  /** The attach column when the request carries none of its own. THE single
   *  definition of the motion columns: `generate-*-motion` routes have exactly
   *  one column per family and no caller-supplied value, so before this table
   *  the constant lived in the route's `videoQueue.add` (object/creature/
   *  location) or in the handler body (character) — reachable by the live
   *  worker and by nothing else. */
  defaultColumn?: string
}

/**
 * Every entity job type whose result is recoverable media, and how to complete
 * it. `generate-script` is deliberately ABSENT: it produces text through the
 * LLM lane, never calls `onTaskCreated`, and therefore never persists a
 * `provider_task_id` for a reconcile tick to poll — it stays in
 * `NOT_GENERIC_RECOVERABLE`.
 *
 * `reconcile/__tests__/finalize-job-type-coverage.test.ts` fails the build if a
 * new entity handler key lands in neither this table nor that denylist.
 */
export const ENTITY_MEDIA_JOB_SPECS: ReadonlyMap<string, EntityJobSpec> = new Map<string, EntityJobSpec>([
  ["generate-character", { media: "image", includeAssetType: false }],
  ["generate-face", { media: "image", includeAssetType: false }],
  ["generate-character-asset", { media: "image", includeAssetType: true }],
  ["generate-object", { media: "image", includeAssetType: false }],
  ["generate-object-asset", { media: "image", includeAssetType: true }],
  ["generate-creature", { media: "image", includeAssetType: false }],
  ["generate-creature-asset", { media: "image", includeAssetType: true }],
  ["generate-location", { media: "image", includeAssetType: false }],
  ["generate-location-asset", { media: "image", includeAssetType: true }],
  ["generate-character-motion", { media: "video", includeAssetType: false, defaultColumn: "motions" }],
  ["generate-location-motion", { media: "video", includeAssetType: false, defaultColumn: "atmosphere_motions" }],
  ["generate-object-motion", { media: "video", includeAssetType: false, defaultColumn: "motion_clips" }],
  ["generate-creature-motion", { media: "video", includeAssetType: false, defaultColumn: "motion_clips" }],
])

export function isEntityMediaJobType(v: string | null | undefined): v is string {
  return typeof v === "string" && ENTITY_MEDIA_JOB_SPECS.has(v)
}

/** The job types whose result IS the entity's anchor image (portrait /
 *  `source_image_url`), rather than an append to a JSONB array column. Mirrors
 *  the `logPrefix === "generate-<family>"` branches the handler used. */
const MAIN_IMAGE_JOB_TYPES: ReadonlySet<string> = new Set([
  "generate-character", "generate-object", "generate-creature",
])

/**
 * The completion-relevant half of an entity request. Deliberately a SUBSET of
 * the worker's `EntityImageJobData`: everything needed to run the generation
 * (prompt, reference images, provider, aspect ratio) is already spent by the
 * time we get here, and re-reading it would invite the two callers to diverge
 * on fields that cannot matter.
 */
export interface EntityAttachSpec {
  attachToCharacterId?: string
  skipPortraitAttach?: boolean
  /** `false` → a candidate-only portrait take: completed and listed like any
   *  other, never written to `source_image_url` (the approve route does that).
   *  Absent/true → today's auto-attach. */
  attachPortrait?: boolean
  attachToLocationId?: string
  attachToObjectId?: string
  attachToCreatureId?: string
  attachToColumn?: string
  attachName?: string
  description?: string
  motionDescription?: string
  realLifeRefs?: string[]
  assetType?: string
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}

/**
 * Read the attach spec out of a BullMQ `job.data` (worker) or a `jobs.input_data`
 * (reconcile recovery). ONE reader for both so the two paths cannot disagree
 * about what a field means — and defensive about types because `input_data` is
 * persisted JSONB, not a Zod-parsed body.
 */
export function entityAttachSpecFrom(
  src: Record<string, unknown> | null | undefined,
): EntityAttachSpec {
  const s = src ?? {}
  const refs = s.realLifeRefs
  return {
    attachToCharacterId: str(s.attachToCharacterId),
    skipPortraitAttach: s.skipPortraitAttach === true,
    // Not collapsed to a `=== true`-style boolean like the flag above: the
    // meaningful value here is `false`, and absent must keep meaning "attach".
    attachPortrait: typeof s.attachPortrait === "boolean" ? s.attachPortrait : undefined,
    attachToLocationId: str(s.attachToLocationId),
    attachToObjectId: str(s.attachToObjectId),
    attachToCreatureId: str(s.attachToCreatureId),
    attachToColumn: str(s.attachToColumn),
    attachName: str(s.attachName),
    description: str(s.description),
    motionDescription: str(s.motionDescription),
    realLifeRefs: Array.isArray(refs)
      ? refs.filter((r): r is string => typeof r === "string")
      : undefined,
    assetType: str(s.assetType),
  }
}

export interface EntityFinalizeInput {
  jobId: string
  /** Must be a member of `ENTITY_MEDIA_JOB_SPECS`. */
  jobType: string
  userId: string | undefined
  shouldWatermark: boolean
  usageLogId: string | null | undefined
  spec: EntityAttachSpec
  /** The provider's delivered media plus its cost metadata. On the recovery
   *  path the cost fields are unknown and left unset — they are OMITTED from
   *  the completion write rather than written as NULL, which is what used to
   *  clobber the provider metadata a prior attempt had already recorded. */
  result: {
    url: string
    providerUsed?: string | null
    cost?: number | null
    displayCost?: number | null
  }
  /** Ran right after the R2 upload, before the completion CAS. The worker uses
   *  it for its `setJobProgress(…, 100)` tick; the reconciler has no BullMQ job
   *  and passes nothing. */
  afterUpload?: (r2Url: string) => Promise<void>
}

/**
 * Upload → CAS-complete → commit credits → write the result onto the studio row.
 *
 * Returns the R2 URL when the job completed, or `null` when the completion CAS
 * found the row already terminal (a user cancel, or a concurrent finalizer
 * won) — in which case NOTHING after the CAS runs, exactly as the worker's
 * `if (!ok) return` did. Upload failures throw: the worker's BullMQ retry and
 * the reconciler's `bumpAttemptsOrExhaust` are their respective backstops.
 */
export async function finalizeEntityJob(input: EntityFinalizeInput): Promise<string | null> {
  const { jobId, jobType, userId, shouldWatermark, usageLogId, spec, result } = input
  const job = ENTITY_MEDIA_JOB_SPECS.get(jobType)
  if (!job) throw new Error(`[entity-finalize] not an entity media job type: ${jobType}`)

  const r2Url = job.media === "image"
    ? await uploadImageMaybeWatermark(result.url, jobId, userId, shouldWatermark)
    : await uploadVideoMaybeWatermark(result.url, jobId, userId, shouldWatermark)

  await input.afterUpload?.(r2Url)

  if (!await shouldSaveJobResult(jobId)) return null

  const outputData: Record<string, unknown> = job.media === "image"
    ? { imageUrl: r2Url }
    : { videoUrl: r2Url }
  if (job.includeAssetType && spec.assetType) outputData.assetType = spec.assetType

  const ok = await markJobCompleted(jobId, {
    output_data: outputData,
    // Null/undefined cost metadata is OMITTED, never written: the recovery
    // path does not know the provider's actual cost, and writing NULL there
    // erased whatever the crashed attempt had already recorded (the same
    // data-quality residual `finalizeJobWithMedia` documents at its own CAS).
    ...(result.providerUsed != null && { provider: result.providerUsed }),
    ...(result.cost != null && { provider_cost: result.cost }),
    ...(result.displayCost != null && { display_cost: result.displayCost }),
  })
  if (!ok) return null

  await commitJobCredits(usageLogId, jobId, result.cost ?? null)

  await attachEntityResult({ jobType, spec, userId, url: r2Url })

  return r2Url
}

/**
 * Write the finished media back onto the user's studio row.
 *
 * Best-effort by contract: credits are committed and `jobs.output_data` already
 * holds the URL, so a failed attach must never undo a completed generation.
 * Every helper here re-verifies `(id, user_id, deleted_at IS NULL)` internally,
 * so a forged payload cannot attach to another user's row.
 *
 * The four blocks are guarded by their own id and run independently — verbatim
 * the shape the entity image handler had, so a request that (today) carries
 * exactly one id behaves identically and one that carried two still would.
 */
export async function attachEntityResult(args: {
  jobType: string
  spec: EntityAttachSpec
  userId: string | undefined
  url: string
}): Promise<void> {
  const { jobType, spec, userId, url } = args
  const column = spec.attachToColumn ?? ENTITY_MEDIA_JOB_SPECS.get(jobType)?.defaultColumn
  const isMain = MAIN_IMAGE_JOB_TYPES.has(jobType)

  // Character Studio. Portrait → `source_image_url` unless the route opted out
  // (extension reimagine keeps the linkage but must not anchor identity on a
  // full-scene image) or the caller asked for a candidate-only take
  // (`attachPortrait: false` — only the approve route sets the portrait, so a
  // take that finishes after the user's pick cannot replace it). Everything
  // else appends to a named JSONB column.
  if (spec.attachToCharacterId && userId) {
    if (isMain) {
      if (!spec.skipPortraitAttach && spec.attachPortrait !== false) {
        await setCharacterPortrait({ characterId: spec.attachToCharacterId, userId, url })
      }
    } else if (column && spec.attachName) {
      const resolved: CharacterAssetColumn | null = resolveAssetColumn(column)
      if (resolved) {
        await attachAssetToCharacter({
          characterId: spec.attachToCharacterId,
          userId,
          column: resolved,
          item: {
            name: spec.attachName,
            url,
            description: spec.description,
            motionDescription: spec.motionDescription,
            realLifeRefs: spec.realLifeRefs,
          },
        })
      }
    }
  }

  // Location Studio — a single column-append lane (locations have no
  // main-image handler branch), narrowed internally against
  // LOCATION_ATTACH_COLUMNS.
  await autoAttachLocationAsset({
    locationId: spec.attachToLocationId,
    column,
    name: spec.attachName,
    userId,
    url,
  })

  // Object Studio.
  if (spec.attachToObjectId && userId) {
    if (isMain) {
      await setObjectMainImage({ objectId: spec.attachToObjectId, userId, url })
    } else if (column && spec.attachName) {
      await autoAttachObjectAsset({
        objectId: spec.attachToObjectId,
        column,
        name: spec.attachName,
        userId,
        url,
      })
    }
  }

  // Creature Studio.
  if (spec.attachToCreatureId && userId) {
    if (isMain) {
      await setCreatureMainImage({ creatureId: spec.attachToCreatureId, userId, url })
    } else if (column && spec.attachName) {
      await autoAttachCreatureAsset({
        creatureId: spec.attachToCreatureId,
        column,
        name: spec.attachName,
        userId,
        url,
      })
    }
  }
}
