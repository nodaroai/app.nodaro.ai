import { supabase } from "../supabase.js"
import type { ProviderKind } from "./types.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "../job-status.js"
import { noteSlotWaitColumnError, slotWaitColumnAbsent } from "../jobs-slot-wait-column.js"

/**
 * Returns a callback that persists `provider_kind` + `provider_task_id` +
 * `provider_call_started_at` on the job row when the provider client gets a
 * taskId from `createTask`. Best-effort — a failed DB write never throws, so
 * the in-progress provider call always proceeds.
 */
export function makeOnTaskCreated(
  jobId: string,
  kind: ProviderKind,
): (taskId: string) => Promise<void> {
  return async (taskId: string) => {
    try {
      await supabase
        .from("jobs")
        .update({
          provider_kind: kind,
          provider_task_id: taskId,
          provider_call_started_at: new Date().toISOString(),
        })
        .eq("id", jobId)
    } catch (err) {
      console.warn(
        `[reconcile/persistence] makeOnTaskCreated DB write failed for job ${jobId} kind ${kind}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}

/**
 * Called directly by sync HTTP routes right after credit reservation and
 * before the upstream call. No taskId — sync APIs don't expose one. Same
 * best-effort contract as `makeOnTaskCreated`.
 */
export async function markProviderCallStart(
  jobId: string,
  kind: ProviderKind,
): Promise<void> {
  try {
    await supabase
      .from("jobs")
      .update({
        provider_kind: kind,
        provider_call_started_at: new Date().toISOString(),
      })
      .eq("id", jobId)
  } catch (err) {
    console.warn(
      `[reconcile/persistence] markProviderCallStart DB write failed for job ${jobId} kind ${kind}:`,
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * R38: {@link markProviderCallStart} as a CAS on the live statuses — what a
 * SYNCHRONOUS metered LLM route stamps immediately before its call. A job a
 * user cancelled between the route's reserve and this stamp is NOT stamped
 * (`not-live`), so the route never sends the call (a cancel that found no stamp
 * refunded the hold; an unconditional stamp then let the call run free).
 * `error` — the write failed: the route must not call either (a later cancel
 * would read "not started" and refund a call in flight). Never throws.
 */
export async function markProviderCallStartIfLive(
  jobId: string,
  kind: ProviderKind,
): Promise<"started" | "not-live" | "error"> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .update({
        provider_kind: kind,
        provider_call_started_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .in("status", [...SYNC_CALL_LIVE_STATUSES])
      .select("id")
    if (error) {
      console.warn(`[reconcile/persistence] markProviderCallStartIfLive DB write failed for job ${jobId} kind ${kind}: ${error.message}`)
      return "error"
    }
    return Array.isArray(data) && data.length > 0 ? "started" : "not-live"
  } catch (err) {
    console.warn(
      `[reconcile/persistence] markProviderCallStartIfLive DB write failed for job ${jobId} kind ${kind}:`,
      err instanceof Error ? err.message : err,
    )
    return "error"
  }
}

/** The statuses a sync call's start may be stamped on: in flight and not parked on a reviewer. */
const SYNC_CALL_LIVE_STATUSES: readonly string[] = IN_FLIGHT_JOB_STATUSES.filter((s) => !isParkedJobStatus(s))

/**
 * Liveness refresh for the worker's pickup sentinel: moves
 * `provider_call_started_at` to now on a row that is STILL `processing` under
 * `provider_kind = "pre-task"`, and touches nothing else.
 *
 * A compare-and-set, never an overwrite — each guard protects a different lane:
 *  - `provider_kind = "pre-task"`: a row a handler has moved on to a real kind
 *    (`makeOnTaskCreated` / `markProviderCallStart`) keeps that kind's
 *    threshold and recovery path; writing `pre-task` back would turn an async
 *    recovery into fail + refund. A row whose sentinel was CLEARED
 *    (`tk.jobs.clearReconcileSentinel`, gvp/evp) stays null, so it stays on the
 *    90-minute orchestrator sweep that owns it.
 *  - `status = "processing"`: a terminal, cancelled or held (`pending_review`)
 *    row is never made to look live.
 *
 * Best-effort like its siblings: a failed write never throws into the handler
 * it is keeping alive — the next beat retries.
 */
export async function refreshPreTaskSentinel(jobId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("jobs")
      .update({ provider_call_started_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("provider_kind", "pre-task")
      .eq("status", "processing")
    if (error) {
      console.warn(`[reconcile/persistence] refreshPreTaskSentinel DB write failed for job ${jobId}: ${error.message}`)
    }
  } catch (err) {
    console.warn(
      `[reconcile/persistence] refreshPreTaskSentinel DB write failed for job ${jobId}:`,
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Record a processing job's total ffmpeg-slot wait (`jobs.slot_wait_ms`, Track
 * 0.13): the workflow engine takes it off the node's clocks. Its own write,
 * gated on `status = "processing"` only — NOT on the pre-task sentinel — so a
 * job that has moved to a real provider kind (an async provider, then a
 * watermark ffmpeg) or cleared its sentinel (gvp/evp) is still credited.
 * Best-effort like its siblings.
 */
export async function recordJobSlotWait(jobId: string, totalMs: number): Promise<void> {
  // Before migration 451 reaches this database there is nothing to write.
  if (slotWaitColumnAbsent()) return
  try {
    const { error } = await supabase
      .from("jobs")
      .update({ slot_wait_ms: Math.max(0, Math.round(totalMs)) })
      .eq("id", jobId)
      .eq("status", "processing")
    if (error && noteSlotWaitColumnError(error)) return
    if (error) {
      console.warn(`[reconcile/persistence] recordJobSlotWait DB write failed for job ${jobId}: ${error.message}`)
    }
  } catch (err) {
    console.warn(
      `[reconcile/persistence] recordJobSlotWait DB write failed for job ${jobId}:`,
      err instanceof Error ? err.message : err,
    )
  }
}

export { fireOnTaskCreated } from "./fire-on-task-created.js"
