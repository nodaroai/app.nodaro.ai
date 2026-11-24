import { markJobFailed } from "../job-failure.js"
import { claimJobFinalize, finalizeJobWithMedia, isFinalizeJobType, NOT_GENERIC_RECOVERABLE, releaseJobFinalizeClaim } from "../job-finalize.js"
import { hasFreshFinalizeClaimNow, holdingFinalizeClaim, isFinalizeClaimLost } from "../finalize-claim-hold.js"
import { isWorkerDraining, DrainAbortError } from "../worker-drain.js"
import { TOPAZ_RHEA_MAX_WAIT_MS, TOPAZ_RHEA_POLL_INTERVAL_MS, topazRheaRepickDeadline } from "../topaz-rhea-timeouts.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { redactProviderDetail, logProviderFailure } from "../provider-error-detail.js"
import { bumpAttemptsOrExhaust } from "./bump-attempts.js"
import { isEntityMediaJobType, recoverEntityJob } from "./entity-recovery.js"
import { fetchFalRequestStatus, extractFalUrl } from "../../providers/fal/client.js"
import { FAL_LIP_SYNC_CONFIGS } from "../../providers/fal/lip-sync.js"
import { FAL_VIDEO_DEPTH_CONFIGS } from "../../providers/fal/video-depth.js"
import { FAL_TOPAZ_RHEA_CONFIGS, FAL_TOPAZ_RHEA_ENDPOINT, topazRheaCostUsd } from "../../providers/fal/topaz-rhea.js"
import { NODARO_VIDEO_UPSCALE_PROVIDER, TOPAZ_RHEA_VIDEO_UPSCALE_PROVIDER, nodaroVideoUpscaleQueuedModeOf } from "@nodaro/shared/models"
import { readRheaRunFields } from "../topaz-rhea-plan.js"
import { deliverRheaOutput } from "../topaz-rhea-delivery.js"
import { watermarkLocalVideoAndUpload } from "../../workers/shared.js"
import { supabase } from "../supabase.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"
import type { ReconcileOpts } from "./kie.js"

export interface FalJobRow {
  id: string
  provider_kind: string | null
  provider_task_id: string | null
  reconcile_attempts: number
  job_type: string | null
  /** The user-submitted request config (see `lib/job-input-data.ts`). Read here
   *  to recover the fal `endpoint`: the row stores the fal request_id in
   *  `provider_task_id`, but `fal.queue.status/result` ALSO need the endpoint,
   *  which isn't a column — it's derivable from `input_data.provider`. */
  input_data?: Record<string, unknown> | null
}

/**
 * Resolve the fal `endpoint` for a stored fal job. The job row persists the fal
 * request_id (`provider_task_id`) but the queue API needs the endpoint too, and
 * there's no endpoint column. We recover it from the user-submitted
 * `input_data.provider` (the Nodaro model id, e.g. "sync-lipsync-v3") via the
 * SAME `{ providerId → endpoint }` registries the live dispatch used — single
 * source of truth, so a new fal model that adds an endpoint to its capability's
 * registry is recoverable here for free.
 *
 * Returns null when no provider/endpoint is recoverable (legacy row, corrupted
 * input_data, or a fal model not in any endpoint registry) — the caller then
 * fails+refunds the row rather than retrying a poll it can never issue.
 *
 * NOTE: fal serves lip-sync and video-depth today, so `FAL_ENDPOINT_REGISTRIES`
 * lists those two. When fal gains another capability, add its registry there so
 * every fal kind stays recoverable.
 */
/** Every fal capability's `{ providerId → endpoint }` registry. Add a new fal capability here. */
const FAL_ENDPOINT_REGISTRIES: ReadonlyArray<Record<string, { endpoint: string }>> = [
  FAL_LIP_SYNC_CONFIGS,
  FAL_VIDEO_DEPTH_CONFIGS,
  FAL_TOPAZ_RHEA_CONFIGS,
]

/**
 * Is this stored request a Rhea run on fal — the `topaz-rhea` provider, or
 * Nodaro Video Upscale in transparent mode (the mode read as every lane reads
 * it for a stored job, `nodaroVideoUpscaleQueuedModeOf`)?
 */
function isRheaRequest(inputData: Record<string, unknown> | null | undefined): boolean {
  const provider = inputData?.provider
  if (provider === TOPAZ_RHEA_VIDEO_UPSCALE_PROVIDER) return true
  // A stored request that names no mode was made before modes existed: Sharp.
  return provider === NODARO_VIDEO_UPSCALE_PROVIDER && nodaroVideoUpscaleQueuedModeOf(inputData?.mode) === "transparent"
}

