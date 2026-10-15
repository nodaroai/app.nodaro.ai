/**
 * Commit / refund helpers for the reserve→commit/refund credit lifecycle
 * keyed by `jobs.id`.
 *
 * `CreditsService.commitCredits` / `refundCredits` themselves are idempotent
 * (CAS on `usage_logs.status='reserved'`), so duplicate calls are safe.
 *
 * `await import` keeps `credits.ts` (under `ee/`) out of the static import
 * graph of core code that may statically import this module.
 */

import { supabase } from "./supabase.js"

async function fetchReservedLogIds(jobId: string): Promise<string[]> {
  const { data } = await supabase
    .from("usage_logs")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "reserved")
  return data?.map((log: { id: string }) => log.id) ?? []
}

/** Returns the number of reserved logs a refund was attempted for — 0 means
 *  there was nothing left in `reserved` (already committed or refunded), so
 *  callers reporting refund outcomes (e.g. the exhaustion anomaly note) can
 *  be honest about whether the user actually got credits back. */
export async function refundReservedCreditsForJob(jobId: string): Promise<number> {
  const logIds = await fetchReservedLogIds(jobId)
  if (logIds.length === 0) return 0
  const { CreditsService } = await import("../ee/billing/credits.js")
  for (const id of logIds) {
    await CreditsService.refundCredits(id).catch((err) => {
      console.warn(`[credits-lifecycle] refund failed log=${id}: ${(err as Error).message}`)
    })
  }
  return logIds.length
}

/** The ids of the job's logs still `reserved`, or null when the read failed. */
async function readReservedLogIds(jobId: string): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("usage_logs")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "reserved")
  if (error) return null
  return (data ?? []).map((log: { id: string }) => log.id)
}

const CONFIRMED_REFUND_ATTEMPTS = 2

/**
 * Refund every hold the job has, and say whether that is CONFIRMED: true only
 * when a read after the refund finds nothing of the job's still `reserved`.
 *
 * `refundReservedCreditsForJob` cannot answer this: it swallows a failed
 * refund, and a failed read looks like "nothing held". A caller about to
 * DELETE the job must know, because `usage_logs.job_id` is ON DELETE SET NULL:
 * a hold whose refund failed loses its job and no sweep can find it again.
 * Never throws.
 */
export async function refundJobHoldsConfirmed(jobId: string): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < CONFIRMED_REFUND_ATTEMPTS; attempt++) {
      const held = await readReservedLogIds(jobId)
      if (held === null) return false
      if (held.length === 0) return true
      const { CreditsService } = await import("../ee/billing/credits.js")
      for (const id of held) {
        await CreditsService.refundCredits(id).catch((err) => {
          console.warn(`[credits-lifecycle] refund failed log=${id}: ${(err as Error).message}`)
        })
      }
    }
    const left = await readReservedLogIds(jobId)
    return left !== null && left.length === 0
  } catch (err) {
    console.warn(`[credits-lifecycle] refund of job=${jobId} could not be confirmed: ${(err as Error).message}`)
    return false
  }
}

/** One live credit hold of a job: a usage log `reserved` or `committed`. */
export interface JobHold {
  readonly id: string
  readonly credits: number | null
}

/**
 * Of `jobIds`, the jobs that hold credits — usage logs still `reserved`, or
 * already `committed` — each with its holds OLDEST FIRST (by creation, then
 * id, so every reader orders them the same way). A job holds one hold; when
 * a race left two, the oldest is the job's and the rest are to be refunded.
 * Null when the read failed: the caller cannot tell a paid job from an unpaid
 * one, so it must not act as if nothing were held (and charge it again).
 */
export async function jobCreditHolds(jobIds: readonly string[]): Promise<Map<string, JobHold[]> | null> {
  if (jobIds.length === 0) return new Map()
  try {
    const { data, error } = await supabase
      .from("usage_logs")
      .select("id, job_id, credits_used")
      .in("job_id", [...jobIds])
      .in("status", ["reserved", "committed"])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
    if (error) return null
    const holds = new Map<string, JobHold[]>()
    for (const log of (data ?? []) as Array<{ id: string; job_id: string | null; credits_used?: number | null }>) {
      if (!log.job_id) continue
      const hold = { id: log.id, credits: typeof log.credits_used === "number" ? log.credits_used : null }
      holds.set(log.job_id, [...(holds.get(log.job_id) ?? []), hold])
    }
    return holds
  } catch {
    return null
  }
}

/**
 * Refund ONE usage log and confirm it: true only when a read after the refund
 * finds it no longer `reserved`. For a job holding two holds after a race,
 * where only the extra one is to go. Never throws.
 */
export async function refundUsageLogConfirmed(usageLogId: string): Promise<boolean> {
  try {
    const { CreditsService } = await import("../ee/billing/credits.js")
    for (let attempt = 0; attempt < CONFIRMED_REFUND_ATTEMPTS; attempt++) {
      await CreditsService.refundCredits(usageLogId).catch((err) => {
        console.warn(`[credits-lifecycle] refund failed log=${usageLogId}: ${(err as Error).message}`)
      })
      const { data, error } = await supabase.from("usage_logs").select("status").eq("id", usageLogId).maybeSingle()
      if (!error && (data as { status?: string } | null)?.status !== "reserved") return true
    }
    return false
  } catch (err) {
    console.warn(`[credits-lifecycle] refund of log=${usageLogId} could not be confirmed: ${(err as Error).message}`)
    return false
  }
}

export async function commitReservedCreditsForJob(jobId: string): Promise<void> {
  const logIds = await fetchReservedLogIds(jobId)
  if (logIds.length === 0) return
  const { CreditsService } = await import("../ee/billing/credits.js")
  for (const id of logIds) {
    await CreditsService.commitCredits(id).catch((err) => {
      console.warn(`[credits-lifecycle] commit failed log=${id}: ${(err as Error).message}`)
    })
  }
}
