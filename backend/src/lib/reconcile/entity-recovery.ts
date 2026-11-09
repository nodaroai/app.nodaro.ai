/**
 * Reconcile recovery for the entity studios (Character / Face / Object /
 * Creature / Location — main images, asset variants, motion clips).
 *
 * ## The bug this closes
 *
 * Every entity job type sat in `NOT_GENERIC_RECOVERABLE`, and all three
 * reconcile writers consult that set only AFTER a successful poll. So when a
 * worker died between "provider task created" and "result uploaded", the cron
 * polled the provider, got the FINISHED image back — and threw it away, bumped
 * `reconcile_attempts`, and ~90 minutes later force-failed the job and refunded
 * the user. We had already paid the provider; the asset existed upstream and
 * never reached the studio. By construction NO entity job whose worker died
 * mid-flight was recoverable (production evidence: two bursts of
 * `generate-object-asset` / `generate-character` rows, 2026-09-03 and
 * 2026-09-07, `reconcile_attempts: 18`, `reconcile_last_error: exhausted`).
 *
 * The denylist entry was correct about the CAUSE — generic
 * `finalizeJobWithMedia` writes `buildImageOutputData` + `createAssetFromJob`
 * and none of the studio-row writes, so it would have completed the job with
 * the result invisible in the studio. The fix is not to loosen that; it is to
 * give the reconciler the entity completion tail itself
 * (`lib/entity-finalize.ts`), which the live worker also calls. Same function,
 * same writes, no second implementation to drift.
 *
 * ## Contract
 *
 * Mirrors `finalizeJobWithMedia`'s guards, deliberately:
 *  - a terminal row is a graceful skip (never trample a cancel / a completion),
 *  - the `claim_job_finalize` CAS makes a losing finalizer exit BEFORE any
 *    media work (no duplicate download/upload of the same deterministic key),
 *  - the claim is released on a failed media step so the next tick can retry
 *    immediately instead of waiting out the TTL,
 *  - watermarking is the WORKER's expression (`hasCredits()`-gated), not
 *    finalize's, because this replays a worker completion.
 *
 * Throws on a failed upload/completion so the caller's
 * `bumpAttemptsOrExhaust` keeps its exhaustion-terminates-with-a-refund
 * property for a deterministically broken result.
 */
import { supabase } from "../supabase.js"
import { hasCredits } from "../config.js"
import {
  claimJobFinalize,
  loadUsageLogId,
  releaseJobFinalizeClaim,
  type FinalizeClaimant,
} from "../job-finalize.js"
import {
  entityAttachSpecFrom,
  finalizeEntityJob,
  isEntityMediaJobType,
} from "../entity-finalize.js"

export { isEntityMediaJobType }

interface EntityJobRow {
  user_id: string | null
  should_watermark: boolean | null
  status: string | null
  input_data: Record<string, unknown> | null
}

/**
 * Complete an entity job from a recovered provider result.
 *
 * `jobType` must be an entity media type — callers gate on
 * `isEntityMediaJobType(row.job_type)` first, which is also what keeps this
 * lane and the `NOT_GENERIC_RECOVERABLE` denylist from ever double-handling a
 * row.
 *
 * DAG-origin rows are covered for free: `payload-builder`'s four entity
 * branches send NO attach fields at all and `node-executor` persists only
 * `{type, node_id, iterationIndex?}`, so both sides read an empty spec and the
 * recovered job completes with the media and no studio write — which is exactly
 * what the live worker does for those rows.
 *
 * The attach spec comes off `jobs.input_data` — the persisted request body,
 * which is the only thing that survives the worker's death. `entityAttachSpecFrom`
 * is the SAME reader the worker uses on its BullMQ payload, and the motion
 * columns the routes used to inline into that payload now live on the job
 * type's own entry in `ENTITY_MEDIA_JOB_SPECS`, so the recovered completion
 * attaches to exactly the column the worker would have.
 */
export async function recoverEntityJob(args: {
  jobId: string
  jobType: string
  url: string
  claimant?: FinalizeClaimant
  /** A recovered GPT Image 2.6 Auto run: what KIE really billed, to settle on. */
  autoQualityKieCredits?: number
}): Promise<void> {
  const { jobId, jobType, url } = args
  if (!isEntityMediaJobType(jobType)) {
    throw new Error(`[entity-recovery] not an entity media job type: ${jobType}`)
  }

  const { data } = await supabase
    .from("jobs")
    .select("user_id, should_watermark, status, input_data")
    .eq("id", jobId)
    .single()
  const row = data as EntityJobRow | null
  if (!row) {
    console.warn(`[entity-recovery] job ${jobId} not found`)
    return
  }
  // Already terminal (cancelled / completed / failed): the work was done or
  // deliberately undone by someone else. Graceful skip, exactly like finalize.
  if (row.status !== "pending" && row.status !== "processing") return

  const claim = await claimJobFinalize(jobId, args.claimant ?? "cron")
  if (!claim.won) return

  // The WORKER's watermark expression (video-worker.ts): community installs
  // have no credits and never watermark, so re-deriving it here keeps a
  // recovered asset byte-identical to the one the worker would have produced.
  const shouldWatermark = hasCredits() ? (row.should_watermark ?? false) : false

  try {
    const r2Url = await finalizeEntityJob({
      jobId,
      jobType,
      userId: row.user_id ?? undefined,
      shouldWatermark,
      usageLogId: await loadUsageLogId(jobId),
      spec: entityAttachSpecFrom(row.input_data),
      // Post-reconcile the provider's actual cost is unknown: leave the cost
      // fields unset so the completion write OMITS them (writing NULL there
      // clobbered the metadata a prior attempt had recorded) and credits
      // commit at the reservation (a GPT Image 2.6 Auto run settles on KIE's bill).
      result: { url, ...(args.autoQualityKieCredits !== undefined && { autoQualityKieCredits: args.autoQualityKieCredits }) },
    })
    if (r2Url) {
      console.log(`[entity-recovery] recovered ${jobType} job ${jobId}: ${r2Url}`)
    }
  } catch (err) {
    // Release our claim so the next tick (or a BullMQ retry) can re-attempt
    // immediately, then surface the error — refund classification stays the
    // caller's concern (bumpAttemptsOrExhaust).
    if (claim.ts) await releaseJobFinalizeClaim(jobId, claim.ts)
    throw err
  }
}