function resolveFalEndpoint(inputData: Record<string, unknown> | null | undefined): string | null {
  const provider = inputData?.provider
  if (typeof provider !== "string") return null
  // Nodaro Video Upscale's transparent mode runs on the Rhea endpoint.
  if (isRheaRequest(inputData)) return FAL_TOPAZ_RHEA_ENDPOINT
  for (const registry of FAL_ENDPOINT_REGISTRIES) {
    // own-key check: a stored provider like "toString" must not hit Object.prototype
    if (Object.hasOwn(registry, provider)) return registry[provider].endpoint
  }
  return null
}

/**
 * `reason` is the USER-FACING string (it lands in `jobs.error_message`, which
 * `GET /v1/jobs/:id` and the app-report sweep both read). `detail` is the raw
 * provider text — redacted by the CALLER via `redactProviderDetail` /
 * `providerDetailOf` and written to the admin-only `jobs.error_detail` (W0,
 * migration 368). Never pass raw provider text as `reason`: that is exactly
 * how vendor stack traces and signed URLs reached job owners.
 *
 * Written UNCONDITIONALLY, matching `reconcile/kie.ts:244` — one shape for
 * one column (M-2b). `null` means "this writer had no provider text", and
 * recording that null is the honest answer.
 */
async function markFailed(jobId: string, reason: string, detail: string | null = null): Promise<void> {
  // Log BEFORE the write: this module had no per-job output at all, so a
  // cron-failed job was invisible in Railway (spec §11.3).
  logProviderFailure("reconcile/fal", jobId, reason, detail)
  // The CAS lives in markJobFailed now (FAILABLE_STATUSES): never trample a job
  // a concurrent writer flipped to completed/cancelled, and never take a
  // `pending_review` row — a held job is out of every reconcile sweep's reach
  // by construction (spec D11).
  await markJobFailed(jobId, {
    error_message: reason,
    error_detail: detail,
    reconcile_last_error: "upstream_failed",
  })
}

/**
 * Reconcile a stuck fal.ai queue job (`provider_kind="fal-request"`, or
 * `"fal-rhea"` for a Rhea upscale). Mirrors
 * `reconcileReplicateJob`: resolve the fal endpoint from the row, check the
 * queue status ONCE via `fetchFalRequestStatus`, then:
 *   - COMPLETED → finalize with the extracted output URL (output_data written,
 *     credits commit, asset row created, workflow execution reopens if sole-cause).
 *   - ERROR (terminal queue failure, or COMPLETED-but-result-unfetchable) →
 *     markFailed + refund reserved credits.
 *   - pending (IN_QUEUE/IN_PROGRESS, or a transient status-fetch blip) →
 *     bumpAttemptsOrExhaust (re-check next tick; force-fail+refund at MAX_ATTEMPTS).
 *
 * Endpoint-unresolvable (legacy/corrupt input_data) → markFailed + refund: there
 * is no way to re-poll the queue without the endpoint, so we don't loop forever.
 *
 * The terminal/finalize phase is wrapped in try/catch → `bumpAttemptsOrExhaust`
 * (per the Replicate/KIE twins) so a deterministic finalize failure (R2 upload,
 * bad output shape) exhausts to refund+anomaly instead of looping every tick.
 */
/** The fal reconcile's options: the shared ones, and the worker re-pick's wait. */
export interface FalReconcileOpts extends ReconcileOpts {
  /**
   * A Rhea row (`fal-rhea`) still running upstream is read until it ends,
   * within what is left of its wait ({@link waitOutRheaRequest}) — the
   * worker's inline re-pick, inside a live queue handler, as the KIE re-pick's
   * `pollAttempts` and the house model's `pollToEnd` do. Without it: one read
   * a tick (the cron). Ignored for every other fal row.
   */
  pollToEnd?: boolean
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A worker's re-pick of a Rhea request still running upstream: read it until
 * it ends, or until its wait's end (`topazRheaRepickDeadline`: the original
 * hour from the row's stamp, at least {@link TOPAZ_RHEA_REPICK_MIN_WAIT_MS}
 * from now). BEFORE waiting, the row's stamp is moved so the cron's `fal-rhea`
 * threshold falls past this wait (stamp = deadline − the hour): the cron never
 * reads the row while this process waits, and takes it over at its threshold
 * if this process dies too. Waiting spends no recovery attempt; a wait that
 * reaches its end leaves the row as it is for the cron, also without one.
 * Undefined: the wait ended with the request still running.
 */
