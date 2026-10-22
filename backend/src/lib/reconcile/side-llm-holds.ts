// @registry-enumerates settles the metered side holds it reads through CreditsService — a credit id, not a node type, so not a @registry-lookup
/**
 * The reconcile sweep's pass over metered LLM SIDE holds (migration 554,
 * `lib/llm-side-hold.ts`) — the live AND the cancelled-hold sweep for them.
 *
 * A side hold is a usage log with no `job_id` (its job is named by its
 * `llm_side_holds` row), so none of the job-keyed sweeps — the main scan, the
 * never-started, stuck and cancelled-hold passes — can see it, by design: they
 * decide the JOB, and a side hold must never decide or be decided by its job.
 * This pass is its only net. It reads every hold no settle has confirmed,
 * whatever its job's state (live, cancelled, finished, deleted):
 *  - within the grace from its last stamp (the call's start, else its
 *    reservation) it is left — its worker may still be calling: the
 *    pre-task threshold plus the per-node ceiling, the grace the
 *    cancelled-hold sweep gives a worker's call (R38 m2);
 *  - past it, it is closed (a CAS on the stamp read: a call started since is
 *    left) and settled from its ledger — the billed actual charged, nothing
 *    billed refunded (an unnoted bill from a dead process counts as unbilled,
 *    as everywhere);
 *  - a settle that cannot be confirmed advances the hold's OWN attempts
 *    counter (never the job's `reconcile_attempts`); at the D10 cap a billed
 *    hold is charged whole and reported, one never billed is refunded.
 *
 * It runs whenever credits exist and the schema is present — under the
 * rollback too: no side hold is reserved then, but one reserved before the
 * flip still settles metered (a settle keys off the reservation, as the shim
 * says), and an empty table costs one indexed read.
 */
import { hasCredits } from "../config.js"
import { llmMeteredSchemaReady } from "../llm-metered-schema-gate.js"
import { NODE_TIMEOUT_MS } from "../../services/workflow-engine/types.js"
import { STALE_THRESHOLD_MS } from "./types.js"

/** Per-tick cap, as the other passes'. */
const BATCH_LIMIT = 500

/**
 * How long an open side hold may still have its call in flight after its last
 * stamp: the pre-task threshold plus the per-node ceiling (2 hours). A worker
 * reserves a side hold immediately before its call, so a hold not even
 * started by then is released.
 */
export const SIDE_HOLD_GRACE_MS = STALE_THRESHOLD_MS["pre-task"] + NODE_TIMEOUT_MS

export interface SideHoldSweepCounts {
  scanned: number
  swept: number
  notStale: number
  errors: number
}

export async function sweepSideLlmHolds(result: SideHoldSweepCounts): Promise<void> {
  if (!hasCredits() || !llmMeteredSchemaReady()) return
  const { sweepSideHoldsImpl } = await import("../../ee/billing/llm-side-hold-impl.js")
  const r = { scanned: 0, settled: 0, notStale: 0, retried: 0, errors: 0 }
  await sweepSideHoldsImpl(r, { graceMs: SIDE_HOLD_GRACE_MS, limit: BATCH_LIMIT })
  result.scanned += r.scanned
  result.swept += r.settled
  result.notStale += r.notStale
  result.errors += r.errors
}
