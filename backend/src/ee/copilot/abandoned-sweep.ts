/**
 * Remove the empty workflows a failed home-page handoff leaves behind (#904).
 *
 * `POST /v1/copilot/threads { prompt }` inserts the workflow before the thread
 * and nothing rolls it back, so any failure after that point — a 402 on the
 * first turn, a dropped stream, the tab closed mid-hop, the handoff's own read
 * failing — leaves a `nodes: []` workflow in the user's default project, named
 * after the first 60 characters of what they typed. It does nothing, and it
 * sits at the top of the dashboard because it is the most recently updated.
 *
 * A rollback at the route would only cover the route's own failures, which are
 * the rare ones: almost every way this happens happens in the BROWSER, after
 * the response was already sent. So it is a sweep.
 *
 * FOUR conditions, and each one is the difference between a cleanup and losing
 * someone's work:
 *
 *  1. `created_workflow` — the handshake MADE this workflow. Opening the
 *     copilot on an existing workflow also creates a thread; that workflow is
 *     never ours to delete. Migration 349 records the fact rather than letting
 *     the sweep infer it.
 *  2. `user_turn_count = 0` AND no turn row exists. The count alone is not
 *     enough: it is bumped at turn END, so it reads 0 for the whole duration
 *     of a turn AND for every turn that died. A user who walks away from a
 *     failed hop, comes back hours later and sends from the seeded draft is
 *     reusing the SAME thread — same `created_at`, count still 0, canvas
 *     still empty until the model writes — and a tick landing there would
 *     delete the workflow out from under a running turn. If any turn row
 *     exists, somebody sent a message about this workflow; it is not a seed
 *     nobody ever spoke to. The count stays as the cheap indexed filter that
 *     bounds the candidate set.
 *  3. **The graph is still empty.** A hop can fail and the user can then build
 *     on the canvas by hand without ever messaging the copilot — turn count
 *     stays 0 while the workflow becomes real work. Condition 1 and 2 alone
 *     would delete it.
 *  4. Old enough. The failed hop seeds the typed sentence back into the
 *     composer, which is the "try again" the user has; deleting the workflow
 *     out from under that draft would break the one recovery there is.
 */
import { supabase } from "../../lib/supabase.js"
import { deleteWorkflowWithPrivateMedia } from "../../lib/workflow-delete.js"

/**
 * How long an untouched, unspoken-to seed is left alone. Long enough to cover
 * a user who walks away mid-hop and comes back to the seeded draft; short
 * enough that the clutter does not outlive the day.
 */
export const ABANDONED_SEED_AGE_MS = 3 * 60 * 60 * 1000

/** Bounds one pass. The cron runs hourly, so a backlog drains quickly. */
const SWEEP_BATCH = 200

/**
 * Rows the "has anyone spoken here?" probe may return. A candidate has
 * `user_turn_count = 0`, so it can only carry turns that never finished —
 * a handful at most, and the ceiling is here to make a truncated answer
 * IMPOSSIBLE to mistake for "no turns", not because it is expected.
 */
const TURN_PROBE_LIMIT = SWEEP_BATCH * 10

/** PostgREST's code for "that column is not on this table (yet)". */
const UNDEFINED_COLUMN = "42703"

export interface AbandonedSweepResult {
  deleted: number
  /** Candidates left alone: canvas no longer empty, or touched recently. */
  kept: number
  /** True when migration 349 has not reached this database yet. */
  skipped: boolean
  /**
   * The probe came back at its ceiling, so "no turn row" could not be proved
   * for anyone in this batch and NOTHING was deleted. Reported rather than
   * swallowed: a sweep that quietly stops sweeping looks exactly like a sweep
   * with nothing to do.
   */
  saturated: boolean
}

function isEmptyGraph(value: unknown): boolean {
  return Array.isArray(value) ? value.length === 0 : value === null || value === undefined
}

/**
 * Timestamps compared as INSTANTS, never as strings. Postgres hands back
 * `2026-08-25T09:00:00.123456+00:00` while `toISOString()` produces
 * `...Z` — two spellings of the same moment that sort differently the moment
 * the digits before them agree, and any offset other than +00:00 breaks the
 * ordering outright. Unparseable reads as "recently touched": the safe answer
 * is always to leave the workflow alone.
 */
