import { supabase } from "../supabase.js"
import type { ProviderKind } from "./types.js"

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

export { fireOnTaskCreated } from "./fire-on-task-created.js"
