/**
 * Cancel ONE job the caller owns — the single-job cancel route's body, lifted
 * so a parent can cancel a child it spawned through the exact CAS + refund
 * path the route uses. First consumer: `POST /v1/llm/structured/jobs` parents
 * cancelling their `video-analysis` child (`input_data.analysisJobId`).
 *
 * Ownership is verified here, not assumed. The decision table is the route's:
 *   - unknown row → not_found; another owner → forbidden;
 *   - terminal row → invalid_status;
 *   - row parked in review → withdrawn (refund + delete the withheld object +
 *     record the decision), never in_flight;
 *   - provider task already out and not in recovery → in_flight (cannot be
 *     killed; the user keeps what they paid for);
 *   - otherwise: best-effort queue removal, CAS flip to `cancelled` on live
 *     statuses only (never the parked one — a row parked while we emptied the
 *     queue re-enters the withdrawal instead of being flipped), refund ONLY
 *     when we flipped the row (a concurrent terminal writer owns the credits),
 *     and the analysis child id if any.
 */
import { supabase } from "./supabase.js"
import { tryRemoveFromQueue } from "./queue.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "./job-status.js"

export type CancelOwnedJobResult =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid_status"; status: string }
  | { kind: "in_flight" }
  | { kind: "lost_race" }
  | { kind: "cancelled"; analysisJobId: string | null }

/**
 * Every in-flight status, `pending_review` included (spec D17).
 *
 * Derived, never hand-rolled: a re-declared list silently omits `pending_review`
 * and the omission is invisible — the API answers 400 "cannot be cancelled"
 * while `node-executor.ts`'s DAG cancel flips the same row anyway. A
 * reservation must not be strandable behind a reviewer's SLA.
 */
const CANCELLABLE_STATUSES = IN_FLIGHT_JOB_STATUSES

/**
 * The statuses the GENERIC CAS below may flip straight to `cancelled` — every
 * in-flight status EXCEPT the parked one. A different question from
 * `CANCELLABLE_STATUSES` above, and the two must not share an answer.
 *
 * A parked row is cancellable, but only through `withdrawHeldJob`, which also
 * deletes the withheld objects, clears the `held_*` columns and records the
 * `withdrawn` decision. The read at :81 decides which path to take, and the
 * work in between — two BullMQ `getJobs` sweeps plus a dynamic import — is long
 * enough for the result gate to park the row underneath us. Admitting
 * `pending_review` here would let the generic UPDATE win that race and cancel
 * the row with none of the three.
 */
const FLIPPABLE_STATUSES: readonly string[] = IN_FLIGHT_JOB_STATUSES.filter((s) => !isParkedJobStatus(s))

/**
 * Refund every reserved credit hold for the given job IDs — the ONE refund
 * path both cancel flows use (`cancelOwnedJob` passes a single id, the
 * `cancel-all` route passes the whole batch it flipped in one query).
 *
 * Without this, cancelling a job leaves its `usage_logs` row stuck at
 * `status='reserved'` forever — the user's balance was decremented when the
 * job was reserved but never restored. Net effect: silent credit theft on
 * every cancellation.
 *
 * Best-effort — `CreditsService.refundCredits` already short-circuits on rows
 * that aren't `status='reserved'` (see PR #1502), so it's safe if the worker
 * happens to commit/refund the same row concurrently. `ee/` is reached through
 * a dynamic import (core may not import it statically; the route that used to
 * own this copy is allowlisted, `lib/` is not — `credits-job-lifecycle.ts`
 * does the same).
 */
export async function refundReservedHolds(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return
  const { data: usageLogs, error } = await supabase
    .from("usage_logs")
    .select("id")
    .in("job_id", jobIds)
    .eq("status", "reserved")
  if (error) {
    // Silently refunding nothing would leave the hold `reserved` forever.
    console.error(`[cancel-job] Failed to read reserved holds for ${jobIds.join(",")}:`, error)
    return
  }
  if (!usageLogs || usageLogs.length === 0) return
  const { CreditsService } = await import("../ee/billing/credits.js")
  await Promise.all(
    usageLogs.map((row: { id: string }) =>
      CreditsService.refundCredits(row.id).catch((err: unknown) =>
        console.error(`[cancel-job] Failed to refund usage_log ${row.id}:`, err),
      ),
    ),
  )
}

