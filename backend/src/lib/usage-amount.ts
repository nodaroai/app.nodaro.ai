/**
 * THE one reader of what a usage log costs its payer.
 *
 * A reservation (`usage_logs.credits_used`) is a HOLD taken before the work
 * runs, and it never changes afterwards. Settlement decides the CHARGE: it
 * commits all or part of the hold (`credits_charged`; the rest goes back to
 * the balance) or refunds it whole. Any surface that shows a person what they
 * paid reads it here, never off `credits_used` — that column still reads the
 * whole hold after part of it went back (a re-render ceiling, a measured
 * duration, a metered run…).
 *
 * The admin usage RPC sums the same rule in SQL: `public.usage_log_charge`
 * (migration 511). Both are pinned to one case table,
 * `supabase/tests/fixtures/usage-charge-cases.json`.
 */
export interface UsageAmountRow {
  status?: string | null
  credits_used?: number | null
  credits_charged?: number | null
}

/**
 * What the payer is out for this log right now: the charge once settled, the
 * hold while it is still open, 0 once refunded. Null stays unknown.
 */
export function usageAmount(row: UsageAmountRow): number | null {
  if (row.status === "refunded") return 0
  if (row.status === "committed") return row.credits_charged ?? row.credits_used ?? null
  return row.credits_used ?? null
}

/**
 * The SETTLED charge: what the payer ended up paying. Null while the hold is
 * still open (a running job has not been charged yet), 0 for a refund. This is
 * the figure every public `credits_charged` field carries.
 */
export function settledCharge(row: UsageAmountRow): number | null {
  if (row.status !== "committed" && row.status !== "refunded") return null
  return usageAmount(row)
}
