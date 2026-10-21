// @reads-none sums settled side-hold charges through the service-role client; reads no repo file
/**
 * A job's charge AS A STEP OF A RUN: its own charge (`jobs.credits_actual`,
 * its usage log's settled charge, a reservation still open) PLUS what its
 * metered SIDE holds settled (migration 554 — an LLM call the job made beside
 * its own reservation, a UGC clip's per-take frame check).
 *
 * A side hold never writes its job's row (`credits_actual` is the job's own
 * charge only), so every figure built from a job's charge must add it here:
 * the run's node credits (`node-executor` — the execution total, the app-run
 * total and the monetized-app creator's fee base all sum them), the public
 * per-job `credits_charged` (REST, MCP, webhooks), the UGC quote's
 * already-spent lines and the run diagnosis. Before side holds the reading was
 * inside the clip's own charge, so this keeps every one of those figures as it
 * was (R53). `src/__tests__/step-charge-side-holds-guard.test.ts` fails a new
 * reader of a job's charge that does not come through here.
 *
 * Only a CONFIRMED settle counts (the side log `committed`, its
 * `credits_charged`): a hold still open adds nothing until its settle lands.
 * Without credits, or before migration 554 is confirmed, nothing is read.
 */
import { supabase } from "./supabase.js"
import { hasCredits } from "./config.js"
import { llmMeteredSchemaReady } from "./llm-metered-schema-gate.js"
import { settledCharge } from "./usage-amount.js"

/** Ids per `.in()` list (what the gateway reliably accepts). */
const IN_BATCH = 200

/**
 * Σ the settled charges of each job's metered side holds, in ONE read per
 * batch. A job with none is absent. A read that fails is logged and counts
 * nothing (a display / fee-base figure never fails a run).
 */
export async function sideHoldChargesFor(jobIds: readonly (string | null | undefined)[]): Promise<ReadonlyMap<string, number>> {
  const ids = [...new Set(jobIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
  const out = new Map<string, number>()
  if (ids.length === 0 || !hasCredits() || !llmMeteredSchemaReady()) return out
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    try {
      const { data, error } = await supabase
        .from("llm_side_holds" as "assets")
        .select("job_id, usage_logs!inner(status, credits_used, credits_charged)")
        .in("job_id", ids.slice(i, i + IN_BATCH))
        .eq("usage_logs.status", "committed")
      if (error) {
        console.error(`[job-step-charge] could not read the side holds of ${ids.length} job(s): ${error.message}`)
        continue
      }
      type Log = { status?: string | null; credits_used?: number | null; credits_charged?: number | null }
      for (const row of (data ?? []) as unknown as Array<{ job_id?: string | null; usage_logs?: Log | Log[] | null }>) {
        const log = Array.isArray(row.usage_logs) ? row.usage_logs[0] : row.usage_logs
        if (!row.job_id || !log || log.status !== "committed") continue
        const charged = settledCharge(log)
        if (typeof charged === "number" && charged > 0) out.set(row.job_id, (out.get(row.job_id) ?? 0) + charged)
      }
    } catch (err) {
      console.error(`[job-step-charge] could not read side holds:`, err)
    }
  }
  return out
}

/**
 * A job's own charge plus its settled side holds. `null` / `undefined` (no
 * charge known yet) stays as it is when the job has no side charge.
 */
export function withSideCharge<T extends number | null | undefined>(own: T, jobId: string | null | undefined, side: ReadonlyMap<string, number>): T | number {
  const extra = jobId ? side.get(jobId) ?? 0 : 0
  if (extra === 0) return own
  return (own ?? 0) + extra
}

/** {@link withSideCharge} for one run step's result (`ExecuteNodeResult`-shaped). */
export async function withSideHoldCharge<R extends { jobId?: string; creditsUsed?: number }>(result: R): Promise<R> {
  if (!result.jobId) return result
  const side = await sideHoldChargesFor([result.jobId])
  const creditsUsed = withSideCharge(result.creditsUsed, result.jobId, side)
  return creditsUsed === result.creditsUsed ? result : { ...result, creditsUsed }
}
