/**
 * The two human decisions a held job can receive (spec §5.5's review rows, §9.1).
 *
 * APPROVE IS A SINGLE UPDATE, not a flip-then-compensate. `markJobCompleted`'s
 * CAS is deliberately NOT widened to admit `pending_review` (D9): widening it
 * would let any stray worker re-pick and complete a held row, and would
 * re-enter the result gate on a payload a human has already judged. Approve
 * therefore CASes `pending_review → completed` itself (through
 * `complete_job_and_settle`'s `pending_review` form when credits are on, so a
 * ready managed charge settles in the same transaction), replaying the caller's
 * own completion columns out of `held_completion_fields`, then commits, then
 * calls THE SAME `runCompletionTail` finalize runs — so the published tail and
 * the reviewed tail cannot drift.
 *
 * Approve also cannot re-enter `finalizeJobWithMedia`: its status guard admits
 * only `pending`/`processing`, and `claim_job_finalize`'s SQL predicate says
 * the same (migration 211:57). Which is also why finalize RELEASES its claim on
 * a hold — otherwise approve would be racing a claimant that is long gone.
 *
 * Reject is the shared rejection primitive in `lib/job-policy-gate.ts` (the TTL
 * sweep uses the same one), with `policy_id = "review"` and the reviewer's own
 * words — which are USER-VISIBLE by contract: the reason becomes
 * `error_hint.reason`, which is on `PUBLIC_JOB_KEYS` and lands verbatim on the
 * owner's canvas.
 */
import { supabase } from "./supabase.js"
import { loadUsageLogId, runCompletionTail } from "./job-finalize.js"
import { commitJobCredits, completeJobAndSettleAtomically, refundLoopTrimAddon } from "../workers/shared.js"
import { hasCredits } from "./config.js"
import { rejectHeldJobRow } from "./job-policy-gate.js"
import { recordJobPolicyDecision } from "./job-policy-audit.js"
import { REVIEW_POLICY_ID, heldCommitArgs, splitHeldCompletionFields } from "./job-policy.js"
import { completedJobColumns } from "./job-status.js"
import { withImageDimensions } from "./job-output-dimensions.js"

/** Who resolved it. Denormalised onto the audit row (the `admin_messages:31-33`
 *  precedent) so a decisions view never has to join `auth.users`. */
export interface Reviewer {
  readonly userId: string
  readonly email?: string | null
}

export type ReviewFailure = "not_found" | "already_resolved" | "finalize_failed"

/** `already_resolved` deliberately covers BOTH "somebody already decided" and
 *  "this job was never held": from the reviewer's seat they are the same fact —
 *  there is nothing here to decide — and the route answers 409 with the row's
 *  current status either way. `not_found` is reserved for a job id that does
 *  not exist at all. */
export type ReviewResult = { ok: true } | { ok: false; reason: ReviewFailure; status?: string }

interface HeldJobRow {
  id: string
  user_id: string | null
  status: string
  workflow_execution_id: string | null
  input_data: Record<string, unknown> | null
  held_output_data: Record<string, unknown> | null
  held_completion_fields: Record<string, unknown> | null
}

