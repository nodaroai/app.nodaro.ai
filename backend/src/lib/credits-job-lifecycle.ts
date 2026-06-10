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
