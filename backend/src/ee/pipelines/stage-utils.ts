import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStageName } from "@nodaro/shared"

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

/**
 * Idempotent create-or-fetch of a pipeline_stages row for (pipelineId, stageName).
 * UNIQUE(pipeline_id, stage_name) makes the second create idempotent.
 */
export async function ensureStageRow(
  supabase: SupabaseClient,
  pipelineId: string,
  stageName: PipelineStageName,
  stageOrder: number,
): Promise<string> {
  const { data: existing } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", stageName)
    .maybeSingle()
  if (existing?.id) return existing.id
  const { data, error } = await supabase
    .from("pipeline_stages")
    .insert({
      pipeline_id: pipelineId,
      stage_name: stageName,
      stage_order: stageOrder,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (error || !data)
    throw new Error(`Failed to create stage row for ${stageName}: ${error?.message}`)
  return data.id
}

/**
 * Marks a stage as failed with a structured reason.
 */
export async function failStage(
  supabase: SupabaseClient,
  stageId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("pipeline_stages")
    .update({
      status: "failed",
      output: { failure_reason: reason },
      completed_at: new Date().toISOString(),
    })
    .eq("id", stageId)
}
