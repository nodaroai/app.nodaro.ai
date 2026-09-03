/**
 * THE way anything marks a `jobs` row failed.
 *
 * Before this file there were five shapes of failure write spread over 16
 * sites — some CAS-guarded, some not, some slicing `error_message` to 500 and
 * some not, one writing no message at all. Consolidating them is what makes
 * `pending_review` safe: a status the sweeps must never fail is expressible in
 * ONE place instead of being re-derived correctly sixteen times.
 *
 * WHY IT LIVES IN `lib/` AND NOT `workers/shared.ts` (spec D10): shared.ts
 * imports `sharp`, `youtube-dl-exec` and `@remotion/*` at its top. Putting the
 * consolidated writer there would drag all three into the eight reconcile
 * modules (which today import only `./supabase.js` + `../credits-job-lifecycle.js`)
 * and into every one of their test suites.
 *
 * IT DELIBERATELY DOES NOT REFUND (D10). The refund decision is caller-specific
 * and load-bearing: `video-worker` passes the error OBJECT so `refundJobCredits`
 * can read the `PostProcessingError` signal ("provider delivered ⇒ never
 * refund", workers/shared.ts:448-452), and `video-director-worker` refunds
 * BEFORE the status write on purpose (a refund throw must leave the row
 * `processing` for `sweepStuckOrchestratorJobs`). Folding refunds in here would
 * erase both. What this function gives every caller instead is the BOOLEAN:
 * refund only when WE flipped the row.
 */
import { supabase } from "./supabase.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "./job-status.js"
import type { ErrorHint } from "./safety-block.js"

/**
 * The live statuses a failure may flip FROM — every in-flight status EXCEPT
 * the parked one (spec D11).
 *
 * `pending_review` is absent by construction, not by a hand-written list: a job
 * a human is reviewing has finished running, its credits are deliberately still
 * reserved, and no sweep, worker or webhook may take it. The ONE legitimate
 * failure writer of a parked row is the review REJECT path, which says so out
 * loud by passing `from: ["pending_review"]`.
 *
 * Note the strict widening this consolidation ships (Q14): every migrated
 * writer CASed on `["pending","processing"]`, so a `"queued"` row (the MCP
 * pipeline/app paths write it) could not be failed by the reconcile sweep at
 * all. It now can, and this matches `CANCELLABLE_STATUSES`.
 */
export const FAILABLE_STATUSES: readonly string[] = IN_FLIGHT_JOB_STATUSES.filter((s) => !isParkedJobStatus(s))

export interface MarkJobFailedInput {
  /** User-facing. Sliced to 500 HERE so no caller has to remember to. */
  readonly error_message: string
  /** Operator-facing, already redacted by the CALLER (`providerDetailOf` /
   *  `redactProviderDetail`). Written whenever the key is present — `null` is
   *  the honest answer for a writer with no provider text, and omitting the key
   *  is how a caller says "leave whatever is there". */
  readonly error_detail?: string | null
  /** Migration 376's user-safe machine-readable hint (a discriminated union
   *  since the job-policy seam: safety-block | policy-block). */
  readonly error_hint?: ErrorHint | null
  /** Extra columns to keep on the failed row. The RESULT gate passes the
   *  caller's completion fields MINUS `output_data`, so `provider`,
   *  `provider_cost`, `display_cost` and `provider_task_id` survive a policy
   *  block — the provider spend is real and the admin needs to see it. */
  readonly extra?: Record<string, unknown>
  /** Reconcile writers' bookkeeping. */
  readonly reconcile_attempts?: number
  readonly reconcile_last_error?: string
  /** Statuses this failure may flip FROM. Defaults to FAILABLE_STATUSES.
   *  `["pending_review"]` is the review reject path and nothing else. */
  readonly from?: readonly string[]
}

/**
 * What a CAS actually said. Three answers, not two: the UPDATE flipped a row,
 * it matched none, or it never ran.
 *
 * The boolean below collapses the last two because for a REFUND they are the
 * same answer ("we did not flip it, so do not move money"). For a DIAGNOSIS
 * they are opposites: only `missed` means a concurrent terminal writer won.
 * The result gate needs the difference — reporting a statement timeout as a
 * lost race sends an operator chasing a race that never happened, and records
 * `applied=false` for a verdict that has simply not run yet.
 */
export type JobFailureOutcome = "flipped" | "missed" | "error"

/**
 * One CAS UPDATE. Returns which of the three things happened.
 *
 * Never throws: a failure writer that throws turns a handled provider error
 * into an unhandled one, and every call site here is already inside a failure
 * path.
 */
export async function markJobFailedDetailed(jobId: string, input: MarkJobFailedInput): Promise<JobFailureOutcome> {
  const { data, error } = await supabase
    .from("jobs")
    .update({
      status: "failed",
      error_message: input.error_message.slice(0, 500),
      ...(input.error_detail !== undefined ? { error_detail: input.error_detail } : {}),
      ...(input.error_hint ? { error_hint: input.error_hint } : {}),
      ...(input.reconcile_attempts !== undefined ? { reconcile_attempts: input.reconcile_attempts } : {}),
      ...(input.reconcile_last_error ? { reconcile_last_error: input.reconcile_last_error } : {}),
      completed_at: new Date().toISOString(),
      ...(input.extra ?? {}),
    })
    .eq("id", jobId)
    .in("status", [...(input.from ?? FAILABLE_STATUSES)])
    .select("id")

  if (error) {
    console.error(`[job-failure] failed to mark job ${jobId} failed:`, error.message)
    return "error"
  }
  return Array.isArray(data) && data.length > 0 ? "flipped" : "missed"
}

/**
 * The BOOLEAN every failure writer reads as its refund gate: refund only when
 * WE flipped the row. A thin wrapper on purpose — one CAS, one shape, and the
 * sixteen migrated call sites keep the answer they were written against.
 */
export async function markJobFailed(jobId: string, input: MarkJobFailedInput): Promise<boolean> {
  return (await markJobFailedDetailed(jobId, input)) === "flipped"
}