async function waitOutRheaRequest(
  row: FalJobRow,
  endpoint: string,
  requestId: string,
): Promise<Awaited<ReturnType<typeof fetchFalRequestStatus>> | undefined> {
  const { data } = await supabase.from("jobs").select("provider_call_started_at").eq("id", row.id).maybeSingle()
  const stampAt = (data as { provider_call_started_at?: string | null } | null)?.provider_call_started_at
  const stampMs = typeof stampAt === "string" && Number.isFinite(Date.parse(stampAt)) ? Date.parse(stampAt) : undefined
  const deadline = topazRheaRepickDeadline(stampMs, Date.now())
  const newStampMs = deadline - TOPAZ_RHEA_MAX_WAIT_MS
  if (stampMs === undefined || newStampMs > stampMs) {
    await supabase
      .from("jobs")
      .update({ provider_call_started_at: new Date(newStampMs).toISOString() })
      .eq("id", row.id)
      .eq("provider_kind", "fal-rhea")
      .in("status", ["pending", "processing"])
  }
  while (Date.now() < deadline) {
    if (isWorkerDraining()) throw new DrainAbortError()
    await sleep(TOPAZ_RHEA_POLL_INTERVAL_MS)
    const remote = await fetchFalRequestStatus(endpoint, requestId)
    // A transient status-read failure reads as pending: keep waiting.
    if (remote.status !== "pending") return remote
  }
  console.log(`[reconcile/fal] job ${row.id}: the Rhea request is still running at the end of its wait; left to the cron`)
  return undefined
}

export async function reconcileFalJob(row: FalJobRow, opts?: FalReconcileOpts): Promise<void> {
  if (!row.provider_task_id) return

  const endpoint = resolveFalEndpoint(row.input_data)
  if (!endpoint) {
    // No endpoint recoverable → the queue can't be re-polled. Fail+refund rather
    // than bump toward a 90-min exhaustion that would never succeed.
    await markFailed(
      row.id,
      "Generation could not be recovered. Your credits were refunded.",
      "fal endpoint unresolvable (missing/unknown input_data.provider)",
    )
    await refundReservedCreditsForJob(row.id)
    return
  }

  let remote = await fetchFalRequestStatus(endpoint, row.provider_task_id)

  // The worker's re-pick of a Rhea run still going: wait it out here (no attempt spent).
  if (remote.status === "pending" && opts?.pollToEnd && row.provider_kind === "fal-rhea") {
    const ended = await waitOutRheaRequest(row, endpoint, row.provider_task_id)
    if (!ended) return
    remote = ended
  }

  if (remote.status === "pending") {
    await bumpAttemptsOrExhaust(row.id, remote.error ?? "fal request still in queue")
    return
  }

  if (remote.status === "ERROR") {
    await markFailed(
      row.id,
      "Generation failed on the provider. Please try again.",
      // remote.error is raw provider text — redact it before it reaches
      // error_detail (M-2b); never pass it through as-is.
      redactProviderDetail(remote.error) ?? "fal request failed",
    )
    await refundReservedCreditsForJob(row.id)
    return
  }

  // Entity studios: recovered through the shared worker tail, never discarded
  // (see the kie.ts twin). fal serves lip-sync and video-depth today, so this is
  // symmetry with the other two writers rather than a live path — but a provider_kind is one
  // routing-table line away from making it one, and a lane that only exists in
  // two of three writers is the shape this whole bug had.
  if (isEntityMediaJobType(row.job_type)) {
    try {
      await recoverEntityJob({
        jobId: row.id,
        jobType: row.job_type,
        url: extractFalUrl(remote.output),
        claimant: opts?.claimant ?? "cron",
      })
    } catch (err) {
      await bumpAttemptsOrExhaust(row.id, err)
    }
    return
  }

  // Types with their own completion writer, and unknown/NULL types, must not
  // reach finalize (same rationale as kie.ts's twin guard, M-4a/M-4b). fal
  // serves only lip-sync and video-depth today, so this is a backstop, not a live path.
  if (NOT_GENERIC_RECOVERABLE.has(row.job_type ?? "")) {
    await bumpAttemptsOrExhaust(row.id, `not generically recoverable: ${row.job_type}`)
    return
  }
  if (!isFinalizeJobType(row.job_type)) {
    await bumpAttemptsOrExhaust(row.id, `unknown job_type for finalize: ${row.job_type ?? "null"}`)
    return
  }

  // A Rhea run: delivered exactly as the worker delivers it (the planned frame,
  // the source's sound), then finalized with the stored file.
  if (isRheaRequest(row.input_data) && row.job_type === "video-upscale") {
    try {
      // A false answer means another finalizer holds the claim and is delivering
      // this run: nothing to do here, and nothing bumped.
      await deliverRheaRow(row, extractFalUrl(remote.output), opts?.claimant ?? "cron")
    } catch (err) {
      // The file itself cannot be brought to its frame: the same file fails
      // again, so fail and refund now instead of retrying for the whole window.
      if (isDeterministicJobError(err)) {
        await markFailed(row.id, "The upscaled video could not be prepared. Your credits were refunded.", redactProviderDetail(err instanceof Error ? err.message : String(err)) ?? null)
        await refundReservedCreditsForJob(row.id)
        return
      }
      await bumpAttemptsOrExhaust(row.id, err)
    }
    return
  }

  // COMPLETED — extract + finalize. B1 guard: a poll-success-but-finalize-failure
  // (R2 upload, unexpected output shape) MUST bump so a deterministic failure
  // exhausts to refund+anomaly instead of looping at every cron tick forever.
  try {
    const url = extractFalUrl(remote.output)
    await finalizeJobWithMedia({
      jobId: row.id,
      jobType: row.job_type,
      claimant: opts?.claimant ?? "cron",
      result: {
        url,
        cost: null, // committed at reservation; actual cost is unknown post-reconcile
        providerUsed: "fal",
      },
    })
  } catch (err) {
    await bumpAttemptsOrExhaust(row.id, err)
  }
}

