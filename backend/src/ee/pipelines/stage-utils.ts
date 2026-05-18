import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Atomically increments pipeline_stages.critic_retry_count by 1.
 * The DB CHECK enforces critic_retry_count <= 2 — if this would exceed it,
 * the UPDATE fails and the caller should treat it as "retry budget exhausted."
 *
 * Returns the new count, or null if the row couldn't be updated (cap hit).
 */
export async function incrementCriticRetry(
  supabase: SupabaseClient,
  stageId: string,
): Promise<number | null> {
  const { data: current } = await supabase
    .from("pipeline_stages")
    .select("critic_retry_count")
    .eq("id", stageId)
    .single()
  const next = (current?.critic_retry_count ?? 0) + 1
  if (next > 2) return null
  const { error } = await supabase
    .from("pipeline_stages")
    .update({ critic_retry_count: next })
    .eq("id", stageId)
  if (error) return null
  return next
}
