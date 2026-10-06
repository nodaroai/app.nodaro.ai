import type { NodeSkipReason } from "./node-execution-state.js"

/**
 * How a COMPLETED run ended, derived on read from its node states — never a
 * column: the orchestrator, the boot sweep and the reconcile cron all write
 * `completed`, and a column only one of them set would read "succeeded" for
 * the runs the others closed. Every surface that shows a run (the editor's
 * run bar and Executions tab, a published app, Present, the REST / SDK
 * execution shapes, MCP `get_app_run` / `diagnose_run`) asks this one rule.
 */
export type ExecutionOutcome = "succeeded" | "nothing_new"

interface SkipStateLike {
  readonly status?: unknown
  readonly skipReason?: unknown
}

const EMPTY_INPUT: NodeSkipReason = "empty_input"

/** The nodes a run skipped for want of input: nothing upstream produced any text in this run. */
export function countEmptyInputSkips(nodeStates: Readonly<Record<string, SkipStateLike>> | null | undefined): number {
  let count = 0
  for (const state of Object.values(nodeStates ?? {})) {
    if (state && state.status === "skipped" && state.skipReason === EMPTY_INPUT) count += 1
  }
  return count
}

/**
 * `nothing_new` when a completed run skipped at least one node for want of
 * input (a feed that found no new posts, a writer with nothing to write);
 * `succeeded` for any other completed run; undefined for a run that has not
 * completed — a failed or cancelled run has no outcome, it has a status.
 */
export function executionOutcome(
  status: unknown,
  nodeStates: Readonly<Record<string, SkipStateLike>> | null | undefined,
): ExecutionOutcome | undefined {
  if (status !== "completed") return undefined
  return countEmptyInputSkips(nodeStates) > 0 ? "nothing_new" : "succeeded"
}
