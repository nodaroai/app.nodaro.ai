import type { Job } from "bullmq"
import { promises as fs } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { ytProxyOption } from "../providers/video/yt-proxy.js"
import { runYtDlpOptions } from "../providers/video/ytdlp-options-run.js"
import { variantJobId } from "@nodaro/shared/workflow"
import { renderResultStamp, isRenderNodeType } from "@nodaro/shared/nodes"
import { config, hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { getAppSettings } from "../lib/app-settings.js"
import type { ProviderResult } from "../providers/provider.interface.js"
import { uploadToR2, uploadFileToR2, uploadBufferToR2, uploadFileWithKeyToR2, getR2ObjectSize } from "../lib/storage.js"
import { uploadJobScratchFile } from "../lib/job-scratch.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { isAllowedSocialVideoUrl } from "../lib/url-validator.js"
import sharp from "sharp"
import { applyImageWatermark, applyVideoWatermark } from "../utils/watermark.js"
import { getSizeLimit } from "../utils/file-validation.js"
import { generateThumbnailFromUrl } from "../utils/thumbnail.js"
import { createWorkDir, cleanupWorkDir, downloadFile, transcodeToBrowserSafe } from "../providers/video/ffmpeg-utils.js"
import { isPostProcessingError, runPostProcessing } from "../lib/post-processing-error.js"
import { billedContentRefusal } from "../lib/llm-errors.js"
import type { LlmSettleOutcome, LlmSpend } from "../lib/llm-billing.js"
import type { LlmBillingLedgerWrite } from "../lib/llm-billing-ledger.js"
import { ledgerLane, meteredSpendFromRow, rowBilling } from "../lib/llm-row-spend.js"
export { meteredSpendFromRow }
import { hasJobPolicyFor, type HeldCommitReplay } from "../lib/job-policy.js"
import { completedJobColumns } from "../lib/job-status.js"
import { withOutputImageDimensions } from "../lib/job-output-dimensions.js"
import { isMissingFunctionError } from "../lib/postgrest-errors.js"
// Pure key-family predicate (no S3 client, no supabase) — the one half of the
// relay delete rule that is decidable at asset-creation time.
import { isOwnedObjectKey } from "../lib/job-policy-outputs.js"

export interface JobContext {
  jobId: string
  jobUserId: string | undefined
  usageLogId: string | null | undefined
  shouldWatermark: boolean
}

/**
 * A video-worker job handler. The processor wraps every handler it dispatches
 * in the `pre-task` heartbeat (`workers/pre-task-heartbeat.ts`), which stops
 * beating at a default cap so a hung handler still ages into the reconcile
 * sweep. A handler whose LEGITIMATE run can outlive that cap declares its own
 * bound through `livenessBudgetMs` — the sum of the kill budgets of its own
 * bounded steps (apply-edl: its per-chunk ffmpeg budget, fetches and probes),
 * never a guess — so "hung" means the same thing to the heartbeat and to
 * those steps. Storage I/O (bounded per call, never summed) is not in it — the
 * residual the heartbeat doc states — nor ffmpeg-slot waits, which both clocks
 * take off as not running (Track 0.13). Return
 * `undefined` to keep the default. Core-only: the private-plugin contract
 * does not carry this member.
 */
export type HandlerFn = ((job: Job, ctx: JobContext) => Promise<void>) & {
  livenessBudgetMs?: (job: Job) => number | undefined
}

/**
 * True when a thrown error is terminal for THIS BullMQ job — i.e. no further
 * automatic retry will run, so the job-failure finalize + credit refund MUST
 * happen on this attempt.
 *
 * Why this matters (credit correctness): refunding on a non-final attempt
 * CAS-flips the reservation reserved→refunded. BullMQ then retries; a
 * successful retry calls commitJobCredits, but commit_credits matches
 * `status='reserved'` and the row is already 'refunded', so the commit
 * silently no-ops — the media is delivered for FREE while we paid the
 * provider. So we must only refund when the job won't be retried.
 *
 * BullMQ v5 semantics (verified against the installed source,
 * classes/job.js `shouldRetryJob`): `attemptsMade` is 0 during the first
 * processing and is incremented only AFTER a failure, and a retry happens iff
 * `attemptsMade + 1 < opts.attempts`. So "final attempt" is the exact inverse:
 * `attemptsMade + 1 >= attempts`. This holds because these queues use a plain
 * exponential backoff (no strategy returning -1), the only other way BullMQ
 * itself would skip a retry early.
 *
 * PR9 exception: `video-worker.ts` now throws `UnrecoverableError` on a FINAL
 * content-policy block, and on a `DeterministicJobError` (a refusal that is a
 * pure function of the job's inputs — `lib/deterministic-job-error.ts`), after
 * failing + refunding the row (`lib/safety-block.ts`'s bounded retry policy, which
 * can cap a flagged model at fewer attempts than the queue's global
 * `opts.attempts`). That throw only ever happens after the block's own policy
 * — or this function as its fallback — has already decided the attempt is
 * final, so it does not change what "final" means here; it is the CODE, not
 * BullMQ's own backoff, additionally refusing a retry BullMQ's plain count
 * alone might still have granted.
 */
export function isFinalJobAttempt(job: Pick<Job, "attemptsMade" | "opts">): boolean {
  const attempts = job.opts?.attempts ?? 1
  return job.attemptsMade + 1 >= attempts
}

export function isSocialUrl(url: string): boolean {
  return isAllowedSocialVideoUrl(url)
}

/**
 * Download a social link's audio and store it. With `scratchJobId` (Suno's
 * cover and upload-extend: a provider input) the copy goes to that job's
 * scratch folder, emptied when the job ends (decided 2026-10-09). Without it
 * (a workflow run's link fetch, whose audio later nodes read) it keeps its
 * own key.
 */
export async function downloadAudioToR2(url: string, opts: { scratchJobId?: string } = {}): Promise<string> {
  const outputId = randomUUID()
  const baseName = `yt-audio-${outputId}`
  const outputTemplate = join(tmpdir(), `${baseName}.%(ext)s`)
  const expectedPath = join(tmpdir(), `${baseName}.mp3`)

  console.log(`[worker] Downloading audio from social URL: ${url}`)

  const ytDlpOptions: Record<string, unknown> = {
    extractAudio: true,
    audioFormat: "mp3",
    audioQuality: 0,
    output: outputTemplate,
    noPlaylist: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    // Residential proxy for YouTube (datacenter IP bot-block); no-op when unset.
    ...ytProxyOption(url),
    extractorArgs: "youtube:player_client=android",
    addHeader: [
      "referer:youtube.com",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ],
  }
  // `-x --audio-format mp3` runs yt-dlp's own ffmpeg to ENCODE: admitted like any ffmpeg, and stopped
  // with its whole process group at the hold.
  await runYtDlpOptions(url, ytDlpOptions)

  // Find the actual audio file
  let actualPath = expectedPath
  try {
    await fs.access(expectedPath)
  } catch {
    const alternatives = [".m4a", ".webm", ".opus", ".ogg", ".wav"]
    let found = false
    for (const ext of alternatives) {
      const altPath = join(tmpdir(), `${baseName}${ext}`)
      try {
        await fs.access(altPath)
        actualPath = altPath
        found = true
        break
      } catch { continue }
    }
    if (!found) throw new Error("yt-dlp did not produce an output file")
  }

  const stat = await fs.stat(actualPath)
  if (stat.size === 0) throw new Error("Downloaded audio file is empty")

  const r2Url = opts.scratchJobId
    ? await uploadJobScratchFile(actualPath, "cover-src", "mp3", "audio/mpeg", opts.scratchJobId)
    : await uploadFileWithKeyToR2(actualPath, `audios/cover-src-${outputId}.mp3`, "audio/mpeg")
  await fs.unlink(actualPath).catch(() => {})

  console.log(`[worker] Audio downloaded and uploaded to R2: ${r2Url}`)
  return r2Url
}

/**
 * Check if job was cancelled before saving completion result.
 *
 * Useful as a CHEAP PRE-CHECK to avoid expensive post-processing (thumbnail
 * generation, R2 cleanup) when the job is already cancelled. But it does NOT
 * prevent the cancel-during-update race — between this SELECT and the
 * subsequent UPDATE the user can cancel, and an unconditional UPDATE will
 * overwrite their cancellation. Use markJobCompleted() for the actual
 * status flip — it does the SELECT and UPDATE atomically via a conditional
 * WHERE clause.
 */
export async function shouldSaveJobResult(jobId: string): Promise<boolean> {
  const { data: currentJob } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", jobId)
    .single()

  if (currentJob?.status === "cancelled") {
    console.log(`[worker] Job ${jobId} was cancelled during processing, discarding result`)
    return false
  }
  return true
}

/**
 * Spread-into-output_data sidecar fields derived from a ProviderResult.
 * Centralises the seed/fallbackUsed/providerMs/kieTaskId capture so every
 * AI handler that lands a ProviderResult persists the same metadata in
 * the same shape.
 *
 * Usage:
 *   output_data: {
 *     videoUrl: r2Url,
 *     thumbnailUrl: thumbUrl,
 *     ...buildProviderMeta(result),
 *   }
 *
 * Each field is omitted when absent, so existing rows stay clean.
 */
export type ProviderMetaSource = Pick<
  ProviderResult,
  "kieTaskId" | "seed" | "fallbackFlag" | "providerMs"
>

export function buildProviderMeta(
  result: ProviderMetaSource | undefined | null,
): Record<string, unknown> {
  if (!result) return {}
  const meta: Record<string, unknown> = {}
  // providerTaskId is the public name; kieTaskId stays for the readers that
  // already key off it (the editor, the input resolver, saved workflows).
  if (result.kieTaskId) {
    meta.providerTaskId = result.kieTaskId
    meta.kieTaskId = result.kieTaskId
  }
  if (result.seed !== undefined) meta.seed = result.seed
  if (result.fallbackFlag === true) meta.fallbackUsed = true
  if (result.providerMs !== undefined) meta.providerMs = result.providerMs
  return meta
}

/**
 * Build the output_data row for any image-generation/edit/i2i job. Singular
 * `imageUrl` always populated as primary; `imageUrls` only set when the
 * provider returned multiple variants — the frontend uses array-presence to
 * decide whether to fan out into multiple GeneratedResult entries.
 */
export function buildImageOutputData(
  result: ProviderMetaSource,
  r2Urls: readonly string[],
): Record<string, unknown> {
  return {
    imageUrl: r2Urls[0]!,
    ...(r2Urls.length > 1 ? { imageUrls: r2Urls } : {}),
    ...buildProviderMeta(result),
  }
}

/**
 * Atomically flip a job to completed, but only if it hasn't been cancelled.
 * Returns true if the row was updated, false if the user cancelled mid-flight.
 *
 * Use this instead of `supabase.from("jobs").update({status:"completed",...}).eq("id", jobId)`
 * to close the cancel-during-update race. Otherwise:
 *   - Worker reads status="processing" (shouldSaveJobResult passes)
 *   - User cancels via /v1/jobs/:id/cancel — status flipped to "cancelled",
 *     usage_log refunded (per PR #1508)
 *   - Worker UPDATEs unconditionally → overwrites cancellation to "completed"
 *   - Net: jobs.status="completed" but usage_log.status="refunded" — user
 *     got the output AND a credit refund (free generation).
 *
 * The conditional UPDATE matches zero rows when the row was cancelled, and
 * the caller can skip commitJobCredits.
 */
export async function markJobCompleted(
  jobId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  return (await markJobCompletedDetailed(jobId, fields)) === "completed"
}

/**
 * What actually happened, for the three callers that must tell the outcomes
 * apart. `markJobCompleted` keeps its boolean because 45 of its 48 callers are
 * uniformly `const ok = await markJobCompleted(...); if (!ok) return` — which
 * is exactly right for a block or a hold (skip the commit, return) and would
 * have been 45 pointless edits.
 *
 * The three that need the distinction:
 *  - `render-worker` REFUNDS on `!ok`, which on a `held` outcome would release
 *    credits that must stay reserved;
 *  - the plugin toolkit re-reads the row on `false` and treats a non-terminal
 *    one as a retryable infrastructure failure — and `pending_review` IS
 *    non-terminal, so a hold would throw into the worker catch and defeat itself;
 *  - `finalizeJobWithMedia` must release its finalize claim on `held` and tell
 *    its own callers a policy outcome from a lost race.
 *
 * THE RESULT GATE RUNS HERE — after the caller's media is already at its
 * deterministic R2 key and BEFORE the completion CAS, so nothing is published:
 * no `output_data`, no asset row, no committed credit. The applier is reached
 * through a DYNAMIC import so that with no policy registered this file's module
 * graph (and every worker suite that mocks it) is unchanged, and so the
 * dependency direction stays one-way: shared.ts → the seam, never the reverse.
 *
 * THE IMAGE-SIZE STAMP RUNS HERE TOO, first (`lib/job-output-dimensions.ts`):
 * an output that publishes `imageUrl` gains its pixel size before the gate, so
 * a held row parks the stamped payload and approve publishes it as it is. It
 * never throws and is bounded by its own deadline; anything that is not an
 * image output passes through as the same object. The gate's idempotency key
 * stays the lane's OWN output (`hashSubject`): the size depends on timing, and
 * a re-pick whose read did not answer must still find the verdict recorded for
 * the first attempt instead of asking the policy again.
 */
export type MarkJobCompletedOutcome = "completed" | "lost_race" | "blocked" | "held"

export async function markJobCompletedDetailed(
  jobId: string,
  fields: Record<string, unknown>,
  /** Only `finalizeJobWithMedia` passes "finalize"; it is the sole input to
   *  `holdEligible` that a direct caller cannot supply. */
  funnel: "finalize" | "direct" = "direct",
  /** The caller's credit-settlement inputs, which are NOT jobs columns — the
   *  hold path stores them so approve can replay the metered true-up instead of
   *  committing a ceiling (Q2). */
  commitReplay?: HeldCommitReplay,
): Promise<MarkJobCompletedOutcome> {
  const stamped = await withOutputImageDimensions(fields)

  if (hasJobPolicyFor("result")) {
    const { applyResultGate } = await import("../lib/job-policy-gate.js")
    const laneOutput = (fields.output_data as Record<string, unknown> | undefined) ?? {}
    const applied = await applyResultGate(jobId, stamped, funnel, commitReplay, { hashSubject: laneOutput })
    if (applied !== "allow") return applied
  }

  const completion = {
    status: "completed",
    ...completedJobColumns(),
    ...stamped,
  }
  // With credits on, the completion and a ready managed charge commit in ONE
  // transaction (migration 513). "unavailable" = the function is not in the
  // database yet (staging runs ahead of main's migrations): the two-step path
  // below is then exactly what ran before.
  if (hasCredits()) {
    const atomic = await completeJobAndSettle(jobId, completion)
    if (atomic !== "unavailable") return afterCompletion(jobId, atomic)
  }
  // CAS on LIVE statuses (audit H3) — not .neq("cancelled"): the old guard
  // let a slow finalizer flip a FAILED row (already exhaustion-refunded)
  // back to completed, gifting refund + output. Live-status gating makes
  // completion single-shot against every terminal state.
  const { data, error } = await supabase
    .from("jobs")
    .update(completion)
    .eq("id", jobId)
    .in("status", ["pending", "processing"])
    // `usage_log_id` rides the CAS reply so settlement below needs no extra read.
    .select("id, usage_log_id")

  if (error) {
    console.error(`[worker] Failed to mark job ${jobId} completed:`, error.message)
    return "lost_race"
  }
  if (!data || data.length === 0) {
    console.log(`[worker] Job ${jobId} already terminal (cancelled/failed/completed) — not flipping to completed`)
    return "lost_race"
  }
  await settleManagedJobOnCompletion(jobId, (data[0] as { usage_log_id?: string | null }).usage_log_id)
  return afterCompletion(jobId, "completed")
}

/**
 * After a completion: an MCP conversation node waiting on this job gets its
 * result (lib/mcp/flows/hydrate.ts). Not awaited and never throws, so the
 * completion and its settlement are exactly as they were; a dynamic import, so
 * this module's graph (and every worker suite that mocks it) is unchanged.
 */
function afterCompletion<T extends MarkJobCompletedOutcome | "completed" | "lost_race">(jobId: string, outcome: T): T {
  if (outcome === "completed") {
    void import("../lib/mcp/flows/hydrate.js").then((m) => m.hydrateFlowNodeForJob(jobId)).catch(() => undefined)
  }
  return outcome
}

/** What `public.complete_job_and_settle` answers (migrations 513, 514). */
interface CompleteJobAndSettleReply {
  completed?: boolean
  usageLogId?: string | null
  settled?: boolean
  settleError?: string | null
}

/**
 * The outcome of one `complete_job_and_settle` call, for its two callers —
 * the worker's completion here and the reviewer's approval
 * (`lib/job-policy-review.ts`).
 *  - `unavailable`: the function (or, for an approval, its `p_from_review`
 *    form) is not in the database yet; the caller runs its two-step path.
 *  - `error`: the database refused the call; the transaction wrote nothing.
 *  - `lost`: the CAS matched no row (terminal, held, or already approved).
 *  - `completed`: the row is completed; `managedUsageLogId` is set when the
 *    reservation was a ready managed one — settled inside the transaction, or
 *    attempted there and failed (`settleError`) — so the caller replays the
 *    TypeScript settle for its side effects or as the retry.
 */
export type AtomicCompletion =
  | { outcome: "unavailable" }
  | { outcome: "error"; message: string }
  | { outcome: "lost" }
  | { outcome: "completed"; managedUsageLogId: string | null; settleError: string | null }

/**
 * COMPLETE AND SETTLE IN ONE TRANSACTION. `public.complete_job_and_settle`
 * runs the completion CAS and, when the job's reservation is a managed
 * (`job-once`) one whose lane recorded its READY charge, settles it before the
 * transaction commits — so no reader can see the job completed without its
 * charge (`credits_actual`, `credits_charged`). The two-step version left a
 * window between the statements in which an orchestrator poll counted the job
 * at 0.
 *
 * `fromReview` false (a worker): the live-status CAS, reached only on the
 * result gate's ALLOW path. `fromReview` true (an approval): the
 * `pending_review` CAS (migration 514). A settlement error never undoes the
 * completion: the function catches it in a subtransaction and returns it.
 */
export async function completeJobAndSettleAtomically(
  jobId: string,
  completion: Record<string, unknown>,
  fromReview = false,
): Promise<AtomicCompletion> {
  const { data, error } = await supabase.rpc("complete_job_and_settle", {
    p_job_id: jobId,
    p_fields: completion,
    // Sent only for an approval, so a worker's call is valid against
    // migration 513's two-argument function as well as 514's.
    ...(fromReview ? { p_from_review: true } : {}),
  })
  if (error) {
    if (isMissingFunctionError(error)) return { outcome: "unavailable" }
    return { outcome: "error", message: error.message }
  }
  const reply = (data ?? null) as CompleteJobAndSettleReply | null
  if (!reply?.completed) return { outcome: "lost" }
  const settleError = reply.settleError ?? null
  const managed = reply.usageLogId && (reply.settled || settleError) ? reply.usageLogId : null
  return { outcome: "completed", managedUsageLogId: managed, settleError }
}

/**
 * The worker's side of {@link completeJobAndSettleAtomically}. On a completed
 * row the TypeScript settle still runs afterwards — on a settled reservation an
 * idempotent replay that carries the side effects SQL cannot (the requester's
 * balance cache, the external-wallet delivery); on an error the retry, and
 * where the error is logged.
 */
async function completeJobAndSettle(
  jobId: string,
  completion: Record<string, unknown>,
): Promise<"completed" | "lost_race" | "unavailable"> {
  const result = await completeJobAndSettleAtomically(jobId, completion)
  if (result.outcome === "unavailable") return "unavailable"
  if (result.outcome === "error") {
    console.error(`[worker] Failed to mark job ${jobId} completed:`, result.message)
    return "lost_race"
  }
  if (result.outcome === "lost") {
    console.log(`[worker] Job ${jobId} already terminal (cancelled/failed/completed) — not flipping to completed`)
    return "lost_race"
  }
  if (result.settleError) {
    console.error(`[worker] Managed settlement inside completion failed for job ${jobId}:`, result.settleError)
  }
  if (result.managedUsageLogId) await replayManagedSettlement(jobId, result.managedUsageLogId)
  return "completed"
}

/**
 * SETTLE INSIDE COMPLETION — the two-step fallback, for a database that does
 * not have `complete_job_and_settle` yet. A managed (`job-once`) reservation
 * whose lane already wrote its READY checkpoint — the final charge, decided
 * before the job crossed the result gate — is settled right after the CAS, in
 * the same call, so a reader that sees the job completed after this call
 * returns also sees its charge.
 *
 * Only the `completed` outcome reaches here, i.e. AFTER the result gate's
 * verdict: a held job settles when it is approved (`approveHeldJob` →
 * `commitJobCredits`), a blocked or rejected one through the failure refund,
 * which settles a failed managed job at 0 — both already go through the same
 * managed settlement.
 *
 * Never throws: the row is already completed, and a settlement error must not
 * turn that into a failure. A lane's own post-completion settle replays the
 * same decision idempotently and is where an error surfaces. A reservation that
 * is not managed, or has no ready checkpoint, is left to its own commit path.
 */
async function settleManagedJobOnCompletion(jobId: string, usageLogId: string | null | undefined): Promise<void> {
  if (!usageLogId || !hasCredits()) return
  try {
    const { data } = await supabase.from("usage_logs").select("metadata").eq("id", usageLogId).maybeSingle()
    const metadata = (data as { metadata?: Record<string, unknown> | null } | null)?.metadata ?? null
    if (!isReadyManagedReservation(metadata)) return
  } catch (err) {
    console.error(`[worker] Managed settlement on completion failed for job ${jobId}:`, err instanceof Error ? err.message : err)
    return
  }
  await replayManagedSettlement(jobId, usageLogId)
}

/** The managed settle through the billing service. Never throws. */
async function replayManagedSettlement(jobId: string, usageLogId: string): Promise<void> {
  try {
    const { CreditsService } = await import("../ee/services/credits.js")
    await CreditsService.trySettleManagedCredits(usageLogId)
  } catch (err) {
    console.error(`[worker] Managed settlement on completion failed for job ${jobId}:`, err instanceof Error ? err.message : err)
  }
}

/**
 * A `job-once` reservation whose lane recorded its final (`ready`) charge.
 * Pinned to its SQL twin in `complete_job_and_settle` (migration 513) by
 * `workers/__tests__/complete-job-and-settle-migration.test.ts`.
 */
export function isReadyManagedReservation(metadata: Record<string, unknown> | null): boolean {
  if (metadata?.reservation_mode !== "job-once") return false
  const checkpoint = metadata.job_settlement_checkpoint as { ready?: unknown } | null | undefined
  return checkpoint?.ready === true || "job_settlement" in metadata
}

/**
 * GRACEFUL-STOP request (2026-07-21, gvp stop/continue): stamps
 * `jobs.stop_requested_at = now()` on an in-flight row. Deliberately NOT a
 * status flip — the checkpointed engine must still be able to complete the
 * job with its partial deliverable, and `markJobCompleted`'s live-status CAS
 * would refuse a cancelled row. Observed by `throwIfJobCancelled`'s throttled
 * fetch (`lib/job-cancellation.ts`), which throws `JobStopRequestedError`;
 * checkpointed handlers (generate-video-pro) convert it into a partial
 * finalize + honest settle. Scoped to in-flight statuses so a terminal row
 * is never stamped.
 */
export async function requestJobStop(jobId: string): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({ stop_requested_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["pending", "queued", "processing"])
  if (error) {
    throw new Error(`Failed to request stop for job ${jobId}: ${error.message}`)
  }
}

/**
 * Commit credits after successful job completion (cloud edition only).
 * When providerCostUsd is provided, computes actual credits from provider cost,
 * logs any anomaly, and passes actual credits to the RPC (which refunds surplus).
 * Wrapped in try-catch to avoid failing the job if credit commit fails.
 */
export async function commitJobCredits(
  usageLogId: string | null | undefined,
  jobId: string,
  providerCostUsd?: number | null,
  /**
   * Credits for work we performed that is NOT reflected in the provider's USD
   * cost — e.g. the loop-trim (smart-loop-cut) FFmpeg/PSNR add-on. Without
   * this, the provider-cost reconciliation below computes actual ≈ base and
   * commit_credits refunds the difference (the add-on), so the user gets the
   * post-process for free. Added on top of the provider-derived credits.
   */
  extraNonProviderCredits = 0,
  /**
   * Pricing convention (decision A): ONLY genuinely metered providers (Replicate
   * GPU-time: face-swap, legacy lip-sync, whisper transcribe) recompute the
   * charge from `providerCostUsd` and true-up. Every fixed/composite-priced
   * provider commits the RESERVED tier (markup already applied once at reserve
   * over the base price) — `reserved == committed`, no spurious refund, and
   * no under-charge from a flat/GPU-time `result.cost`. Default false.
   */
  metered = false,
  /**
   * The reservation was a CEILING, not an estimate (the Workflow Copilot
   * reserves the most a turn may spend and commits the metered actual). A
   * committed actual below the reservation is then the expected outcome, not
   * an "overcharge" anomaly — skip that branch; undercharge/zero-cost still log.
   */
  ceilingReservation = false,
): Promise<void> {
  if (!hasCredits() || !usageLogId) return

  const { CreditsService } = await import("../ee/services/credits.js")
  const { computeActualCredits, checkAndLogAnomaly } = await import("../ee/billing/credit-anomaly.js")

  try {
    if (await CreditsService.trySettleManagedCredits(usageLogId)) return
    if (metered && providerCostUsd && providerCostUsd > 0) {
      // usage_logs.action is the model identifier convention (checkAndLogAnomaly
      // below relies on the same). Fetched first so computeActualCredits can
      // apply the identifier's per-service margin — the same margin the reserve
      // applied — instead of the global markup (settings are cached, so the
      // sequential await costs nothing).
      const { data: usageLog } = await supabase
        .from("usage_logs")
        .select("credits_used, user_id, action, provider")
        .eq("id", usageLogId)
        .single()
      const providerCredits = await computeActualCredits(providerCostUsd, usageLog?.action ?? undefined)
      // Retained non-provider add-ons (e.g. loop-trim) are charged on top of
      // the provider-derived credits. This also makes the anomaly check
      // accurate (reserved included the add-on, so actual should too).
      const actualCredits = providerCredits + Math.max(0, extraNonProviderCredits)

      // checkAndLogAnomaly has internal try/catch so it never rejects
      const tasks: PromiseLike<unknown>[] = [
        CreditsService.commitCredits(usageLogId, actualCredits),
        supabase.from("jobs").update({ credits_actual: actualCredits }).eq("id", jobId),
      ]
      const belowCeiling = ceilingReservation && actualCredits <= usageLog?.credits_used
      if (usageLog && !belowCeiling) {
        tasks.push(checkAndLogAnomaly({
          jobId,
          userId: usageLog.user_id,
          usageLogId,
          modelIdentifier: usageLog.action ?? "unknown",
          provider: usageLog.provider ?? null,
          reservedCredits: usageLog.credits_used,
          actualCredits,
          providerCostUsd,
        }))
      }
      await Promise.all(tasks)

      console.log(`[worker] Credits committed for job ${jobId} (actual: ${actualCredits}, reserved: ${usageLog?.credits_used ?? "??"})`)
    } else if (metered && extraNonProviderCredits > 0 && !(providerCostUsd && providerCostUsd > 0)) {
      // Count-based metered actual (no provider USD cost) — used by features
      // that reserve credits against one count and commit against a
      // different, run-time-determined count.
      // `extraNonProviderCredits` is the BASE (pre-markup) actual. The usage
      // log is read FIRST because its `action` is the model identifier the
      // reserve was marked up under: the same identifier's effective margin
      // (`applyServiceMarkup` — a per-service margin when the admin set one,
      // else the global markup, exactly as credit-guard-impl.ts applies it)
      // must mark the actual up too, or reserved and committed sit on two
      // different bases and a measured settlement's refund silently shrinks.
      const { data: usageLog } = await supabase
        .from("usage_logs")
        .select("credits_used, user_id, action, provider")
        .eq("id", usageLogId)
        .single()
      const baseActual = Math.max(0, extraNonProviderCredits)
      const settings = await getAppSettings()
      const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
      const markedUp = applyServiceMarkup(baseActual, settings, usageLog?.action ?? "")

      // A count-based reservation is a CEILING (a worst case measured down at
      // completion), and `commit_credits` cannot collect above it anyway — it
      // would only record a `credits_charged` the user never paid. A measured
      // actual that lands a hair above the reservation (a delivered clip a
      // frame longer than its probed source) therefore settles AT the
      // reservation, never past it.
      const reserved = typeof usageLog?.credits_used === "number" ? usageLog.credits_used : undefined
      const actualCredits = reserved !== undefined ? Math.min(markedUp, reserved) : markedUp
      if (actualCredits !== markedUp) {
        console.warn(`[worker] count-based actual ${markedUp} exceeds the reservation ${reserved} for job ${jobId}; committing the reservation`)
      }

      // checkAndLogAnomaly has internal try/catch so it never rejects. Settling
      // BELOW a ceiling is the expected outcome of this branch, not an
      // "overcharge" (the USD branch's `belowCeiling` rule) — without this
      // every style run refunded down from its edit-mode reservation would
      // file a pending anomaly describing the feature working. The comparison
      // reads the PRE-clamp figure, and so does the anomaly row: an actual
      // ABOVE the reservation is the real money leak (an under-reservation)
      // and must still be recorded even though the clamp cannot collect it.
      const belowCeiling = reserved !== undefined && markedUp <= reserved
      const tasks: PromiseLike<unknown>[] = [
        CreditsService.commitCredits(usageLogId, actualCredits),
        supabase.from("jobs").update({ credits_actual: actualCredits }).eq("id", jobId),
      ]
      if (usageLog && !belowCeiling) {
        tasks.push(checkAndLogAnomaly({
          jobId,
          userId: usageLog.user_id,
          usageLogId,
          modelIdentifier: usageLog.action ?? "unknown",
          provider: usageLog.provider ?? null,
          reservedCredits: usageLog.credits_used,
          actualCredits: markedUp,
          // No provider USD cost on this path — it's a count-based charge.
          providerCostUsd: 0,
        }))
      }
      await Promise.all(tasks)

      console.log(`[worker] Credits committed for job ${jobId} (count-based actual: ${actualCredits}, reserved: ${usageLog?.credits_used ?? "??"})`)
    } else {
      // Fixed/composite provider (or cost-less): commit the RESERVED tier.
      await CreditsService.commitCredits(usageLogId)
      // Mirror the committed (= reserved) amount onto jobs.credits_actual so
      // admin/display stays accurate on this path too (the metered branch above
      // already sets it). The reserved amount already includes any add-on.
      const { data: ul } = await supabase
        .from("usage_logs")
        .select("credits_used")
        .eq("id", usageLogId)
        .single()
      if (typeof ul?.credits_used === "number") {
        await supabase.from("jobs").update({ credits_actual: ul.credits_used }).eq("id", jobId)
      }
      console.log(`[worker] Credits committed (reserved tier) for job ${jobId}`)
    }
  } catch (error) {
    console.error(`[worker] Failed to commit credits for job ${jobId}:`, error)
    // Don't fail the job if credit commit fails
  }
}

/**
 * Commit credits at ANOTHER credit id's charged price, clamped at the
 * reservation (cloud edition only) — for a run reserved as one product and
 * delivered as a cheaper one (a refused Suno Separate run finished by the
 * Demucs fallback pays the Demucs price). The settle lives in
 * `ee/billing/commit-at-charged-price.ts`; a failure is logged and never
 * fails the job, like `commitJobCredits`.
 */
export async function commitJobCreditsAtChargedPrice(
  usageLogId: string | null | undefined,
  jobId: string,
  creditId: string,
): Promise<void> {
  if (!hasCredits() || !usageLogId) return

  try {
    const { commitAtChargedPrice } = await import("../ee/billing/commit-at-charged-price.js")
    const { committed, reserved } = await commitAtChargedPrice(usageLogId, jobId, creditId)
    console.log(`[worker] Credits committed at ${creditId}'s charged price for job ${jobId} (actual: ${committed}, reserved: ${reserved ?? "??"})`)
  } catch (error) {
    console.error(`[worker] Failed to commit credits for job ${jobId}:`, error)
    // Don't fail the job if credit commit fails
  }
}

/**
 * Refund credits after job failure (cloud edition only).
 *
 * Defaults to refunding (safe for the user). The ONLY case we skip the refund
 * is an EXPLICIT "the provider already delivered" signal — a
 * `PostProcessingError` (or an error carrying `postProcessing === true`) raised
 * by a step that runs strictly AFTER a successful provider call (R2 upload,
 * watermark, transcode, audio-merge, strip-audio, smart-loop-cut). In that
 * case the provider already billed us, so refunding would be a giveaway.
 *
 * Why a typed signal and NOT substring-matching the message (the old approach):
 * the strings the post-provider steps actually throw ("ffmpeg failed: ...",
 * "Failed to download: <url>", raw AWS SDK errors) never matched the old
 * patterns, so the guard never fired in prod (revenue leak). Worse, some
 * patterns ("failed to download image") ALSO match a PRE-provider INPUT
 * download failure, which would have wrongly SKIPPED the refund and CHARGED a
 * user for a job the provider never did. The typed signal is unambiguous and
 * only ever raised post-delivery — see `lib/post-processing-error.ts`.
 *
 * Pre-provider failures (createTask errors, content moderation, NSFW
 * rejections, validation errors, timeouts, input-download failures) are plain
 * errors → always refunded.
 *
 * `errorOrMessage` accepts the thrown value directly (preferred — pass `err`
 * from the catch so the TYPE is preserved) or a legacy string (always refunds;
 * a string carries no post-delivery signal, which is the safe default).
 */
/**
 * Worker job types whose product IS the LLM call — the only ones whose hold a
 * billed content refusal commits instead of refunding ({@link refundJobCredits}'s
 * `chargeBilledRefusal`). Decided 2026-10-16: a refusal is charged only where
 * the answer was the thing bought. A composite or media job in which Claude
 * is one step (generate-video-pro's planner, recast planning, any plugin or
 * media node) refunds as before — its error chain may well carry the
 * planner's billed refusal, so the rule is opted into by job type, never
 * inferred from the error.
 *
 * - `llm-structured`: `/v1/llm/structured/jobs` — the structured answer.
 * - `generate-3d-scene` / `edit-3d-scene`: the hold is the LLM authoring tier
 *   alone (`buildLlmCreditIdentifier("3d-scene", …)`, or the model-free ops
 *   price, which cannot refuse); a video reference is analysed — and charged
 *   — as its own child job.
 */
export const LLM_PRODUCT_JOB_TYPES: ReadonlySet<string> = new Set(["llm-structured", "generate-3d-scene", "edit-3d-scene"])

// ── Metered LLM worker jobs (D1/D10) ──
//
// A worker job reserved under a metered LLM charge id (`<feature>:<model>`,
// `lib/llm-billing.ts`) is settled from what its calls really cost — success
// AND failure — never by committing or refunding the hold whole. Whether a
// job is metered is decided by its RESERVATION (the usage log's `action`),
// never by the rollback switch, so a job reserved metered before a rollback
// flip still settles metered, and a tier reservation keeps today's path.

/** Where a handler's spend rides a thrown error to the failure net. Annotated, never wrapped. */
const LLM_SPEND_KEY = Symbol.for("nodaro.worker.llmSpend")

/**
 * Annotate a thrown error with the job's metered spend, so the worker's
 * final-attempt failure net ({@link refundJobCredits}) charges every billed
 * call — a lottie's first answer plus its failed repair, each Scene3D
 * revision, a script whose answer failed to parse. The error object itself is
 * returned (never wrapped): the failure funnel's `instanceof` checks
 * (post-processing, safety, deterministic) run on it.
 */
export function attachLlmSpend<E>(err: E, spend: LlmSpend): E {
  if (err !== null && typeof err === "object") {
    try {
      Object.defineProperty(err, LLM_SPEND_KEY, { value: spend, enumerable: false, configurable: true })
    } catch {
      // A frozen error: the failure net falls back to what the error itself carries.
    }
  }
  return err
}

/** The spend {@link attachLlmSpend} put on an error (or on one in its `cause` chain). */
export function llmSpendOf(err: unknown): LlmSpend | undefined {
  let cur: unknown = err
  for (let depth = 0; cur !== null && typeof cur === "object" && depth < 8; depth++) {
    const spend = (cur as Record<symbol, unknown>)[LLM_SPEND_KEY]
    if (spend) return spend as LlmSpend
    cur = (cur as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * The metered charge id a job's hold was reserved under, read off its usage
 * log: `{ kind: "metered", chargeId }`, `{ kind: "not-metered" }` (a tier or
 * fixed reservation, no log, or no credits), or `{ kind: "unknown" }` when the
 * log could not be read.
 */
export async function meteredReservationOf(
  usageLogId: string | null | undefined,
): Promise<{ kind: "metered"; chargeId: string } | { kind: "not-metered" } | { kind: "unknown" }> {
  if (!hasCredits() || !usageLogId) return { kind: "not-metered" }
  try {
    const { data, error } = await supabase.from("usage_logs").select("action").eq("id", usageLogId).maybeSingle()
    if (error) return { kind: "unknown" }
    const action = (data as { action?: unknown } | null)?.action
    if (typeof action !== "string") return { kind: "not-metered" }
    const { parseMeteredLlmId } = await import("../ee/billing/metered-llm-id.js")
    return parseMeteredLlmId(action) ? { kind: "metered", chargeId: action } : { kind: "not-metered" }
  } catch (err) {
    console.warn(`[worker] could not read the reservation of usage log ${usageLogId}:`, err)
    return { kind: "unknown" }
  }
}

/** What {@link WorkerLlmBilling.settle} did. `metered: false` = a tier reservation: the caller commits as before. */
export type WorkerLlmSettle =
  | { metered: false }
  | {
      metered: true
      outcome: LlmSettleOutcome["outcome"]
      /**
       * The commit receipt's `charged` — the job's `credits_actual` — when the
       * settle charged. (The billing ledger itself is the settle's to write, in
       * the server-only ledger column — never on the completion's `output_data`, R32.)
       */
      charged?: number
    }

/** A worker handler's metered billing: the spend its calls are recorded on, and the settle. */
export interface WorkerLlmBilling {
  /** Whether the hold was reserved metered (read off its usage log once, at the start). */
  readonly metered: boolean
  /**
   * The job's spend — what {@link attachLlmSpend} carries to the failure net.
   * On a metered hold it starts from the attempts an EARLIER BullMQ attempt of
   * this job billed (R31: carried on the row by {@link WorkerLlmBilling.noteSpend}),
   * so every billed attempt is charged, not only the last.
   */
  readonly spend: LlmSpend
  /**
   * Where every call the job makes is recorded — answered, repaired, revised,
   * or failed with billed usage. The spend itself on a metered hold, and on a
   * hold whose reservation could not be read (the failure net re-reads it and
   * must not be left without the real requests); a no-op on a hold known not
   * to be metered (a tier hold under the rollback runs exactly as before).
   */
  readonly recorder: Pick<LlmSpend, "add">
  /**
   * Record what the job has billed so far on the row: `provider_cost` and a
   * running ledger in the server-only ledger column (with its `attempts`,
   * R32 — never `output_data`) — after each
   * answered call AND before a billed failure is rethrown. A cancel or the
   * reconcile sweep that looks at the job then sees it billed and charges its
   * hold instead of refunding it (D10), and a BullMQ retry of the job seeds its
   * spend from it (R31). Metered jobs only; a spend that billed nothing writes
   * nothing; never throws.
   */
  noteSpend(): Promise<void>
  /**
   * Seed an unseeded spend (D13: the start read failed on a final attempt)
   * from the row BEFORE the job's first call: an earlier attempt's billed
   * calls are carried in, floored to the row's `provider_cost` like the start
   * carry while this attempt has billed nothing yet. `false` when the row
   * still cannot be read (a later read — noteSpend, the settle, the failure
   * net — seeds it then); `true` without a read for a seeded spend or a hold
   * that is not metered. The ledger lives in its own column, so a handler
   * write that replaces `output_data` can no longer drop it.
   */
  seedFromRow(): Promise<boolean>
  /**
   * R38: call immediately before the job's FIRST LLM call (idempotent after
   * it). A metered job's row carries a pre-call marker from the moment its
   * billing opened, so a cancel before the call refunds the hold at once; this
   * clears it and stamps `provider_call_started_at`, CAS on a live status.
   * Throws `JobCancelledError` when the row was cancelled first (the call must
   * not be sent), and a plain error when the start could not be recorded
   * (nothing is sent: the failure net refunds). A no-op on a hold that is not
   * metered (the rollback runs exactly as before).
   */
  callStarting(): Promise<void>
  /**
   * Settle the hold from the spend — BEFORE the job's terminal write. On
   * `unsettled` the caller returns WITHOUT completing: the row stays
   * non-terminal and the reconcile sweep charges the hold (C3).
   */
  settle(): Promise<WorkerLlmSettle>
}

/**
 * The running ledger a spend makes — its record, or the uncomputable ledger
 * the settle writes when its cost cannot be computed — with its charge id and
 * every attempt (R31: what a retry seeds from).
 */
function spendLedger(spend: LlmSpend, chargeId: string): LlmBillingLedgerWrite {
  let ledger: LlmBillingLedgerWrite
  try {
    const record = spend.record
    if (!Number.isFinite(record.costUsd) || record.costUsd < 0) throw new Error("non-finite cost")
    ledger = { ...record, chargeId }
  } catch {
    ledger = { costUsd: null, source: "uncomputable", calls: spend.attempts.length, lanes: spend.attempts.map((a) => a.lane), chargeId }
  }
  return { ...ledger, attempts: [...spend.attempts] }
}


/**
 * Spends opened on a FINAL attempt whose start read of the row failed (D13):
 * not yet seeded with what an earlier BullMQ attempt billed. The first read
 * that succeeds later — {@link WorkerLlmBilling.noteSpend}, the settle, or the
 * failure net — carries the row's attempts in once, then removes the spend.
 */
const unseededSpends = new WeakSet<LlmSpend>()

/**
 * Spends {@link workerLlmBilling} opened on a hold that is metered — or whose
 * reservation could not be read. Only an error carrying one of these reaches
 * {@link settleCancelledMeteredJob}: a tier job's error (its spend is attached
 * too) never costs a read there, so the rollback stays byte-identical.
 */
const meteredOpenSpends = new WeakSet<LlmSpend>()

/** Carry the attempts a row's running ledger recorded (an earlier BullMQ attempt's billed calls, R31) into a spend. */
function carryRowAttempts(spend: LlmSpend, chargeId: string, ledger: Record<string, unknown> | undefined, jobId: string): void {
  const carried = Array.isArray(ledger?.attempts) ? (ledger.attempts as unknown[]) : []
  if (carried.length === 0) return
  try {
    spend.add(chargeId, { modelId: chargeId, system: "", messages: [] }, { output: { attempts: carried } as never })
    console.log(`[worker] Job ${jobId}: carried ${carried.length} billed call(s) from an earlier attempt`)
  } catch (err) {
    console.error(`[worker] Job ${jobId}: an earlier attempt's spend could not be read — not carried:`, err)
  }
}

/**
 * The start carry's floor: a row whose cumulative `provider_cost` exceeds
 * what its carried attempts sum to (an earlier attempt's last `noteSpend`
 * read failed, so it wrote the cost alone and its attempts are stale) carries
 * the difference as one stated attempt, on the lane the ledger names. Only
 * at the start of an attempt — before it has written anything. Unpriceable
 * carried attempts (a missing rate) are kept as recorded: the settle owns it.
 */
function floorToRowProviderCost(spend: LlmSpend, modelId: string, ledger: Record<string, unknown> | undefined, providerCost: number | undefined, jobId: string): void {
  if (typeof providerCost !== "number" || !Number.isFinite(providerCost) || providerCost <= 0) return
  let carriedUsd: number
  try {
    carriedUsd = spend.costUsd
  } catch {
    return
  }
  const gap = providerCost - carriedUsd
  // A rounding-level tolerance: the row's cost IS the attempts' sum when both were written together.
  if (!(gap > 1e-9)) return
  try {
    spend.add(modelId, { modelId, system: "", messages: [] }, {
      output: { attempts: [{ lane: ledgerLane(ledger), modelId, requestChars: 0, inputTokens: 0, outputTokens: 0, creditsUsd: gap }] } as never,
    })
    console.log(`[worker] Job ${jobId}: carried $${gap} an earlier attempt billed beyond its recorded attempts (provider_cost ${providerCost})`)
  } catch (err) {
    console.error(`[worker] Job ${jobId}: the row's provider_cost could not be carried:`, err)
  }
}

/**
 * Open a worker job's metered billing (see {@link WorkerLlmBilling}). A
 * reservation that is not metered — a tier id under the rollback, a fixed
 * price, no credits — answers `metered: false`, and `settle` hands the
 * caller back to its existing commit, byte-identical. A log that cannot be
 * read is treated the same way on success (the existing commit charges the
 * hold whole — never free); its calls are still recorded, for the failure net.
 *
 * `job` is the BullMQ attempt (D13): a row that cannot be read at the start
 * fails the attempt only while a retry remains.
 */
export async function workerLlmBilling(
  ctx: Pick<JobContext, "jobId" | "usageLogId">,
  job: Pick<Job, "attemptsMade" | "opts">,
): Promise<WorkerLlmBilling> {
  const { LlmSpend: Spend } = await import("../lib/llm-billing.js")
  const spend = new Spend()
  const reservation = await meteredReservationOf(ctx.usageLogId)
  if (reservation.kind === "unknown" && ctx.usageLogId) {
    // The reservation could not be read: it may be metered. Its calls are
    // recorded (the failure net re-reads it), a cancel finds the row billed
    // (m1: `noteSpend` raises the cumulative `provider_cost` — monotone, never
    // the ledger, which needs the charge id), and a row already cancelled is
    // not sent its call (the cancel kept the hold: no pre-call marker here).
    meteredOpenSpends.add(spend)
    return {
      metered: false,
      spend,
      recorder: spend,
      noteSpend: async () => {
        if (!spend.billedAnything) return
        try {
          const cost = spend.costUsd
          if (!Number.isFinite(cost) || cost <= 0) return
          const { error } = await supabase
            .from("jobs")
            .update({ provider_cost: cost })
            .eq("id", ctx.jobId)
            .or(`provider_cost.is.null,provider_cost.lt.${cost}`)
          if (error) console.warn(`[worker] Job ${ctx.jobId}: could not record its spend so far: ${error.message}`)
        } catch (err) {
          console.warn(`[worker] Job ${ctx.jobId}: could not record its spend so far:`, err)
        }
      },
      seedFromRow: async () => true,
      callStarting: async () => {
        await throwIfRowCancelled(ctx.jobId)
      },
      settle: async () => ({ metered: false }),
    }
  }
  if (reservation.kind !== "metered" || !ctx.usageLogId) {
    return {
      metered: false,
      spend,
      recorder: { add: () => {} },
      noteSpend: async () => {},
      seedFromRow: async () => true,
      callStarting: async () => {},
      settle: async () => ({ metered: false }),
    }
  }
  meteredOpenSpends.add(spend)
  const usageLogId = ctx.usageLogId
  const { chargeId } = reservation
  const { parseMeteredLlmId } = await import("../ee/billing/metered-llm-id.js")
  const modelId = parseMeteredLlmId(chargeId)?.modelId ?? chargeId
  // R31: an earlier BullMQ attempt's billed calls are this job's too, carried
  // from the row. D13 (owner decision) for a row that cannot be read:
  //  - a retry remains → fail the attempt BEFORE any call (nothing is spent
  //    yet); the retry gets a clean read. Starting empty would settle without
  //    the earlier billed calls (a silent refund, D10).
  //  - the final / only attempt → proceed (a first attempt has nothing earlier
  //    to lose). The spend starts empty and is seeded from the row by the first
  //    read that succeeds later (noteSpend, settle, or the failure net).
  const row = await rowBilling(ctx.jobId)
  if (row.readFailed) {
    if (!isFinalJobAttempt(job)) {
      throw new Error(`Job ${ctx.jobId}: its billing ledger could not be read — not started, so an earlier attempt's billed calls are not lost (a retry remains)`)
    }
    unseededSpends.add(spend)
    console.warn(`[worker] Job ${ctx.jobId}: its billing ledger could not be read on the final attempt — proceeding; seeded from the row once it reads`)
  } else {
    carryRowAttempts(spend, chargeId, row.ledger, ctx.jobId)
    // Only at the START: nothing of this attempt is on the row yet, so its
    // provider_cost is an earlier attempt's alone. A late seed floors only
    // where its read is equivalent to this one (seedFromRow before any call) —
    // never once this attempt's monotone write may be in that figure.
    floorToRowProviderCost(spend, modelId, row.ledger, row.providerCost, ctx.jobId)
  }
  // R38: the row is marked pre-call until the first call is about to be sent,
  // so a cancel in the meantime (an analysis wait, preprocessing) refunds the
  // hold at once instead of keeping it as "billed-unknown". Only an empty
  // ledger column (or a crashed earlier attempt's marker) is marked: a billed
  // earlier attempt's ledger is never replaced. Unmarked (a failed write, a
  // billed ledger) → a cancel keeps the hold, R36's conservative answer.
  const { writeLlmPreCallMarker, clearLlmPreCallMarker } = await import("../lib/llm-billing-ledger.js")
  const markerOwned = await writeLlmPreCallMarker(ctx.jobId, chargeId)
  let callStarted = false
  const lateSeed = (ledger: Record<string, unknown> | undefined): void => {
    if (!unseededSpends.has(spend)) return
    unseededSpends.delete(spend)
    carryRowAttempts(spend, chargeId, ledger, ctx.jobId)
  }
  return {
    metered: true,
    spend,
    recorder: spend,
    noteSpend: async () => {
      if (!spend.billedAnything) return
      try {
        // D13: an unseeded spend is seeded by this read (this attempt has not
        // written the ledger yet — only a seeded spend writes it — so the
        // row's attempts are all an earlier attempt's: never counted twice).
        if (unseededSpends.has(spend)) {
          const late = await rowBilling(ctx.jobId)
          if (!late.readFailed) lateSeed(late.ledger)
        }
        const ledger = spendLedger(spend, chargeId)
        const cost = typeof ledger.costUsd === "number" && ledger.costUsd > 0 ? ledger.costUsd : undefined
        if (unseededSpends.has(spend)) {
          // Still unseeded: this spend may lack an earlier attempt's calls, so
          // it never writes the ledger (the late seed would read this
          // attempt's calls back as an earlier one's), and its cost only
          // RAISES the row's cumulative provider_cost (it marks the job
          // billed), never lowers it.
          if (cost === undefined) return
          const { error } = await supabase
            .from("jobs")
            .update({ provider_cost: cost })
            .eq("id", ctx.jobId)
            .or(`provider_cost.is.null,provider_cost.lt.${cost}`)
          if (error) console.warn(`[worker] Job ${ctx.jobId}: could not record its spend so far: ${error.message}`)
          return
        }
        // Seeded: the spend holds every billed attempt of the job, so the
        // running ledger REPLACES the column, with its cost in the same update.
        const { writeLlmBillingLedger } = await import("../lib/llm-billing-ledger.js")
        if (!(await writeLlmBillingLedger(ctx.jobId, ledger, cost !== undefined ? { providerCost: cost } : {}))) {
          console.warn(`[worker] Job ${ctx.jobId}: could not record its spend so far`)
        }
      } catch (err) {
        console.warn(`[worker] Job ${ctx.jobId}: could not record its spend so far:`, err)
      }
    },
    seedFromRow: async () => {
      if (!unseededSpends.has(spend)) return true
      // Nothing of this attempt is in the ledger yet (only a seeded spend
      // writes it), so its attempts are all an earlier attempt's.
      // Before this attempt billed anything, its noteSpend has written nothing
      // either (it returns early on an empty spend), so the row's
      // provider_cost is an earlier attempt's alone: this read is a start
      // read, and floors like one. Once it billed, its monotone write may be
      // in that figure — never floored then.
      const beforeAnyCall = !spend.billedAnything
      const late = await rowBilling(ctx.jobId)
      if (late.readFailed) return false
      lateSeed(late.ledger)
      if (beforeAnyCall) floorToRowProviderCost(spend, modelId, late.ledger, late.providerCost, ctx.jobId)
      return true
    },
    callStarting: async () => {
      if (callStarted) return
      const cancelled = async (): Promise<never> => {
        const { JobCancelledError } = await import("../lib/job-cancellation.js")
        throw new JobCancelledError(ctx.jobId)
      }
      if (markerOwned) {
        const started = await clearLlmPreCallMarker(ctx.jobId)
        // Cancelled before its first call: nothing is sent, nothing billed by
        // this attempt — the cancel refunded the hold (it saw the marker).
        if (started === "not-live") await cancelled()
        if (started === "error") {
          // Sending the call with the marker still on the row would let a
          // cancel refund a call in flight (D10): not sent — the failure net
          // refunds what nothing billed.
          throw new Error(`Job ${ctx.jobId}: the start of its LLM call could not be recorded — not sent`)
        }
      } else {
        // Unmarked (a billed earlier attempt's ledger, a failed marker write, a
        // row already cancelled when billing opened): a cancel keeps such a
        // hold (R36), so a row already cancelled is not sent its call at all —
        // the settle refunds what nothing billed. A failed read proceeds.
        await throwIfRowCancelled(ctx.jobId)
      }
      callStarted = true
    },
    settle: async () => {
      const { settleLlmUsageLog } = await import("../lib/llm-billing.js")
      if (unseededSpends.has(spend)) {
        // D13: one more read for an earlier attempt's calls; still unreadable →
        // settle what this (final) attempt billed.
        const late = await rowBilling(ctx.jobId)
        if (!late.readFailed) lateSeed(late.ledger)
      }
      const settled = await settleLlmUsageLog(usageLogId, ctx.jobId, chargeId, spend)
      if (settled.outcome === "unsettled") {
        console.error(`[worker] Job ${ctx.jobId}: its metered settle (${chargeId}) was not confirmed — left non-terminal for the reconcile sweep`)
        return { metered: true, outcome: settled.outcome }
      }
      return {
        metered: true,
        outcome: settled.outcome,
        ...(settled.outcome === "charged" ? { charged: settled.charged } : {}),
      }
    },
  }
}

/**
 * Throw `JobCancelledError` when the job's row is `cancelled` — the check a
 * metered call makes before it is sent when the row carries no pre-call
 * marker (R38). A failed read proceeds: the call's own settle still charges it.
 */
async function throwIfRowCancelled(jobId: string): Promise<void> {
  let status: unknown
  try {
    const { data } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle()
    status = (data as { status?: unknown } | null)?.status
  } catch (err) {
    console.warn(`[worker] Job ${jobId}: could not read its status before its first call:`, err)
  }
  if (status === "cancelled") {
    const { JobCancelledError } = await import("../lib/job-cancellation.js")
    throw new JobCancelledError(jobId)
  }
}

/**
 * The failure net's metered branch (D10): a failed job whose hold is metered
 * is settled from what it billed — the spend its handler attached
 * ({@link attachLlmSpend}), else the usage the error itself carries — charged
 * when anything was billed, refunded when nothing was. Never the whole hold,
 * never a refund of a billed call. An unconfirmed settle is left reserved and
 * REPORTED (the row is already failed, so no sweep revisits it). Returns false
 * for a reservation that is not metered: the caller refunds as before.
 */
async function settleFailedMeteredJob(
  usageLogId: string,
  jobId: string,
  errorOrMessage: unknown,
  /** `cancelled-run` (R38): the job's row was cancelled while it ran — its own report. */
  context: "failure" | "cancelled-run" = "failure",
): Promise<boolean> {
  const reservation = await meteredReservationOf(usageLogId)
  if (reservation.kind === "not-metered") return false
  const { LlmSpend: Spend, settleLlmUsageLog } = await import("../lib/llm-billing.js")
  // The handler's spend — every metered worker handler attaches one, recorded
  // with its REAL requests (and the calls an earlier BullMQ attempt billed).
  // Only an error with no handler spend at all is read for its own usage.
  let spend = llmSpendOf(errorOrMessage)
  if (spend && unseededSpends.has(spend)) {
    // D13: the handler's spend was opened on a final attempt whose start read
    // of the row failed, so it may lack an earlier attempt's billed calls. One
    // more read seeds it; still unreadable → never settled or refunded on a
    // guess (D10): left reserved, and reported.
    if (reservation.kind !== "metered") {
      await reportUnsettledMeteredFailure(jobId, usageLogId, "the reservation could not be read", context)
      return true
    }
    const late = await rowBilling(jobId)
    if (late.readFailed) {
      await reportUnsettledMeteredFailure(jobId, usageLogId, "its billing ledger could not be read", context)
      return true
    }
    unseededSpends.delete(spend)
    carryRowAttempts(spend, reservation.chargeId, late.ledger, jobId)
  }
  if (!spend) {
    spend = new Spend()
    if (reservation.kind === "metered") {
      const fromRow = await meteredSpendFromRow(jobId, reservation.chargeId)
      if (fromRow) {
        spend = fromRow.spend
        // Only a row that recorded nothing is topped up with what the error
        // itself carries (never both: that would count the failure twice).
        if (!fromRow.fromRow && errorOrMessage !== null && typeof errorOrMessage === "object") {
          try {
            spend.add(fromRow.modelId, { modelId: fromRow.modelId, system: "", messages: [] }, { error: errorOrMessage })
          } catch (err) {
            console.warn(`[worker] Job ${jobId}: the failure's usage could not be read:`, err)
          }
        }
        if (fromRow.readFailed) {
          // The row could not be read: what the job billed (an earlier
          // attempt's calls included) is unknown, so neither a refund nor a
          // settle of the error's usage alone is safe. Never refunded on a
          // guess (D10) — left reserved, and reported.
          await reportUnsettledMeteredFailure(jobId, usageLogId, "its billing ledger could not be read", context)
          return true
        }
      }
    }
  }
  if (reservation.kind === "unknown") {
    // The reservation could not be read. Nothing billed → refund as before;
    // billed → never refunded on a guess: left reserved, and reported.
    if (!spend.billedAnything) return false
    await reportUnsettledMeteredFailure(jobId, usageLogId, "the reservation could not be read", context)
    return true
  }
  const settled = await settleLlmUsageLog(usageLogId, jobId, reservation.chargeId, spend)
  if (settled.outcome === "unsettled") {
    await reportUnsettledMeteredFailure(jobId, usageLogId, "the settle was not confirmed", context)
  } else {
    console.log(`[worker] Metered failure of job ${jobId} settled: ${settled.outcome}${settled.outcome === "charged" ? ` (${settled.charged} credits)` : ""}`)
  }
  return true
}

async function reportUnsettledMeteredFailure(
  jobId: string,
  usageLogId: string,
  why: string,
  context: "failure" | "cancelled-run" = "failure",
): Promise<void> {
  const { insertAppReport } = await import("../lib/app-reports.js")
  if (context === "cancelled-run") {
    // Not stranded: the reconcile sweep's cancelled-hold pass settles it from
    // the row's ledger after the grace (and reports an error at its cap).
    console.warn(`[worker] cancelled metered job ${jobId} — ${why}; its hold (log ${usageLogId}) is kept for the reconcile sweep, never refunded`)
    await insertAppReport({
      node: "llm-billing-worker",
      kind: "metered-hold-unsettled-on-cancelled-run",
      severity: "warning",
      title: `Metered LLM job ${jobId} was cancelled while it ran; its hold is kept (${why}) — settled by the sweep`,
      payload: { usageLogId, why },
      jobId,
    })
    return
  }
  console.error(`[worker] ALERT: failed metered job ${jobId} — ${why}; its hold (log ${usageLogId}) is left reserved, never refunded`)
  await insertAppReport({
    node: "llm-billing-worker",
    kind: "metered-hold-unsettled-on-failure",
    severity: "error",
    title: `Metered LLM job ${jobId} failed and its hold could not be settled (${why})`,
    payload: { usageLogId, why },
    jobId,
  })
}

/**
 * R38: a metered LLM job whose row was CANCELLED while its worker ran still
 * settles — the worker's handler unwound with a `JobCancelledError`, or failed
 * on the cancelled row (its `markJobFailed` CAS lost, so the failure net never
 * ran). A cancel that found the job's call started kept its hold (R36: billed-
 * unknown), and the row is cancelled, so nothing else revisits it soon: this
 * charges what the job billed (D10: a billed call is never refunded; D2: a
 * stopped call is charged its estimated usage, as the spend recorded it) and
 * refunds a hold nothing billed against. The row stays `cancelled`.
 *
 * Only an error carrying a spend `workerLlmBilling` opened metered (or on an
 * unreadable reservation) is considered: every other error — every tier job
 * under the rollback — returns `false` with no read, and the cancel route owns
 * its refund exactly as before. `true` = the row is cancelled and its metered
 * hold was handed to the settle (an unconfirmed settle is reported; the
 * cancelled-hold sweep retries it). Never throws.
 */
export async function settleCancelledMeteredJob(
  usageLogId: string | null | undefined,
  jobId: string,
  err: unknown,
): Promise<boolean> {
  const spend = llmSpendOf(err)
  if (!spend || !meteredOpenSpends.has(spend) || !usageLogId || !hasCredits()) return false
  try {
    const { data, error } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle()
    if (error || (data as { status?: unknown } | null)?.status !== "cancelled") return false
    // An unbilled hold on a reservation that could not be read answers false
    // here: left to the cancel route's refund or the cancelled-hold sweep.
    const settled = await settleFailedMeteredJob(usageLogId, jobId, err, "cancelled-run")
    if (settled) console.log(`[worker] Job ${jobId} was cancelled mid-run — its metered hold was settled (the row stays cancelled)`)
    return true
  } catch (settleErr) {
    console.error(`[worker] Job ${jobId}: the settle of its cancelled metered hold failed — left for the cancelled-hold sweep:`, settleErr)
    return true
  }
}

/**
 * R38 (m5): a metered LLM job whose BullMQ entry is picked up AFTER its row was
 * cancelled — a retry waiting out its backoff, a job a worker drain handed back
 * to the queue — is discarded at pickup without running. Once the row is past
 * the cancelled-hold grace (N2: a stall re-pick's stalled-but-alive processor
 * may still be mid-call before it), its hold is settled there and then: what
 * the row recorded billed is charged at its actual and the rest released, or a
 * hold nothing billed is refunded. The row stays cancelled; within the grace
 * the reconcile sweep's cancelled-hold pass settles it later.
 *
 * Only a still-RESERVED metered hold on a CANCELLED row is touched (a hold the
 * cancel already settled or refunded is not); a tier hold returns before any
 * write. Keyed off the reservation, never the pricing switch (R15): a metered
 * hold reserved before a rollback flip is settled all the same; before this
 * process has confirmed the metered schema (R33) it is left to the sweep.
 * Never throws: a failure leaves the hold to the sweep's cancelled-hold pass.
 */
export async function settleDiscardedCancelledMeteredHold(usageLogId: string | null | undefined, jobId: string): Promise<void> {
  if (!hasCredits() || !usageLogId) return
  try {
    // Keyed off the reservation (R15), not the pricing switch: a metered hold
    // reserved before a rollback flip still settles. Before this process has
    // confirmed the metered schema it is left to the cancelled-hold sweep.
    const { llmMeteredSchemaReady } = await import("../lib/llm-metered-schema-gate.js")
    if (!llmMeteredSchemaReady()) return
    const { data: log, error } = await supabase.from("usage_logs").select("action, status").eq("id", usageLogId).maybeSingle()
    if (error || !log) return
    const { action, status } = log as { action?: unknown; status?: unknown }
    if (status !== "reserved" || typeof action !== "string") return
    const { parseMeteredLlmId } = await import("../ee/billing/metered-llm-id.js")
    if (!parseMeteredLlmId(action)) return
    const { data: row } = await supabase
      .from("jobs")
      .select("status, provider_kind, provider_call_started_at, created_at, job_type, input_data")
      .eq("id", jobId)
      .maybeSingle()
    if ((row as { status?: unknown } | null)?.status !== "cancelled") return
    // N2: only past the SAME grace the sweep's cancelled-hold pass waits. A
    // BullMQ stall re-pick can discard a job whose stalled-but-alive processor
    // is still mid-call (lockDuration 300 s, maxStalledCount 3): settling now
    // would refund that call's unbilled hold, or release the rest of the hold
    // under it. Within the grace the sweep settles it later.
    const { cancelledHoldPastGrace } = await import("../lib/reconcile/cancelled-metered-holds.js")
    if (!cancelledHoldPastGrace(row as Record<string, unknown>, Date.now())) return
    const fromRow = await meteredSpendFromRow(jobId, action)
    if (!fromRow || fromRow.readFailed) return // never settled or refunded on a guess — the sweep reads it later
    const { settleLlmUsageLog } = await import("../lib/llm-billing.js")
    const settled = await settleLlmUsageLog(usageLogId, jobId, action, fromRow.spend)
    console.log(`[worker] Job ${jobId} discarded at pickup (cancelled) — its metered hold settled: ${settled.outcome}`)
  } catch (err) {
    console.warn(`[worker] Job ${jobId}: settling the metered hold of a cancelled job at pickup failed — left to the reconcile sweep:`, err)
  }
}

export async function refundJobCredits(
  usageLogId: string | null | undefined,
  jobId: string,
  errorOrMessage: unknown,
  opts?: {
    /** Commit, not refund, when the failure is a content refusal the provider
     *  billed (`billedContentRefusal`). Only for a job whose product is the
     *  LLM call — see {@link LLM_PRODUCT_JOB_TYPES}. Default: refund. */
    chargeBilledRefusal?: boolean
  },
): Promise<void> {
  if (!hasCredits() || !usageLogId) return

  try {
    // A metered LLM hold is settled from what the failure billed — before the
    // post-processing skip and the refusal rule, which would leave it reserved
    // or commit it whole (D10).
    if (await settleFailedMeteredJob(usageLogId, jobId, errorOrMessage)) return
    const { CreditsService: ManagedCredits } = await import("../ee/services/credits.js")
    if (await ManagedCredits.trySettleManagedCredits(usageLogId)) return
    if (isPostProcessingError(errorOrMessage)) {
      const msg = errorOrMessage instanceof Error ? errorOrMessage.message : String(errorOrMessage)
      console.log(`[worker] Post-processing failure after provider delivered — not refunding credits for job ${jobId}: ${msg}`)
      return
    }

    const { CreditsService } = await import("../ee/services/credits.js")
    // A content refusal the provider billed is a paid answer — for a job whose
    // product is that answer (opts.chargeBilledRefusal): the job fails, the
    // hold is committed (billedContentRefusal, lib/llm-errors.ts).
    if (opts?.chargeBilledRefusal === true && billedContentRefusal(errorOrMessage)) {
      await CreditsService.commitCredits(usageLogId)
      console.log(`[worker] Billed content refusal — credits committed, not refunded, for job ${jobId}`)
      return
    }
    await CreditsService.refundCredits(usageLogId)
    console.log(`[worker] Credits refunded for job ${jobId}`)
  } catch (error) {
    console.error(`[worker] Failed to refund credits for job ${jobId}:`, error)
    // Don't fail the job if credit refund fails
  }
}

function isUploadSizeExceeded(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("upload-size-exceeded")
}

/**
 * Oversized provider output fallback. 4K image models can deliver PNGs over
 * the image size cap (e.g. nano-banana-pro 4K at 33-38MB vs the 25MB cap -
 * prod jobs 85359bd4 / 900e6402), which used to throw upload-size-exceeded
 * and zombie the job through reconcile bumps. Recompress to WebP (quality
 * 92, alpha preserved, dimensions unchanged) and upload under the SAME
 * deterministic key - the Content-Type wins over the .png suffix, matching
 * the watermark path's key convention. If even the WebP exceeds the cap
 * (pathological), rethrow upload-size-exceeded so reconcile fails it fast.
 */
async function recompressOversizedImage(
  sourceUrl: string,
  jobId: string,
  jobUserId: string | undefined,
): Promise<string> {
  const response = await safeFetch(sourceUrl, { timeoutMs: 120_000 })
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const webp = await sharp(buffer).webp({ quality: 92 }).toBuffer()
  const cap = getSizeLimit("image")
  if (webp.length > cap) {
    throw new Error(`upload-size-exceeded: recompressed WebP ${webp.length} > cap ${cap}`)
  }
  console.log(
    `[worker] recompressed oversized image for job ${jobId}: ${buffer.length} -> ${webp.length} bytes (webp q92)`,
  )
  return uploadBufferToR2(webp, `images/${jobId}.png`, "image/webp", jobUserId)
}

/**
 * Upload image to R2, optionally applying a watermark first.
 * When watermark is true, downloads the source image, composites the
 * "Nodaro.ai" text overlay, then uploads the watermarked buffer.
 */
export async function uploadImageMaybeWatermark(
  sourceUrl: string,
  jobId: string,
  jobUserId: string | undefined,
  watermark: boolean,
): Promise<string> {
  // POST-PROVIDER by construction: `sourceUrl` is the provider's delivered
  // image. Any failure here (R2 upload, watermark composite, result download)
  // means we already paid the provider → tag as PostProcessingError so the
  // refund guard skips the refund. See lib/post-processing-error.ts.
  return runPostProcessing(async () => {
    if (!watermark) {
      try {
        return await uploadToR2(sourceUrl, jobId, "image", jobUserId)
      } catch (err) {
        if (!isUploadSizeExceeded(err)) throw err
        return await recompressOversizedImage(sourceUrl, jobId, jobUserId)
      }
    }
    // safeFetch: watermarking path fetches sourceUrl and re-uploads the body
    // (with watermark overlay) to R2. An unvalidated fetch here would be an
    // SSRF read-oracle identical to uploadToR2's raw fetch path.
    const response = await safeFetch(sourceUrl, { timeoutMs: 60_000 })
    if (!response.ok) throw new Error(`Failed to download image: ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const watermarked = await applyImageWatermark(buffer)
    return uploadBufferToR2(watermarked, `images/${jobId}.png`, "image/png", jobUserId)
  })
}

/**
 * Upload N image variants to R2 in parallel, optionally watermarking each.
 * Returns R2 URLs in the same order as `sourceUrls` — primary first, extras
 * after. Variants are stored under suffixed keys (`${jobId}`, `${jobId}-v1`,
 * `${jobId}-v2`, …) so each variant has its own permanent URL.
 *
 * If `sourceUrls.length === 1` this is equivalent to a single
 * uploadImageMaybeWatermark call.
 */
export async function uploadImageVariantsMaybeWatermark(
  sourceUrls: readonly string[],
  jobId: string,
  jobUserId: string | undefined,
  watermark: boolean,
): Promise<readonly string[]> {
  return Promise.all(
    sourceUrls.map((url, i) =>
      uploadImageMaybeWatermark(url, variantJobId(jobId, i), jobUserId, watermark),
    ),
  )
}

/**
 * Upload video to R2, optionally applying a watermark first.
 * When watermark is true, downloads to a temp file, runs ffmpeg drawtext,
 * then uploads the watermarked file.
 */
export async function uploadVideoMaybeWatermark(
  sourceUrl: string,
  jobId: string,
  jobUserId: string | undefined,
  watermark: boolean,
): Promise<string> {
  // POST-PROVIDER by construction: `sourceUrl` is the provider's delivered
  // video. Download-of-result / watermark / transcode / R2-upload failures all
  // happen after we were billed → PostProcessingError (refund guard skips).
  return runPostProcessing(async () => {
    const workDir = await createWorkDir("wm")
    try {
      const inputPath = join(workDir, "input.mp4")
      await downloadFile(sourceUrl, inputPath)

      if (watermark) {
        const outputPath = join(workDir, "output.mp4")
        await applyVideoWatermark(inputPath, outputPath)
        return await uploadFileToR2(outputPath, jobId, "video", jobUserId)
      }

      // Even without watermark, transcode if the codec isn't browser-safe
      const uploadPath = await transcodeToBrowserSafe(inputPath, join(workDir, "output.mp4"))
      return await uploadFileToR2(uploadPath, jobId, "video", jobUserId)
    } finally {
      await cleanupWorkDir(workDir)
    }
  })
}

/**
 * Apply video watermark to a local file on disk, then upload to R2.
 * Used when the file is already local (e.g. after ffmpeg merge).
 */
export async function watermarkLocalVideoAndUpload(
  localPath: string,
  jobId: string,
  jobUserId: string | undefined,
  watermark: boolean,
): Promise<string> {
  // POST-PROVIDER: `localPath` is a post-delivery artifact (e.g. the merged
  // provider video). Watermark / transcode / upload failures → skip refund.
  return runPostProcessing(async () => {
    if (watermark) {
      const wmPath = `${localPath}-wm.mp4`
      await applyVideoWatermark(localPath, wmPath)
      return uploadFileToR2(wmPath, jobId, "video", jobUserId)
    }

    // Transcode if the codec isn't browser-safe
    const uploadPath = await transcodeToBrowserSafe(localPath, `${localPath}-norm.mp4`)
    return uploadFileToR2(uploadPath, jobId, "video", jobUserId)
  })
}

/**
 * Generate a thumbnail for a video and upload it to R2.
 * Returns the thumbnail URL, or null if generation fails (non-blocking).
 */
export async function generateAndUploadThumbnail(
  videoUrl: string,
  jobId: string,
  jobUserId: string | undefined,
): Promise<string | null> {
  try {
    const thumbBuffer = await generateThumbnailFromUrl(videoUrl)
    return await uploadBufferToR2(thumbBuffer, `thumbnails/${jobId}.png`, "image/png", jobUserId)
  } catch (err) {
    console.error(`[worker] Thumbnail generation failed for job ${jobId}:`, err)
    return null
  }
}

/**
 * Complete an FFmpeg video job: upload output, cleanup work dir, generate
 * thumbnail, save to DB, and commit credits. Covers the common case where
 * the FFmpeg operation produces a single video file on disk.
 */
export async function completeFfmpegVideoJob(
  outputPath: string,
  ctx: JobContext,
  /** Optional sidecar fields to merge into output_data alongside the
   *  standard videoUrl/thumbnailUrl. Used by handlers that produce
   *  ancillary data (e.g. smart-loop-cut metadata) without rewriting
   *  the upload/cleanup/thumbnail flow. */
  extraOutput?: Record<string, unknown>,
): Promise<void> {
  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "video", ctx.jobUserId)
  await cleanupWorkDir(dirname(outputPath))
  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  // Cheap pre-check to skip the conditional update when we already know the
  // job was cancelled before post-processing. The atomic guard below handles
  // the actual race during the update.
  if (!await shouldSaveJobResult(ctx.jobId)) return

  // Atomic conditional update — skips commit if user cancelled mid-flight.
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl, ...(extraOutput ?? {}) },
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

/**
 * Complete an FFmpeg audio job: upload output, cleanup work dir,
 * save to DB, and commit credits.
 */
export async function completeFfmpegAudioJob(
  outputPath: string,
  ctx: JobContext,
): Promise<void> {
  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "audio", ctx.jobUserId)
  await cleanupWorkDir(dirname(outputPath))

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url },
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

/**
 * The `metadata` of a generated asset row: its thumbnail, and — for a render —
 * the quality it was made at, so My Library and the asset lists label a
 * Preview (`quality: "proxy"`) from the asset itself (A1b, F1).
 */
export function generatedAssetMetadata(output: Record<string, unknown>, jobType: unknown): Record<string, unknown> {
  const thumbnailUrl = (output.thumbnail_url ?? output.thumbnailUrl ?? null) as string | null
  // Only a render's quality is a render quality (another job's output may use
  // the word for something else).
  const { quality } = isRenderNodeType(jobType) ? renderResultStamp(output) : {}
  return {
    ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
    ...(quality ? { quality } : {}),
  }
}

/**
 * Create asset records in the `assets` table for a completed job's media outputs.
 * This makes generated media appear in the /library page.
 * Wrapped in try-catch — never fails the job if asset creation fails.
 */
export async function createAssetFromJob(
  jobId: string,
  userId: string | undefined,
): Promise<void> {
  if (!userId) return

  try {
    const { data: job } = await supabase
      .from("jobs")
      // `relay_job_id` (migration 383) rides along so the asset can carry the
      // DURABLE half of the relay delete rule — see the insert below.
      // `parent_job_id`: a child job (a step a worker-side handler ran for its
      // parent) files nothing — the parent's result is what reaches the Library.
      .select("output_data, status, source, source_detail, relay_job_id, job_type, parent_job_id")
      .eq("id", jobId)
      .single()

    if (!job || job.status !== "completed" || job.parent_job_id) return

    const output = job.output_data as Record<string, unknown> | null
    if (!output) return

    const mediaFields: Array<{ key: string; type: "image" | "video" | "audio"; mime: string }> = [
      { key: "imageUrl", type: "image", mime: "image/png" },
      { key: "videoUrl", type: "video", mime: "video/mp4" },
      { key: "audioUrl", type: "audio", mime: "audio/mpeg" },
    ]

    for (const { key, type, mime } of mediaFields) {
      const url = output[key]
      if (typeof url !== "string" || !url) continue

      // Check if an asset already exists for this job + type
      const { data: existing } = await supabase
        .from("assets")
        .select("id")
        .eq("job_id", jobId)
        .eq("type", type)
        .maybeSingle()

      if (existing) continue

      // Derive R2 key from public URL
      const r2Key = config.R2_PUBLIC_URL
        ? url.replace(config.R2_PUBLIC_URL + "/", "")
        : url

      const filename = url.split("/").pop() ?? `${jobId}.${type === "image" ? "png" : type === "video" ? "mp4" : "mp3"}`

      // Record the real byte size so the cleanup reaper decrements the user's
      // quota by what `trackStorage` added at upload (size_bytes:0 made free-user
      // storage_used_bytes ratchet up forever). HEAD failure → 0 (prior behavior).
      //
      // Only for this job's own output (its key family). An output can repeat a
      // url its input named, and a relayed one names the far end's object: this
      // job stored no bytes there and nothing was charged, so the row records
      // no size (MEDIUM 2, review of 2026-10-15). Migration 528 marks such a row
      // a recorded reference at insert; a size on it would still read, once a
      // job-history delete NULLed its job, like the worker's own output.
      const ownOutput = isOwnedObjectKey(jobId, r2Key)
      const sizeBytes = ownOutput ? await getR2ObjectSize(r2Key) : 0

      // THE DURABLE RELAY MARKER (`assets.relay_job_id`, migration 384).
      //
      // `jobs.relay_job_id` says the JOB was relayed; the key family says
      // whether the BYTES came from the far end. Under the shared-bucket
      // passthrough (lib/storage.ts) uploadToR2 returns the far end's URL
      // unchanged, so `r2Key` above IS the far end's key — outside this job's
      // `<jobId>-` family — and the object belongs to the instance that made
      // it. A relaying instance with its OWN bucket copied the bytes under its
      // own key instead: same relayed job, but ours to delete, so no marker.
      //
      // Written HERE rather than read from the job at delete time because
      // `assets.job_id` is `ON DELETE SET NULL` (001_initial_schema.sql): a
      // job-history delete NULLs it on the surviving library row and the
      // job-row marker becomes unreachable exactly when the permanent delete
      // needs it. NULL on every non-relayed row, in every edition.
      const relayJobId =
        typeof job.relay_job_id === "string" && job.relay_job_id && !ownOutput
          ? job.relay_job_id
          : null

      await supabase.from("assets").insert({
        user_id: userId,
        job_id: jobId,
        type,
        r2_key: r2Key,
        r2_url: url,
        filename,
        mime_type: mime,
        size_bytes: sizeBytes,
        upload_source: "generated",
        relay_job_id: relayJobId,
        // Provenance copied from the originating job (migration 285) so the
        // library can filter by origin without hydrating each item's job.
        // Immutable once written — a job's calling surface never changes.
        source: job.source ?? null,
        source_detail: job.source_detail ?? null,
        metadata: generatedAssetMetadata(output, job.job_type),
      })
    }
  } catch (err) {
    console.error(`[worker] Failed to create asset records for job ${jobId}:`, err)
  }
}

// ============================================================================
// Progress reporting
// ============================================================================
//
// Workers must call `setJobProgress(job, jobId, n)` instead of just
// `job.updateProgress(n)` because the MCP widget polls the `jobs.progress`
// (Postgres) column for its bar — not BullMQ / Redis state. Calling only
// `job.updateProgress(...)` updates Redis, which the widget can't see, so
// the bar appears stuck at 0% (or whatever the last DB write was) for the
// entire run.
//
// Two design properties that callers rely on:
//
//  1. Monotonic-within-a-job: when the ramp writes 30 and a provider's
//     onProgress callback then reports 10 (KIE sometimes lags or briefly
//     reports stale values), we drop the backwards write so the widget bar
//     never visibly regresses. Implemented via an in-memory map + a
//     time/magnitude window so legitimate retry resets still pass through.
//
//  2. Always-moving ramp: `startProgressRamp` runs in two phases — a fast
//     linear climb to `cap` (preserves the existing tuning), then an
//     asymptotic creep toward `softCeiling` (defaults to ~95). Without the
//     phase-2 creep, providers that don't surface incremental progress
//     (Seedance, Wan-Turbo, some Hailuo variants) freeze the bar at `cap`
//     for the entire generation, then snap to the post-call value — what
//     users see as "stuck at 35%".

interface JobProgressEntry { value: number; ts: number }
const lastProgressByJob = new Map<string, JobProgressEntry>()

// Suppress backwards writes only within this short window. Longer than the
// jitter between a ramp tick and a provider onProgress callback, but well
// below typical retry backoffs — so a legitimate retry that calls
// setJobProgress(..., 5) after a previous run reached 50 still goes through.
const REGRESSION_GUARD_MS = 10_000
// And: backwards writes larger than this are always accepted (likely a
// retry/reset, not provider jitter).
const REGRESSION_GUARD_MAX_DROP = 25

/** Test helper — clears the in-memory monotonic-guard map. */
export function _resetJobProgressMap(): void {
  lastProgressByJob.clear()
}

export async function setJobProgress(
  job: { updateProgress: (p: number) => Promise<void> },
  jobId: string,
  progress: number,
): Promise<void> {
  const last = lastProgressByJob.get(jobId)
  const now = Date.now()
  if (last !== undefined && progress < last.value) {
    const drop = last.value - progress
    const elapsed = now - last.ts
    if (drop < REGRESSION_GUARD_MAX_DROP && elapsed < REGRESSION_GUARD_MS) {
      // Tiny, recent backwards write — drop to keep the widget bar smooth.
      return
    }
  }
  // Coalesce repeated identical writes too (cheap and avoids DB churn).
  if (last !== undefined && last.value === progress) return

  lastProgressByJob.set(jobId, { value: progress, ts: now })

  await job.updateProgress(progress)
  // Best-effort DB write — failures shouldn't fail the generation.
  try {
    await supabase.from("jobs").update({ progress }).eq("id", jobId)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[worker] progress DB update failed for ${jobId}:`, err)
  }

  // Free the map once the job has reported terminal progress.
  if (progress >= 100) lastProgressByJob.delete(jobId)
}

export function startProgressRamp(
  job: { updateProgress: (p: number) => Promise<void> },
  jobId: string,
  opts: {
    start: number
    cap: number
    tickMs?: number
    tickStep?: number
    /** Soft ceiling the asymptotic phase 2 approaches. Defaults to a value
     *  slightly above `cap` so the bar keeps creeping forward during long
     *  provider calls instead of pinning at `cap`. */
    softCeiling?: number
    /** Per-tick approach factor for phase 2. 0.04 ≈ ~3pt/min near `cap=35`
     *  with `tickMs=1500`. */
    asymptoteFactor?: number
  },
): { stop: () => void } {
  const tickMs = opts.tickMs ?? 1500
  const tickStep = opts.tickStep ?? 4
  const softCeiling = Math.min(95, Math.max(opts.cap + 5, opts.softCeiling ?? 95))
  const factor = opts.asymptoteFactor ?? 0.04

  let current = opts.start
  let stopped = false
  const handle = setInterval(() => {
    if (stopped) return
    let next = current
    if (current < opts.cap) {
      // Phase 1 — fast linear climb to `cap` (preserves prior tuning).
      next = Math.min(current + tickStep, opts.cap)
    } else if (current < softCeiling - 0.5) {
      // Phase 2 — asymptotic creep toward `softCeiling`. Each tick adds
      // `(softCeiling - current) * factor`, so the bar always moves but
      // visibly slows, never freezing.
      next = Math.min(current + (softCeiling - current) * factor, softCeiling - 0.5)
    } else {
      // Reached the soft ceiling; nothing more to do until the call
      // returns and the handler bumps progress past the ceiling.
      return
    }
    if (next === current) return
    current = next
    void setJobProgress(job, jobId, Math.floor(current))
  }, tickMs)
  return {
    stop() {
      stopped = true
      clearInterval(handle)
    },
  }
}

/**
 * Wrap a long-running provider call so the widget bar moves while the
 * call is in flight. Sets `start` immediately, ramps toward `cap` while
 * `fn` runs (then asymptotically toward `softCeiling`), stops on resolve
 * or throw. Use this for every provider call the widget polls (KIE,
 * Replicate, ElevenLabs) — without it the bar pins at 0% (or whatever
 * was set at credit reservation) for the entire 30s–2min generation,
 * then jumps to the post-call value.
 *
 * Provider-side onProgress callbacks (where supported) still write live
 * values to the same DB column; the monotonic guard in `setJobProgress`
 * keeps the bar from regressing when they race the ramp.
 */
export async function withProgressRamp<T>(
  job: { updateProgress: (p: number) => Promise<void> },
  jobId: string,
  opts: {
    start: number
    cap: number
    tickMs?: number
    tickStep?: number
    softCeiling?: number
    asymptoteFactor?: number
  },
  fn: () => Promise<T>,
): Promise<T> {
  await setJobProgress(job, jobId, opts.start)
  const ramp = startProgressRamp(job, jobId, opts)
  try {
    return await fn()
  } finally {
    ramp.stop()
  }
}

/**
 * Partial-success refund: the i2v generation succeeded but the smart-loop-cut
 * post-process failed. Keep the un-trimmed clip as the result, refund only
 * the loop-trim addon credits (commit actual = reserved - addon).
 *
 * Wraps CreditsService.commitCredits with the partial actual amount and
 * stamps usage_logs.metadata.loop_trim_refunded for traceability.
 */
export async function refundLoopTrimAddon(
  jobId: string,
  usageLogId: string | null | undefined,
  addonCredits: number,
): Promise<void> {
  if (!hasCredits() || !usageLogId || addonCredits <= 0) return

  try {
    const { data: usageLog, error } = await supabase
      .from("usage_logs")
      .select("credits_used, metadata")
      .eq("id", usageLogId)
      .single()

    if (error || !usageLog) {
      console.error(`[worker] refundLoopTrimAddon: usage_log not found for ${usageLogId}`)
      return
    }

    const reserved = (usageLog.credits_used as number | null) ?? 0
    const actual = Math.max(0, reserved - addonCredits)

    const { CreditsService } = await import("../ee/services/credits.js")
    await CreditsService.commitCredits(usageLogId, actual)

    const existingMeta = (usageLog.metadata as Record<string, unknown> | null) ?? {}
    await supabase
      .from("usage_logs")
      .update({ metadata: { ...existingMeta, loop_trim_refunded: true } })
      .eq("id", usageLogId)

    await supabase.from("jobs").update({ credits_actual: actual }).eq("id", jobId)

    console.log(`[worker] loop-trim addon refunded for job ${jobId} (reserved=${reserved}, actual=${actual})`)
  } catch (err) {
    console.error(`[worker] refundLoopTrimAddon failed for job ${jobId}:`, err)
    // Non-fatal: prefer NOT failing the whole job over a refund hiccup.
  }
}

/**
 * Partial-success refund for surround continuation: the paint succeeded but the
 * opt-in refine (upscale/denoise) provider call failed. Keep the un-refined
 * result, refund only the refine addon (commit actual = reserved - addon).
 * Mirrors refundLoopTrimAddon; stamps usage_logs.metadata.surround_refine_refunded.
 */
export async function refundSurroundRefineAddon(
  jobId: string,
  usageLogId: string | null | undefined,
  addonCredits: number,
): Promise<void> {
  if (!hasCredits() || !usageLogId || addonCredits <= 0) return

  try {
    const { data: usageLog, error } = await supabase
      .from("usage_logs")
      .select("credits_used, metadata")
      .eq("id", usageLogId)
      .single()

    if (error || !usageLog) {
      console.error(`[worker] refundSurroundRefineAddon: usage_log not found for ${usageLogId}`)
      return
    }

    const reserved = (usageLog.credits_used as number | null) ?? 0
    const actual = Math.max(0, reserved - addonCredits)

    const { CreditsService } = await import("../ee/services/credits.js")
    await CreditsService.commitCredits(usageLogId, actual)

    const existingMeta = (usageLog.metadata as Record<string, unknown> | null) ?? {}
    await supabase
      .from("usage_logs")
      .update({ metadata: { ...existingMeta, surround_refine_refunded: true } })
      .eq("id", usageLogId)

    await supabase.from("jobs").update({ credits_actual: actual }).eq("id", jobId)

    console.log(`[worker] surround refine addon refunded for job ${jobId} (reserved=${reserved}, actual=${actual})`)
  } catch (err) {
    console.error(`[worker] refundSurroundRefineAddon failed for job ${jobId}:`, err)
    // Non-fatal: prefer NOT failing the whole job over a refund hiccup.
  }
}