function isAtOrAfter(timestamp: string | null, cutoffMs: number): boolean {
  if (!timestamp) return false
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? true : parsed >= cutoffMs
}

export async function sweepAbandonedCopilotWorkflows(now = Date.now()): Promise<AbandonedSweepResult> {
  const cutoffMs = now - ABANDONED_SEED_AGE_MS
  const cutoff = new Date(cutoffMs).toISOString()
  const idle: AbandonedSweepResult = { deleted: 0, kept: 0, skipped: false, saturated: false }

  const { data: threads, error: findError } = await supabase
    .from("copilot_threads")
    .select("id, user_id, workflow_id")
    .eq("created_workflow", true)
    .eq("user_turn_count", 0)
    .lt("created_at", cutoff)
    .limit(SWEEP_BATCH)
  if (findError) {
    // Staging shares the production database, so the gap between the dev merge
    // and the promotion is real running time. A cron that throws there would
    // be noise about a column that is simply not here yet.
    if ((findError as { code?: string }).code === UNDEFINED_COLUMN) return { ...idle, skipped: true }
    throw new Error(`abandoned copilot workflow sweep failed: ${findError.message}`)
  }

  const all = (threads ?? []) as Array<{ id: string; user_id: string; workflow_id: string }>
  if (all.length === 0) return idle

  // Anything anyone ever sent a message on stays — see condition 2.
  const { data: spokenRows, error: turnError } = await supabase
    .from("copilot_turns")
    .select("thread_id")
    .in(
      "thread_id",
      all.map((t) => t.id),
    )
    .limit(TURN_PROBE_LIMIT)
  if (turnError) throw new Error(`abandoned copilot workflow sweep failed: ${turnError.message}`)
  const spokenList = (spokenRows ?? []) as Array<{ thread_id: string }>
  // A truncated answer cannot distinguish "this thread has no turns" from
  // "its turns fell outside the page", and the wrong guess deletes a workflow
  // somebody spoke to. Delete nothing, and say so.
  if (spokenList.length >= TURN_PROBE_LIMIT) return { ...idle, saturated: true }
  const spoken = new Set(spokenList.map((r) => r.thread_id))
  const candidates = all.filter((t) => !spoken.has(t.id))
  if (candidates.length === 0) return idle

  const { data: workflowRows, error: wfError } = await supabase
    .from("workflows")
    .select("id, user_id, nodes, edges, updated_at")
    .in(
      "id",
      candidates.map((t) => t.workflow_id),
    )
  if (wfError) throw new Error(`abandoned copilot workflow sweep failed: ${wfError.message}`)

  const byId = new Map(
    ((workflowRows ?? []) as Array<{
      id: string
      user_id: string
      nodes: unknown
      edges: unknown
      updated_at: string | null
    }>).map((w) => [w.id, w]),
  )

  const result = { ...idle }
  for (const thread of candidates) {
    const workflow = byId.get(thread.workflow_id)
    // Already gone: the user deleted it themselves, or a previous pass did.
    if (!workflow) continue
    if (!isEmptyGraph(workflow.nodes) || !isEmptyGraph(workflow.edges)) {
      result.kept++
      continue
    }
    // Touched recently, by anything at all — a save, a rename, a drag that
    // ended empty. Someone is in there.
    if (isAtOrAfter(workflow.updated_at, cutoffMs)) {
      result.kept++
      continue
    }
    // Owner-scoped and atomic, and the same call the user's own delete makes,
    // so private Recast media is cleaned up the one way it is anywhere else.
    // The thread, its turns and its messages go with it by cascade.
    //
    // The THREAD's user id, deliberately, not the workflow row's: the RPC
    // deletes only what that user owns, so passing the workflow's own owner
    // would make its one safety check a tautology. Handed the thread's, the
    // check asks a real question — does the person this seed belongs to still
    // own this workflow? — and a workflow that changed hands is declined
    // rather than deleted.
    const deleted = await deleteWorkflowWithPrivateMedia({
      workflowId: workflow.id,
      userId: thread.user_id,
    })
    if (deleted) result.deleted++
  }
  return result
}
