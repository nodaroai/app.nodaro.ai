/**
 * One `start` per job, held by the job row (docs/design/house-models.md).
 *
 * Before a house-model run calls `start`, it CLAIMS the job: one
 * compare-and-set on `jobs` that writes `provider_kind = "house-model"`,
 * `provider_task_id = HOUSE_MODEL_CLAIM_REF` and `provider_call_started_at`,
 * and lands only on a row that is live (not parked, not terminal) and has no
 * `provider_task_id` yet. Whatever happens after that — the worker's inline
 * safety retry runs the lane again in-process, the worker dies after `start`
 * resolved and before the reference is saved, the save fails and the worker
 * dies later — the row already holds a task id, so:
 *   - a queue re-pick takes the reconcile path (the worker routes any row with
 *     a saved task id there), and the reconcile never starts anything;
 *   - a second run of the lane in the same process finds the claim taken and
 *     either reads the run it already started (a real reference) or refuses.
 * A re-pick of a row with any task id never reaches the handler: the worker's
 * stall-retry guard sends it to the recovery first (only a handler that
 * re-attaches to its own task is run instead, and its pickup keeps the saved
 * task). So the claim, once written, is never overwritten by a pickup.
 *
 * The real reference replaces the claim with a second compare-and-set, on the
 * claim's own value, together with the start's planned cost.
 */
import { supabase } from "./supabase.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "./job-status.js"
import { HOUSE_MODEL_PROVIDER_KIND } from "./house-models-served.js"

/** `jobs.provider_task_id` of a job claimed for a house-model run whose reference is not saved yet. Never a reference. */
export const HOUSE_MODEL_CLAIM_REF = "house-model:claimed"

/** The statuses a claim may land on: in flight and not parked on a reviewer. */
const CLAIMABLE_STATUSES: readonly string[] = IN_FLIGHT_JOB_STATUSES.filter((s) => !isParkedJobStatus(s))

/** True for a saved task id that is a run's reference, not the claim (nor empty). */
export function isHouseModelReference(taskId: unknown): taskId is string {
  return typeof taskId === "string" && taskId.length > 0 && taskId !== HOUSE_MODEL_CLAIM_REF
}

/**
 * What claiming a job found:
 *   - `claimed`: this caller holds the claim and may call `start`, once;
 *   - `started`: the job already holds a run's reference (`taskRef`): read it, never start;
 *   - `taken`: the job is claimed with no reference, or holds another kind's
 *     task, or is no longer live: nothing may start;
 *   - `error`: the database could not be asked (nothing was started; a retry may ask again).
 */
export type HouseModelClaim =
  | { readonly state: "claimed" }
  | { readonly state: "started"; readonly taskRef: string }
  | { readonly state: "taken" }
  | { readonly state: "error"; readonly message: string }

/** Claims `jobId` for one house-model `start` (see the module doc). Never throws. */
export async function claimHouseModelStart(jobId: string): Promise<HouseModelClaim> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .update({
        provider_kind: HOUSE_MODEL_PROVIDER_KIND,
        provider_task_id: HOUSE_MODEL_CLAIM_REF,
        provider_call_started_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .is("provider_task_id", null)
      .in("status", [...CLAIMABLE_STATUSES])
      .select("id")
    if (error) return { state: "error", message: error.message }
    if (Array.isArray(data) && data.length > 0) return { state: "claimed" }
    // trash-read: a run's own lifecycle — whether the job already holds a run's reference, deleted or not.
    const { data: row, error: readError } = await supabase
      .from("jobs")
      .select("provider_kind, provider_task_id")
      .eq("id", jobId)
      .maybeSingle()
    if (readError) return { state: "error", message: readError.message }
    const held = row as { provider_kind?: unknown; provider_task_id?: unknown } | null
    if (held?.provider_kind === HOUSE_MODEL_PROVIDER_KIND && isHouseModelReference(held.provider_task_id)) {
      return { state: "started", taskRef: held.provider_task_id }
    }
    return { state: "taken" }
  } catch (err) {
    return { state: "error", message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * What saving the run's reference found:
 *   - `saved`: the reference replaced the claim;
 *   - `not-live`: the row is no longer this run's to save on — it left the
 *     live statuses (a re-pick failed and refunded it while `start` ran, a
 *     cancel) or no longer holds the claim. Nothing was written;
 *   - `error`: the database could not be asked; whether it landed is unknown.
 */
export type HouseModelReferenceSave = "saved" | "not-live" | "error"

/**
 * Replaces the claim with the run's reference, and records the start's planned
 * cost (`jobs.provider_cost`) in the same write: a job the recovery finishes
 * keeps that figure when the upstream reports none. Lands only on the claim
 * (never overwrites a reference) of a job that is still live (pending, queued
 * or processing): a worker whose lock lapsed while `start` ran may find its job
 * already failed and refunded by the re-pick, and must not write over it.
 * Never throws.
 */
export async function saveHouseModelReference(jobId: string, taskRef: string, plannedCostUsd: number): Promise<HouseModelReferenceSave> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .update({
        provider_task_id: taskRef,
        provider_call_started_at: new Date().toISOString(),
        ...(Number.isFinite(plannedCostUsd) && plannedCostUsd >= 0 ? { provider_cost: plannedCostUsd } : {}),
      })
      .eq("id", jobId)
      .eq("provider_kind", HOUSE_MODEL_PROVIDER_KIND)
      .eq("provider_task_id", HOUSE_MODEL_CLAIM_REF)
      .in("status", [...CLAIMABLE_STATUSES])
      .select("id")
    if (error) {
      console.warn(`[house-models] job ${jobId}: saving the run's reference failed: ${error.message}`)
      return "error"
    }
    return Array.isArray(data) && data.length > 0 ? "saved" : "not-live"
  } catch (err) {
    console.warn(`[house-models] job ${jobId}: saving the run's reference failed: ${err instanceof Error ? err.message : String(err)}`)
    return "error"
  }
}
