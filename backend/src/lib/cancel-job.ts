/**
 * Cancel ONE job the caller owns — the single-job cancel route's body, lifted
 * so a parent can cancel a child it spawned through the exact CAS + refund
 * path the route uses. First consumer: `POST /v1/llm/structured/jobs` parents
 * cancelling their `video-analysis` child (`input_data.analysisJobId`).
 *
 * Ownership is verified here, not assumed. The decision table is the route's:
 *   - unknown row → not_found; another owner → forbidden;
 *   - terminal row → invalid_status;
 *   - provider task already out and not in recovery → in_flight (cannot be
 *     killed; the user keeps what they paid for);
 *   - otherwise: best-effort queue removal, CAS flip to `cancelled` on live
 *     statuses only, refund ONLY when we flipped the row (a concurrent
 *     terminal writer owns the credits), and the analysis child id if any.
 */
import { supabase } from "./supabase.js"
import { tryRemoveFromQueue } from "./queue.js"

export type CancelOwnedJobResult =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid_status"; status: string }
  | { kind: "in_flight" }
  | { kind: "lost_race" }
  | { kind: "cancelled"; analysisJobId: string | null }

const CANCELLABLE_STATUSES = ["pending", "queued", "processing"] as const

/**
 * Refund every reserved hold on the job. Best-effort — `refundCredits`
 * short-circuits on rows that are no longer `reserved`, so a concurrent
 * commit/refund is safe. `ee/` is reached through a dynamic import (core may
 * not import it statically; `credits-job-lifecycle.ts` does the same).
 */
async function refundReservedHolds(jobId: string): Promise<void> {
  const { data: usageLogs } = await supabase
    .from("usage_logs")
    .select("id")
    .in("job_id", [jobId])
    .eq("status", "reserved")
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
  const inRecovery = ((job.reconcile_attempts as number | null) ?? 0) > 0
  if (job.provider_task_id && !inRecovery) return { kind: "in_flight" }

  await tryRemoveFromQueue(jobId)

  const { data: flipped, error: updateError } = await supabase
    .from("jobs")
    .update({ status: "cancelled" })
    .eq("id", jobId)
    .eq("user_id", userId)
    .in("status", [...CANCELLABLE_STATUSES])
    .select("id")
  if (updateError) throw updateError
  if (!flipped || flipped.length === 0) return { kind: "lost_race" }

  await refundReservedHolds(jobId)

  const input = (job.input_data ?? null) as Record<string, unknown> | null
  const analysisJobId = typeof input?.analysisJobId === "string" ? input.analysisJobId : null
  return { kind: "cancelled", analysisJobId }
}