export async function approveHeldJob(jobId: string, reviewer: Reviewer, note?: string): Promise<ReviewResult> {
  const { data } = await supabase
    .from("jobs")
    .select("id, user_id, status, workflow_execution_id, input_data, held_output_data, held_completion_fields")
    .eq("id", jobId)
    .single()
  const row = (data as HeldJobRow | null) ?? null
  if (!row) return { ok: false, reason: "not_found" }
  if (row.status !== "pending_review") return { ok: false, reason: "already_resolved", status: row.status }

  const { columns, commit } = splitHeldCompletionFields(row.held_completion_fields)

  // 1. CAS pending_review → completed, replaying the caller's own columns and
  //    clearing the held payload in the SAME statement, so a concurrent second
  //    approve finds nothing to publish twice. With credits on, a ready managed
  //    charge settles in that same transaction (migration 514), so no reader
  //    sees the approved job completed without it.
  //    The held output passes the image-size stamp like every completion
  //    (lib/job-output-dimensions.ts): a hold parked by the funnel already
  //    carries its size and passes through as it is; an older one gains it.
  const completion = {
    status: "completed",
    ...completedJobColumns(),
    output_data: await withImageDimensions(row.held_output_data),
    ...columns,
    held_output_data: null,
    held_completion_fields: null,
    held_objects: null,
  }
  const flip = await flipApprovedJob(jobId, completion)
  if (flip.outcome === "error") {
    // The row is untouched and still held — the route answers 502 and the
    // reviewer can try again, which is the honest outcome.
    console.error(`[job-policy-review] approve CAS failed for job ${jobId}: ${flip.message}`)
    return { ok: false, reason: "finalize_failed" }
  }
  if (flip.outcome === "lost") return { ok: false, reason: "already_resolved" }

  // 2. Money. A ready managed reservation was settled inside the completion
  //    above (or the attempt failed there): the commit below replays it — an
  //    idempotent no-op on the charge that carries the balance-cache and
  //    external-wallet side effects, or the retry. By then the log is no longer
  //    `reserved`, so it is named directly rather than looked up.
  //
  //    Otherwise the METERED true-up is replayed from the held fields (Q2): for
  //    genuinely metered providers the reservation is a CEILING, so committing
  //    it would overcharge the user for a job a human merely looked at.
  //
  //    F7: when the smart-loop-cut failed, the clip was delivered un-trimmed and
  //    the add-on comes OFF the settlement. The worker no longer settles that
  //    itself — settling before the gate spoke made every later refund a no-op —
  //    so approve replays it here; committing instead would charge the full
  //    reservation. The workflow_execution_id guard mirrors finalizeJobWithMedia's:
  //    an orchestrated job reserves the base price only, so the add-on was never
  //    charged and there is nothing to take off.
  //
  //    A metered charge (`meteredBaseCredits`, a Seedance reference run priced
  //    from the delivered clip) takes the commit branch — `heldCommitArgs` is
  //    the same mapping finalize used, so approve settles exactly as the worker
  //    would have.
  if (flip.settleError) {
    console.error(`[job-policy-review] managed settlement inside approval failed for job ${jobId}: ${flip.settleError}`)
  }
  const usageLogId = flip.managedUsageLogId ?? (await loadUsageLogId(jobId))
  const loopTrimRefund = commit.loopTrimAddonRefundCredits ?? 0
  if (!flip.managedUsageLogId && commit.meteredBaseCredits == null && loopTrimRefund > 0 && !row.workflow_execution_id) {
    await refundLoopTrimAddon(jobId, usageLogId, loopTrimRefund)
  } else {
    await commitJobCredits(
      usageLogId,
      jobId,
      ...heldCommitArgs(commit, typeof columns.provider_cost === "number" ? columns.provider_cost : null),
    )
  }

  // 3. The shared tail — gallery asset, sole-cause reopen, reference-video attach.
  const out = (row.held_output_data ?? {}) as Record<string, unknown>
  await runCompletionTail(row, typeof out.videoUrl === "string" ? out.videoUrl : undefined)

  await recordJobPolicyDecision({
    jobId,
    hookPoint: "review",
    policyId: REVIEW_POLICY_ID,
    verdict: "approve",
    reason: `approved by ${reviewer.email ?? reviewer.userId}${note?.trim() ? `: ${note.trim().slice(0, 500)}` : ""}`,
    applied: true,
    userId: row.user_id,
    resolverUserId: reviewer.userId,
    resolverEmail: reviewer.email ?? null,
  })
  return { ok: true }
}

type ApprovalFlip =
  | { outcome: "error"; message: string }
  | { outcome: "lost" }
  | { outcome: "completed"; managedUsageLogId: string | null; settleError: string | null }

/**
 * The approval's completion CAS. With credits on it goes through
 * `complete_job_and_settle` in its `pending_review` form (migration 514), the
 * same function the worker's completion uses; until that form is in the
 * database (staging runs ahead of main's migrations), and on an edition
 * without credits, the plain PostgREST CAS below is exactly what ran before.
 */
async function flipApprovedJob(jobId: string, completion: Record<string, unknown>): Promise<ApprovalFlip> {
  if (hasCredits()) {
    const atomic = await completeJobAndSettleAtomically(jobId, completion, true)
    if (atomic.outcome !== "unavailable") return atomic
  }
  const { data: flipped, error } = await supabase
    .from("jobs")
    .update(completion)
    .eq("id", jobId)
    // The CAS a reject, a TTL expiry or the owner's own cancel wins.
    .eq("status", "pending_review")
    .select("id")
  if (error) return { outcome: "error", message: error.message }
  if (!Array.isArray(flipped) || flipped.length === 0) return { outcome: "lost" }
  return { outcome: "completed", managedUsageLogId: null, settleError: null }
}

export async function rejectHeldJob(jobId: string, reviewer: Reviewer, reason: string): Promise<ReviewResult> {
  const userMessage = reason.trim()
  const res = await rejectHeldJobRow(jobId, {
    // The reviewer's words reach the person who made the request, verbatim.
    userMessage,
    machineReason: `rejected by ${reviewer.email ?? reviewer.userId}: ${userMessage}`,
    policyId: REVIEW_POLICY_ID,
    hookPoint: "review",
    verdict: "reject",
    resolverUserId: reviewer.userId,
    resolverEmail: reviewer.email ?? null,
  })
  if (res.ok) return { ok: true }
  if (res.reason === "not_found") return { ok: false, reason: "not_found" }
  return { ok: false, reason: "already_resolved" }
}

/** The single entry point the admin review routes call. */
export type ReviewAction =
  | { action: "approve"; resolver: Reviewer; note?: string }
  | { action: "reject"; resolver: Reviewer; reason: string }

export async function resolveHeldJob(jobId: string, input: ReviewAction): Promise<ReviewResult> {
  return input.action === "approve"
    ? approveHeldJob(jobId, input.resolver, input.note)
    : rejectHeldJob(jobId, input.resolver, input.reason)
}
