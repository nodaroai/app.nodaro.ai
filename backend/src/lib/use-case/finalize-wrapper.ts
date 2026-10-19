/**
 * Finalise a use-case wrapper job from its inner execution's terminal state
 * (decided 2026-10-13). Idempotent and safe to call from anywhere, any number
 * of times, concurrently: it does nothing until the execution is terminal, and
 * the wrapper flips at most once (CAS from pending/processing through the
 * job-policy funnels), so the fee is committed or refunded exactly once — only
 * the caller that won the flip moves money.
 *
 * completed with the result its kind promises → markJobCompleted (output_data, credits_actual =
 *   inner total + fee) → commit the fee hold.
 * anything else terminal  → markJobFailed, keeping the completed outputs on
 *   output_data → refund the fee hold. Inner jobs settle themselves.
 *
 * Callers: the orchestrator's `finally` (every return of an inline run) and
 * the reconcile sweep (a worker that died, or a run ended outside the worker).
 * A cancel of the wrapper itself flips it first and refunds there; the
 * finaliser then finds it final and moves nothing.
 */
import type { StoredInlineGraph } from "@nodaro/render-rules"
import { supabase } from "../supabase.js"
import { loadExecutionForWrapper } from "../execution-inline-graph.js"
import { markJobFailed } from "../job-failure.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "../job-status.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { usecaseNoResultMessage, usecaseWrapperHasResult, usecaseWrapperKeepsPartial, usecaseWrapperOutput, type UseCaseWrapperOutput } from "./wrapper-output.js"

export type FinalizeOutcome = "not_terminal" | "not_use_case" | "already_final" | "completed" | "failed"

const TERMINAL: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "timed_out", "discarded"])
/**
 * The wrapper states a finaliser may flip: live, never parked (a result held
 * for review is a reviewer's). This admits `queued`, which markJobCompleted's
 * own CAS (pending|processing) does not — unreachable for a wrapper, which is
 * inserted `processing` and never queued; derived from job-status.ts because
 * the status-vocabulary guard forbids a hand-written list.
 */
const OPEN: readonly string[] = IN_FLIGHT_JOB_STATUSES.filter((s) => !isParkedJobStatus(s))

/**
 * workers/shared.ts loads the media stack, so it is reached lazily. The
 * promise is memoised because vitest resolves two CONCURRENT dynamic imports
 * of a mocked module inconsistently (one gets the real module) — which the
 * double-finalize race test does; it also gives concurrent finalisers one
 * load. A failed import is not cached.
 */
let sharedModule: Promise<typeof import("../../workers/shared.js")> | null = null
const loadShared = () =>
  (sharedModule ??= import("../../workers/shared.js").catch((err: unknown) => {
    sharedModule = null
    throw err
  }))

/** The step and its error in the user's words ("Apply Cut: boom"), never an inner node id. */
function failureMessage(
  status: string,
  errorMessage: string | null,
  output: UseCaseWrapperOutput,
  graph: StoredInlineGraph | null,
): string {
  // A completed run that delivered nothing, in its kind's own words ("no chapters").
  if (status === "completed") return usecaseNoResultMessage(graph)
  const detail = (errorMessage ?? "").replace(/^Node execution failed:\s*/, "").replace(/^uc-[a-z-]+:\s*/, "")
  if (output.failedStep) return `${output.failedStep}: ${detail || "failed"}`
  if (detail) return detail
  return status === "cancelled" ? "The run was cancelled" : `The run ended: ${status}`
}

/**
 * `expectedWrapperJobId`: the wrapper the caller is settling (the sweep's
 * scanned row, the worker's job). A run that reports to a different wrapper is
 * not this one's — it settles nothing, so a wrong pointer can never finalise
 * another wrapper while the caller's stays open.
 */
export async function finalizeUseCaseWrapper(executionId: string, expectedWrapperJobId?: string): Promise<FinalizeOutcome> {
  const exec = await loadExecutionForWrapper(executionId)
  // "Is this a use-case run?" is its wrapper pointer — never the snapshot,
  // which an expunge erases to {}.
  if (!exec || !exec.wrapperJobId) return "not_use_case"
  if (expectedWrapperJobId !== undefined && exec.wrapperJobId !== expectedWrapperJobId) return "not_use_case"
  if (!TERMINAL.has(exec.status)) return "not_terminal"
  const { data: wrapper, error } = await supabase
    .from("jobs")
    .select("id, status, user_id, input_data")
    .eq("id", exec.wrapperJobId)
    .maybeSingle()
  // A read error must never look like a missing wrapper (the sweep fails those).
  if (error) throw new Error(`use-case wrapper ${exec.wrapperJobId} unreadable: ${error.message}`)
  if (!wrapper || wrapper.user_id !== exec.userId) return "not_use_case"
  if (!OPEN.includes(wrapper.status as string)) {
    // A wrapper some cancel writer flipped without settling it must not keep
    // its fee reserved: the refund is idempotent (only a `reserved` hold moves,
    // CAS'd in the credits RPC), so a cancel that already refunded makes this
    // a no-op. A completed / failed wrapper was settled by whoever flipped it.
    if (wrapper.status === "cancelled") await refundReservedCreditsForJob(exec.wrapperJobId)
    return "already_final"
  }

  const output: UseCaseWrapperOutput = exec.inlineGraph
    ? usecaseWrapperOutput(exec.inlineGraph, exec.nodeStates, exec.id)
    : { quality: "final", _executionId: exec.id }
  const input = (wrapper.input_data ?? {}) as Record<string, unknown>
  const fee = typeof input._feeCredits === "number" ? input._feeCredits : 0
  // A wrapper whose start stamp never landed is stamped now, as it settles:
  // what names a continuation's generations and what a cancel stops read it.
  const backfill = typeof input._executionId === "string" ? {} : { input_data: { ...input, _executionId: exec.id } }

  // A run that failed after delivering part of a list (a Trailer whose other
  // formats rendered) completes with what it delivered, its fee kept.
  const delivered = exec.status === "completed" || (exec.status === "failed" && usecaseWrapperKeepsPartial(exec.inlineGraph, output))
  if (delivered && usecaseWrapperHasResult(exec.inlineGraph, output)) {
    const { markJobCompleted } = await loadShared()
    // `failedStep` names the step a FAILED run stopped at: a completed run
    // that dropped a format names it on `failedFormats` instead, never as a
    // failed step.
    const { failedNodeId: _failedNodeId, failedStep: _failedStep, ...completed } = output
    const flipped = await markJobCompleted(exec.wrapperJobId, { output_data: completed, credits_actual: exec.totalCreditsUsed + fee, ...backfill })
    if (!flipped) return "already_final"
    await commitReservedCreditsForJob(exec.wrapperJobId)
    return "completed"
  }

  const flipped = await markJobFailed(exec.wrapperJobId, {
    error_message: failureMessage(exec.status, exec.errorMessage, output, exec.inlineGraph),
    extra: { output_data: output, ...backfill },
    from: [...OPEN],
  })
  if (!flipped) return "already_final"
  await refundReservedCreditsForJob(exec.wrapperJobId)
  return "failed"
}