export async function cancelOwnedJob(jobId: string, userId: string): Promise<CancelOwnedJobResult> {
  const { data: job, error } = await supabase
    .from("jobs") // tenant-scope-ignore: ownership verified post-fetch (user_id mismatch → forbidden)
    .select("id, status, user_id, input_data, provider_task_id, reconcile_attempts")
    .eq("id", jobId)
    .single()
  if (error || !job) return { kind: "not_found" }
  if (job.user_id !== userId) return { kind: "forbidden" }
  if (!(CANCELLABLE_STATUSES as readonly string[]).includes(job.status)) {
    return { kind: "invalid_status", status: job.status as string }
  }
  const input = (job.input_data ?? null) as Record<string, unknown> | null
  const analysisJobId = typeof input?.analysisJobId === "string" ? input.analysisJobId : null

  // A HELD job is cancelled by a different mechanism, and this branch must come
  // BEFORE the `provider_task_id` check below: a held job normally HAS a
  // provider task (the provider already delivered — it is the PLATFORM holding
  // the result), so `in_flight` would refuse it forever. There is also no queue
  // entry left to remove, and the withdrawal has three things the generic path
  // cannot do: refund the reservation, delete the withheld object, and record
  // the `withdrawn` decision against the review audit.
  //
  // Reached through a dynamic import so this module's static graph stays
  // supabase + queue (job-policy-gate pulls storage and the credit lifecycle
  // behind it) — the same reason `refundReservedHolds` loads `ee/` lazily.
  if (isParkedJobStatus(job.status as string)) {
    const { withdrawHeldJob } = await import("./job-policy-gate.js")
    const withdrawal = await withdrawHeldJob(jobId)
    if (!withdrawal.ok) {
      // `not_held` means a reviewer, the TTL sweep or another tab resolved it
      // between our read and the CAS — the same shape as any lost race.
      return withdrawal.reason === "not_found" ? { kind: "not_found" } : { kind: "lost_race" }
    }
    return { kind: "cancelled", analysisJobId }
  }

  const inRecovery = ((job.reconcile_attempts as number | null) ?? 0) > 0
  if (job.provider_task_id && !inRecovery) return { kind: "in_flight" }

  await tryRemoveFromQueue(jobId)

  const { data: flipped, error: updateError } = await supabase
    .from("jobs")
    .update({ status: "cancelled" })
    .eq("id", jobId)
    .eq("user_id", userId)
    .in("status", [...FLIPPABLE_STATUSES])
    .select("id")
  if (updateError) throw updateError
  if (!flipped || flipped.length === 0) {
    // Zero rows is now two different facts. Re-read once: a row that got PARKED
    // while we were emptying the queue is still perfectly cancellable — it just
    // has to go through the withdrawal. Answering `lost_race` for it would fail
    // a cancel the user is entitled to and leave the reservation sitting behind
    // the reviewer's SLA, which is the stranding D17 exists to prevent.
    const { data: after } = await supabase
      .from("jobs") // tenant-scope-ignore: same row, ownership verified above
      .select("status")
      .eq("id", jobId)
      .single()
    const status = (after as { status?: string } | null)?.status
    if (status && isParkedJobStatus(status)) {
      const { withdrawHeldJob } = await import("./job-policy-gate.js")
      const withdrawal = await withdrawHeldJob(jobId)
      if (withdrawal.ok) return { kind: "cancelled", analysisJobId }
      return withdrawal.reason === "not_found" ? { kind: "not_found" } : { kind: "lost_race" }
    }
    return { kind: "lost_race" }
  }

  await refundReservedHolds([jobId])

  return { kind: "cancelled", analysisJobId }
}
