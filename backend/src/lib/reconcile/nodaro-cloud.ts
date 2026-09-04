/**
 * Recover a stalled exclusive-node relay job (provider_kind "nodaro-cloud").
 *
 * The persisted provider_task_id is the CLOUD job's id. Recovery is ONE
 * idempotent poll of that job — never a re-create, so a premature takeover
 * costs a GET, not a second generation:
 *   - cloud job completed -> adapt its output exactly as the live relay does
 *     (shared finalizeExclusiveCloudOutput) and finish the local row.
 *   - cloud job failed/cancelled -> mark the local row failed (community has
 *     no credits to refund; the cloud side settled its own billing).
 *   - still running -> bump reconcile_attempts and let the next tick look.
 */

import { supabase } from "../supabase.js"
import { markJobFailed } from "../job-failure.js"
import { redactProviderDetail } from "../provider-error-detail.js"
import { finalizeExclusiveCloudOutput } from "../../workers/handlers/nodaro-exclusive-relay.js"
import type { CloudJob } from "../../providers/nodaro/client.js"
import { bumpAttemptsOrExhaust } from "./bump-attempts.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"

/** Terminal failure, per the local-file convention of the sibling handlers
 *  (kie.ts/fal.ts/elevenlabs.ts each keep their own): the shared `markJobFailed`
 *  CAS on FAILABLE_STATUSES so a concurrently-completed row is never trampled
 *  and a `pending_review` row is never taken (spec D11), then release the
 *  reservation (a no-op on community; correct on cloud).
 *
 *  The refund now sits BEHIND the returned boolean — the discipline every other
 *  migrated writer already followed by hand. It was harmless before (the refund
 *  CASes on `usage_logs.status='reserved'` itself) but "refund only when WE
 *  flipped the row" has to be uniform, or the one writer that is not uniform is
 *  the one a future hold/block lands on. */
async function markFailed(jobId: string, reason: string): Promise<void> {
  const flipped = await markJobFailed(jobId, {
    error_message: reason,
    error_detail: redactProviderDetail(reason),
    reconcile_last_error: "upstream_failed",
  })
  if (flipped) await refundReservedCreditsForJob(jobId).catch(() => undefined)
}

interface NodaroCloudJobRow {
  readonly id: string
  readonly provider_task_id: string | null
  readonly reconcile_attempts: number | null
  readonly job_type: string | null
}

export async function reconcileNodaroCloudJob(row: NodaroCloudJobRow): Promise<void> {
  if (!row.provider_task_id || !row.job_type) {
    await bumpAttemptsOrExhaust(row.id, "nodaro-cloud row missing provider_task_id/job_type")
    return
  }

  const { nodaroCloudFetch } = await import("../nodaro-connect.js")
  // The FULL CloudJob, not a hand-picked subset: `credits` is what
  // finalizeExclusiveCloudOutput turns into `relay_credits`, so a narrowed
  // shape here would recover every post-crash job with its cost unknown while
  // the live relay records it. Type-only import; the poll body is unchanged.
  let cloudJob: CloudJob | undefined
  try {
    const res = await nodaroCloudFetch(`/v1/jobs/${row.provider_task_id}`)
    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        // Token revoked or the cloud job vanished — nothing recoverable.
        await markFailed(row.id, `nodaro.ai: cloud job unreachable (${res.status})`)
        return
      }
      await bumpAttemptsOrExhaust(row.id, `nodaro.ai poll ${res.status}`)
      return
    }
    cloudJob = ((await res.json().catch(() => null)) as { data?: typeof cloudJob } | null)?.data
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err instanceof Error ? err.message : String(err))
    return
  }
  if (!cloudJob?.status) {
    await bumpAttemptsOrExhaust(row.id, "nodaro.ai poll returned no job")
    return
  }

  if (cloudJob.status === "completed") {
    // Watermark decision: read the row's own stamp (set at reservation time
    // on cloud; absent on community rows -> no watermark system anyway).
    const { data } = await supabase
      .from("jobs")
      .select("user_id, should_watermark")
      .eq("id", row.id)
      .maybeSingle()
    const rowMeta = data as { user_id?: string; should_watermark?: boolean } | null
    try {
      await finalizeExclusiveCloudOutput({
        jobId: row.id,
        jobType: row.job_type,
        cloudJob,
        jobUserId: rowMeta?.user_id,
        shouldWatermark: rowMeta?.should_watermark === true,
      })
    } catch (err) {
      await bumpAttemptsOrExhaust(row.id, err instanceof Error ? err.message : String(err))
    }
    return
  }

  if (cloudJob.status === "failed" || cloudJob.status === "cancelled") {
    await markFailed(row.id, cloudJob.error_message || `nodaro.ai: cloud job ${cloudJob.status}`)
    return
  }

  // pending/processing: the cloud is still working — legitimate for
  // gvp-class runs. Bump and look again next tick.
  await bumpAttemptsOrExhaust(row.id, `nodaro.ai job still ${cloudJob.status}`)
}
