/**
 * A job's two billing answers, read off its usage log: `credit_status` (is the
 * hold still open, committed or refunded?) and `credits_charged` (what the
 * payer ended up paying, through `settledCharge` — the one reader of a usage
 * log's charge).
 *
 * `jobs.credits` is the hold and never changes meaning; a run that settles
 * below it (a ceiling, a measured length) shows the difference only here.
 * `jobs.credits_actual` stays admin-only — the public figure comes from the
 * usage log, the same row the transaction list reads, so both surfaces agree.
 *
 * Used by the REST job routes and the MCP job tools.
 */
import { supabase } from "./supabase.js"
import { settledCharge } from "./usage-amount.js"

export type CreditStatus = "reserved" | "committed" | "refunded"

export interface JobCreditFigures {
  status: CreditStatus
  /** Null while the hold is open; 0 when it was refunded. */
  charged: number | null
}

/**
 * ONE query for every id in the response (never one per job): callers pass
 * every `usage_log_id` they have, including duplicates/nulls, and get back a
 * `Map` keyed by usage_log_id. A job with no usage log (nothing reserved, e.g.
 * a free run) is simply absent from the map.
 */
export async function creditStatusMapFor(
  usageLogIds: readonly (string | null | undefined)[],
): Promise<Map<string, JobCreditFigures>> {
  const ids = Array.from(new Set(usageLogIds.filter((id): id is string => Boolean(id))))
  const map = new Map<string, JobCreditFigures>()
  if (ids.length === 0) return map

  const { data } = await supabase
    .from("usage_logs")
    .select("id, status, credits_used, credits_charged")
    .in("id", ids)
  for (const row of (data ?? []) as {
    id: string
    status?: string | null
    credits_used?: number | null
    credits_charged?: number | null
  }[]) {
    if (row.status === "reserved" || row.status === "committed" || row.status === "refunded") {
      map.set(row.id, { status: row.status, charged: settledCharge(row) })
    }
  }
  return map
}

/** `null` for both "no usage log" and "usage log row missing/unrecognized
 *  status" — `null` is the documented "not available" spelling. */
export function creditStatusOf(
  usageLogId: string | null | undefined,
  map: Map<string, JobCreditFigures>,
): CreditStatus | null {
  return usageLogId ? map.get(usageLogId)?.status ?? null : null
}

/** The settled charge of a job; `null` until it settles or when it has no usage log. */
export function creditsChargedOf(
  usageLogId: string | null | undefined,
  map: Map<string, JobCreditFigures>,
): number | null {
  return usageLogId ? map.get(usageLogId)?.charged ?? null : null
}
