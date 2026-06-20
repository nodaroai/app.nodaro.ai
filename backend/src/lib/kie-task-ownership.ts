import { supabase } from "./supabase.js"

/**
 * IDOR guard for KIE continuation routes (extend-video, video-upscale, …) that
 * accept a caller-supplied `kieTaskId` referencing an upstream generation.
 *
 * The original generation job stores its KIE task id in `jobs.provider_task_id`
 * (migration 138). This returns `true` ONLY when that task id demonstrably
 * belongs to a DIFFERENT user — i.e. fail-OPEN for unknown/untracked ids so
 * legit or pre-migration-138 jobs (which may lack `provider_task_id`) still
 * extend, while fail-CLOSED for a task id that provably belongs to someone else.
 */
export async function kieTaskOwnedByAnother(
  kieTaskId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("jobs")
    .select("user_id")
    .eq("provider_task_id", kieTaskId)
    .limit(1)
  const owner = data?.[0]
  return Boolean(owner && owner.user_id !== userId)
}
