import type { NodeOutput } from "../services/workflow-engine/types.js"
import type { ExecuteNodeResult } from "../services/workflow-engine/node-executor.js"

/** The fulfilled value of one fan-out iteration task. */
export interface FanOutIterationValue {
  index: number
  result: ExecuteNodeResult
  resultValue: string
}

export interface FanOutAssembly {
  output: NodeOutput
  jobId?: string
  jobIds?: string[]
  usageLogId?: string
  creditsUsed: number
  /** Number of iterations that produced a result. */
  succeededCount: number
  /** First non-cancellation rejection, when some — but not all — iterations
   *  failed. The caller logs it; nothing is thrown for partial success. */
  genuineFailure?: unknown
}

/** Sentinels: the per-iteration guard throws "Cancelled"; settledWithLimit
 *  throws "Execution cancelled" when it skips un-started tasks after a
 *  fail-fast or a user cancellation. These are NOT genuine node failures. */
function isCancellationReason(reason: unknown): boolean {
  const msg = reason instanceof Error ? reason.message : String(reason)
  return msg === "Cancelled" || msg === "Execution cancelled"
}

/**
 * Assemble a fan-out node's per-iteration settled results into a single
 * ExecuteNodeResult, applying failure-propagation semantics.
 *
 * Background: this logic previously swallowed every rejected iteration and
 * ALWAYS returned success, so a fully-failed fan-out was reported "completed"
 * with empty output (downstream nodes then ran on empty input), and a failed
 * iteration 0 dropped the primary output even when later iterations succeeded.
 *
 * Semantics (mirrors the frontend list-execution: failed === items.length
 * ? "failed" : "completed"). `settledWithLimit` is fail-fast, so "everything
 * failed" surfaces as `succeededCount === 0` (the first genuine failure cancels
 * the un-started iterations, which then reject with the cancellation sentinel —
 * not as N genuine failures):
 *
 *   - succeededCount === 0 AND a genuine failure occurred  -> THROW that failure
 *     (caller's settledWithLimit marks the node failed and the run fail-fasts).
 *   - succeededCount === 0 AND only cancellations           -> pure cancellation
 *     (user stop); return empty output and let the orchestrator's between-level
 *     cancellation check handle status. genuineFailure is undefined.
 *   - succeededCount > 0 with some failures                 -> partial success:
 *     keep the successful results, set genuineFailure for the caller to log,
 *     and hydrate the primary output from the first successful iteration so a
 *     failed/cancelled index 0 doesn't blank it.
 */
export function assembleFanOutResult(
  settled: PromiseSettledResult<FanOutIterationValue>[],
  itemCount: number,
): FanOutAssembly {
  const allResults: string[] = new Array(itemCount).fill("")
  const allJobIds: string[] = []
  let firstOutput: NodeOutput | undefined            // iteration 0's output (preferred primary)
  let firstSuccessfulOutput: NodeOutput | undefined  // first fulfilled output (fallback primary)
  let succeededCount = 0
  let genuineFailure: unknown | undefined
  let totalCreditsUsed = 0
  let lastJobId: string | undefined
  let lastUsageLogId: string | undefined

  for (const entry of settled) {
    if (entry.status === "fulfilled") {
      const { index, result, resultValue } = entry.value
      allResults[index] = resultValue
      succeededCount++
      if (index === 0) firstOutput = result.output
      if (!firstSuccessfulOutput) firstSuccessfulOutput = result.output
      totalCreditsUsed += result.creditsUsed ?? 0
      if (result.jobId) {
        lastJobId = result.jobId
        allJobIds.push(result.jobId)
      }
      if (result.usageLogId) lastUsageLogId = result.usageLogId
    } else if (!isCancellationReason(entry.reason) && genuineFailure === undefined) {
      genuineFailure = entry.reason
    }
  }

  if (succeededCount === 0 && genuineFailure !== undefined) {
    throw genuineFailure instanceof Error
      ? genuineFailure
      : new Error(String(genuineFailure))
  }

  // Prefer iteration 0's output as primary; fall back to the first successful
  // iteration so a failed/cancelled index 0 doesn't blank the primary output.
  const primaryOutput = firstOutput ?? firstSuccessfulOutput

  const output: NodeOutput = {
    ...(primaryOutput ?? {}),
    listResults: allResults,
  }

  return {
    output,
    jobId: lastJobId,
    jobIds: allJobIds.length > 1 ? allJobIds : undefined,
    usageLogId: lastUsageLogId,
    creditsUsed: totalCreditsUsed,
    succeededCount,
    genuineFailure,
  }
}
