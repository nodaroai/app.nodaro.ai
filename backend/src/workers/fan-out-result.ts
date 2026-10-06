import { FAN_OUT_ALL_OR_NOTHING_TYPES, fanOutItemMeta, type FanOutItemMeta, type RunResultRowStamp } from "@nodaro/shared"
import type { NodeOutput } from "../services/workflow-engine/types.js"
import type { ExecuteNodeResult } from "../services/workflow-engine/node-executor.js"
import { DrainAbortError } from "../lib/worker-drain.js"

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

/** One iteration's identity: its job, its thumbnail, and what a render stamped. */
function rowStampOf(result: ExecuteNodeResult): RunResultRowStamp {
  const o = result.output
  return {
    ...(result.jobId ? { jobId: result.jobId } : {}),
    ...(typeof o.thumbnailUrl === "string" && o.thumbnailUrl ? { thumbnailUrl: o.thumbnailUrl } : {}),
    ...(o.quality ? { quality: o.quality } : {}),
    ...(o.clipKey ? { clipKey: o.clipKey } : {}),
    ...(o.planBasis ? { planBasis: o.planBasis } : {}),
    ...(o.renderBasis ? { renderBasis: o.renderBasis } : {}),
  }
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
 *   - ANY iteration rejected with DrainAbortError           -> THROW it, always
 *     (deploy drain — never tolerated; see the branch below for why).
 *   - succeededCount > 0 with some failures                 -> partial success:
 *     keep the successful results, set genuineFailure for the caller to log,
 *     and hydrate the primary output from the first successful iteration so a
 *     failed/cancelled index 0 doesn't blank it.
 *   - an ALL-OR-NOTHING node type (`FAN_OUT_ALL_OR_NOTHING_TYPES`, UGC Clip)
 *     with ANY genuine failure                              -> THROW the first
 *     one; nothing partial reaches a Bundle edge (spec R17). Cancellation-only
 *     rejections are not failures. Already-started items finished and settled;
 *     their jobs are reused on the next run.
 */
export function assembleFanOutResult(
  settled: PromiseSettledResult<FanOutIterationValue>[],
  itemCount: number,
  nodeType?: string,
): FanOutAssembly {
  const allOrNothing = nodeType !== undefined && FAN_OUT_ALL_OR_NOTHING_TYPES.has(nodeType)
  const allResults: string[] = new Array(itemCount).fill("")
  // Each row's own freshness key (Video Overlay: every list item is its own
  // composition) — row-aligned with allResults, "" where the row has none.
  const allCompositionKeys: string[] = new Array(itemCount).fill("")
  let anyCompositionKey = false
  // Each row's identity (job, thumbnail, a render's quality + clip) —
  // row-aligned with allResults, `{}` where the row produced nothing. The
  // editor stamps each result row from it; `allJobIds` below is compacted in
  // settle order and cannot be paired with the rows by position.
  const allStamps: RunResultRowStamp[] = Array.from({ length: itemCount }, () => ({}))
  const allJobIds: string[] = []
  // Each row's notes (warnings + real length) — row-aligned with allResults.
  // Filled only for all-or-nothing types (UGC Clip); nothing else reads it.
  const allMeta: (FanOutItemMeta | null)[] = new Array(itemCount).fill(null)
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
      const key = result.output.resultCompositionKey
      if (typeof key === "string" && key.length > 0) {
        allCompositionKeys[index] = key
        anyCompositionKey = true
      }
      allStamps[index] = rowStampOf(result)
      if (allOrNothing) allMeta[index] = fanOutItemMeta(result.output)
      succeededCount++
      if (index === 0) firstOutput = result.output
      if (!firstSuccessfulOutput) firstSuccessfulOutput = result.output
      totalCreditsUsed += result.creditsUsed ?? 0
      if (result.jobId) {
        lastJobId = result.jobId
        allJobIds.push(result.jobId)
      }
      if (result.usageLogId) lastUsageLogId = result.usageLogId
    } else if (entry.reason instanceof DrainAbortError) {
      // Deploy drain (B6b): NEVER a tolerated iteration failure, whatever
      // succeededCount is. The drained iteration's child job is still running
      // in the video worker's own process and WILL complete and finalize its
      // charge — tolerating it here would persist this fan-out node
      // `completed` with "" for that item, so the user pays for output the
      // execution discarded, and the orchestrator's drain hatch
      // (`result.reason instanceof DrainAbortError`) would never see the
      // abort. Rethrow with its identity intact so the whole execution is
      // requeued untouched instead.
      throw entry.reason
    } else if (!isCancellationReason(entry.reason) && genuineFailure === undefined) {
      genuineFailure = entry.reason
    }
  }

  // All-or-nothing (spec R17): one genuine failure fails the node; nothing partial reaches a Bundle edge.
  if (genuineFailure !== undefined && allOrNothing) {
    throw genuineFailure instanceof Error ? genuineFailure : new Error(String(genuineFailure))
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
    // The primary's `resultCompositionKey` is iteration 0's; the rows carry their own.
    ...(anyCompositionKey ? { listResultCompositionKeys: allCompositionKeys } : {}),
    listResultStamps: allStamps,
    ...(allMeta.some(Boolean)
      ? { listResultMeta: allMeta.map((m): FanOutItemMeta => m ?? { warnings: [], durationSec: null }) }
      : {}),
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
