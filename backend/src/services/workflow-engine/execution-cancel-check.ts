/**
 * The mid-wait cancel check every long wait of the backend engine makes: a
 * node waiting on a job learns its execution was cancelled without waiting
 * for its level to end. Throttled — every CANCEL_CHECK_INTERVAL poll cycles,
 * and the timestamp on `ctx` is shared, so of the nodes polling in parallel
 * only one reads the execution per interval.
 */
import { supabase } from "../../lib/supabase.js"
import { JOB_POLL_INTERVAL_MS, type OrchestratorContext } from "./types.js"

/** Check every Nth poll cycle. */
export const CANCEL_CHECK_INTERVAL = 5

/**
 * True when this poll cycle found the execution cancelled — `ctx.cancelled`
 * is then set. "stopping" is not a cancel: it means "finish the current
 * level, then stop", handled at the level boundary (orchestrator-worker.ts).
 */
export async function executionCancelledNow(ctx: OrchestratorContext, pollCycle: number): Promise<boolean> {
  const now = Date.now()
  if (pollCycle % CANCEL_CHECK_INTERVAL !== 0 || now - (ctx.lastCancelCheckMs ?? 0) < CANCEL_CHECK_INTERVAL * JOB_POLL_INTERVAL_MS) return false
  ctx.lastCancelCheckMs = now
  const { data: execRow } = await supabase.from("workflow_executions").select("status").eq("id", ctx.executionId).single()
  if (execRow?.status !== "cancelled") return false
  ctx.cancelled = true
  return true
}