/**
 * A recovered Rhea run's delivery: its planned frame and source from its
 * stored request, its owner's watermark rule from the job. The finalize claim
 * is taken BEFORE the delivery (download, encode, upload) and kept fresh while
 * it runs (lib/finalize-claim-hold.ts), so the worker and the cron never both
 * do the delivery work: false when another finalizer holds the claim, or takes
 * it mid-delivery (nothing stored or finalized here). The claim is re-entrant
 * per claimant name, so two overlapping cron ticks are kept apart by the fresh
 * claim read below, not by the claim itself; whatever overlaps, the job
 * completes once and is charged once. A claim whose holder died lapses within
 * its TTL, so the run is still recovered.
 */
async function deliverRheaRow(row: FalJobRow, outputUrl: string, claimant: NonNullable<ReconcileOpts["claimant"]>): Promise<boolean> {
  const run = readRheaRunFields(row.input_data)
  const sourceUrl = row.input_data?.videoUrl
  if (!run || typeof sourceUrl !== "string") throw new Error("Rhea run without its plan in the stored request")
  // Two reconcile ticks share the claimant "cron", which the claim lets re-enter
  // its own fresh claim: a tick on an old scan must not re-enter one a later
  // tick took for its delivery, so it reads the claim again first.
  if (claimant === "cron" && (await hasFreshFinalizeClaimNow(row.id))) return false
  const claim = await claimJobFinalize(row.id, claimant)
  if (!claim.won) return false
  const { data: job, error } = await supabase.from("jobs").select("user_id, should_watermark").eq("id", row.id).single()
  if (error || !job) {
    if (claim.ts) await releaseJobFinalizeClaim(row.id, claim.ts)
    throw new Error(`could not read job ${row.id} for its delivery: ${error?.message ?? "no row"}`)
  }
  const userId = (job as { user_id?: string | null }).user_id ?? undefined
  const watermark = (job as { should_watermark?: boolean | null }).should_watermark === true
  let delivered: Awaited<ReturnType<typeof deliverRheaOutput<string>>>
  try {
    delivered = await holdingFinalizeClaim(row.id, claimant, claim.ts, (hold) => deliverRheaOutput({
      outputUrl,
      expected: { width: run.upscaleFrameWidth, height: run.upscaleFrameHeight },
      sourceUrl,
      jobId: row.id,
      // Stored only while the claim is still this finalizer's.
      store: async (localPath) => {
        hold.assertHeld()
        return watermarkLocalVideoAndUpload(localPath, row.id, userId, watermark)
      },
    }), { stopOnLoss: true })
  } catch (err) {
    // Another finalizer took the claim mid-delivery: it delivers; nothing is stored or finalized here.
    if (isFinalizeClaimLost(err)) return false
    throw err
  }
  await finalizeJobWithMedia({
    jobId: row.id,
    jobType: "video-upscale",
    claimant,
    result: { url: outputUrl, cost: topazRheaCostUsd(run.upscaleRateTier, run.upscaleBilledSec), providerUsed: String(row.input_data?.provider ?? "fal") },
    mediaUrl: delivered.stored,
    // The stored file's own frame, probed, never the plan's.
    extraOutputData: { width: delivered.width, height: delivered.height },
  })
  return true
}
