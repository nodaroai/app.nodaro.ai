import { isSeedance2Provider } from "@nodaro/shared/models"
import { supabase } from "../supabase.js"
import { FAILABLE_STATUSES } from "../job-failure.js"
import { createKieTask, readKieTaskRequest } from "../../providers/kie/client.js"
import { deriveKieEgressDimensions } from "../../providers/kie/egress-dimensions.js"
import {
  isSeedance2EditModeInput,
  isSeedance2EditModeRejection,
  providerErrorText,
  seedance2EditModeResendInput,
  SEEDANCE_TASK_TYPE_WIRE_KEY,
} from "../../providers/kie/seedance-edit-mode.js"
import type { KieJobRow } from "./kie.js"

/**
 * The job's one resend, on its `input_data` (hidden: `__` keys are stripped from every job
 * read), where no sweep overwrites it. `task` is the task it replaced, `at` when it was claimed.
 */
export const SEEDANCE_EDIT_RESEND_KEY = "__seedanceEditResend"

/** A resend younger than this is a reconciler still sending; an older one on the same task is one that died. */
export const SEEDANCE_EDIT_CLAIM_LIVE_MS = 2 * 60_000

/** The claim on `reconcile_last_error`: the compare-and-swap that lets one reconciler through. */
const CLAIM_MARKER = "seedance_edit_resubmit"

function resendOf(inputData: unknown): { task: string; at: number } | null {
  const value = (inputData as Record<string, unknown> | null | undefined)?.[SEEDANCE_EDIT_RESEND_KEY]
  if (typeof value !== "object" || value === null) return null
  const { task, at } = value as { task?: unknown; at?: unknown }
  return { task: String(task), at: Number(at) }
}

export type SeedanceEditResubmit =
  /** Sent: the job now waits on `taskId`. */
  | { outcome: "resent"; taskId: string }
  /** The failure is the job's own: fail and refund it. */
  | { outcome: "stands" }
  /** Another reconciler has this job, or the row moved on: leave it alone. */
  | { outcome: "taken" }

const STANDS: SeedanceEditResubmit = { outcome: "stands" }
const TAKEN: SeedanceEditResubmit = { outcome: "taken" }

/**
 * The worker's one retry on Seedance's edit-mode rejection, for a job the worker
 * no longer waits on (a deploy restart, a stall): without it the recovery lane
 * failed the run a live worker would have saved. The job's task is sent again as
 * KIE recorded it, with the two values the provider asked for.
 *
 * The cron and a stall re-pick can reach the same row, and staging's and
 * production's sweeps scan one database, so every decision reads the row, not the
 * caller's snapshot, and the row is read after the slow call to the provider. Only
 * the holder of the claim sends, and a job is sent again at most once: its record
 * outlives the task it replaced. A reconciler that dies after claiming leaves a
 * record that ages out, and the job is then failed and refunded rather than sent again.
 */
export async function resubmitSeedanceEdit(row: KieJobRow, err: unknown): Promise<SeedanceEditResubmit> {
  const provider = row.input_data?.provider
  const taskId = row.provider_task_id
  if (row.provider_kind !== "kie-standard" || !taskId) return STANDS
  if (typeof provider !== "string" || !isSeedance2Provider(provider)) return STANDS
  if (!isSeedance2EditModeRejection(providerErrorText(err))) return STANDS

  const request = await readKieTaskRequest(taskId)

  const { data: current, error: readError } = await supabase
    .from("jobs")
    .select("provider_task_id, reconcile_last_error, input_data")
    .eq("id", row.id)
    .maybeSingle()
  if (readError) console.warn(`[reconcile/kie] job ${row.id}: reading the row for the edit resend failed:`, readError.message)
  if (!current || current.provider_task_id !== taskId) return TAKEN
  const resend = resendOf(current.input_data)
  if (resend) {
    // On an earlier task: this rejection is the job's one resend's.
    if (resend.task !== taskId) return STANDS
    return Math.abs(Date.now() - resend.at) < SEEDANCE_EDIT_CLAIM_LIVE_MS ? TAKEN : STANDS
  }
  if (!request || isSeedance2EditModeInput(request.input)) return STANDS

  const claiming = supabase
    .from("jobs")
    .update({
      reconcile_last_error: CLAIM_MARKER,
      input_data: { ...(current.input_data as Record<string, unknown> | null), [SEEDANCE_EDIT_RESEND_KEY]: { task: taskId, at: Date.now() } },
    })
    .eq("id", row.id)
    .eq("provider_task_id", taskId)
    .in("status", [...FAILABLE_STATUSES])
  const lastError = current.reconcile_last_error
  const { data: claimed, error: claimError } = await (lastError === null || lastError === undefined
    ? claiming.is("reconcile_last_error", null)
    : claiming.eq("reconcile_last_error", lastError)
  ).select("id")
  if (claimError) console.warn(`[reconcile/kie] job ${row.id}: claiming the edit resend failed:`, claimError.message)
  if (!claimed?.length) return TAKEN

  // The undeclared edit shape: a declared task type is dropped, since the
  // provider overrode it (the worker's retry sends the same body).
  const input = seedance2EditModeResendInput(request.input)
  const declared = request.input[SEEDANCE_TASK_TYPE_WIRE_KEY]
  if (declared !== undefined) {
    console.warn(
      `[reconcile/kie] job ${row.id}: task ${taskId}: dropped the declared reference task type "${String(declared)}" from the resend — the provider ran the request as an edit`,
    )
  }
  let newTaskId: string
  try {
    newTaskId = (await createKieTask(request.model, input, {
      modelKey: provider,
      dimensions: deriveKieEgressDimensions(input),
    })).taskId
  } catch (resubmitErr) {
    console.warn(
      `[reconcile/kie] job ${row.id}: the edit resubmission failed:`,
      resubmitErr instanceof Error ? resubmitErr.message : resubmitErr,
    )
    return STANDS
  }
  const { data: moved, error: moveError } = await supabase
    .from("jobs")
    .update({ provider_task_id: newTaskId, provider_call_started_at: new Date().toISOString(), reconcile_attempts: 0 })
    .eq("id", row.id)
    .eq("provider_task_id", taskId)
    .in("status", [...FAILABLE_STATUSES])
    .select("id")
  if (!moved?.length) {
    console.warn(`[reconcile/kie] job ${row.id}: task ${newTaskId} was sent but the job moved on, so nothing waits on it`, moveError?.message ?? "")
    return TAKEN
  }
  console.warn(`[reconcile/kie] job ${row.id}: rejected as a video edit, resubmitted once as task ${newTaskId}`)
  return { outcome: "resent", taskId: newTaskId }
}
