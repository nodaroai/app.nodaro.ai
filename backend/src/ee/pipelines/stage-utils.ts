import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStageName } from "@nodaro/shared"
import { IMAGE_CRITIC_UNRESOLVABLE } from "@nodaro/shared"
import { pipelineEvents } from "./events.js"

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

/**
 * Phase 1D.2a §4.1: bulk-flip every `awaiting_approval` entity for this
 * pipeline+entity_type to `approved`, then batch-flip the matching
 * `pipeline_entity_nodes` rows from `pipeline_owned_awaiting_approval` →
 * `pipeline_owned_approved` (emitting one `entity:state_change` SSE per
 * touched node). Idempotent — safe to call multiple times in the same pass.
 *
 * Used by auto-mode in Stages 2/3/4/5/6 to advance without user gating.
 * Does NOT flip the `pipeline_stages` row or emit `stage:status` —
 * callers handle the stage-level transition because they vary on timing
 * (e.g., characters phase 1 leaves the stage `running` while variants
 * generate; phase 2 flips to `approved`).
 */
export async function bulkApproveStageEntities(
  supabase: SupabaseClient,
  pipelineId: string,
  entityType: "character" | "object" | "location" | "scene",
  emitLabel: string,
): Promise<void> {
  const { transitionStageEntityNodesAndEmit } = await import("./depends-on.js")
  await supabase
    .from("pipeline_entities")
    .update({ status: "approved" })
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", entityType)
    .eq("status", "awaiting_approval")
  await transitionStageEntityNodesAndEmit(
    supabase,
    pipelineId,
    entityType,
    "pipeline_owned_approved",
    emitLabel,
  )
}

/**
 * Phase 1D.2c-a §6 (D1): scans an already-loaded entities array and returns
 * those whose `metadata.last_error === IMAGE_CRITIC_UNRESOLVABLE`. Used by
 * auto-mode in Stages 2 (characters) and 4 (locations) to detect entities
 * force-failed by the image-critic cap exhaustion before deciding whether to
 * advance the stage.
 *
 * Callers MUST pass entities already filtered by entity_type — the helper
 * does NOT re-query the DB (callers always have the freshly-loaded array
 * a few lines earlier in the stage handler).
 */
export function detectImageCriticFailures(
  entities: ReadonlyArray<{
    id: string
    entity_key: string
    metadata: Record<string, unknown> | null
  }>,
): Array<{ id: string; entity_key: string }> {
  return entities
    .filter(
      (e) =>
        (e.metadata as { last_error?: string } | null)?.last_error ===
        IMAGE_CRITIC_UNRESOLVABLE,
    )
    .map((e) => ({ id: e.id, entity_key: e.entity_key }))
}

/**
 * Phase 1D.2c-a §6 (D1) — originally introduced for the Stage 2/4 image
 * critic. Phase 1D.2c-b-ii (E1) generalizes the helper to the Stage 7 video
 * critic: the body is unchanged, only the `failureReason` literal type
 * widens to accept any `*_unresolvable` reason emitted by an auto-mode
 * critic-failure aggregator. The frontend already gates on
 * `failure_reason.endsWith("_unresolvable")` so no UI changes are needed for
 * new reasons.
 *
 * Mirrors the failure-aggregation pattern from `runScriptAndPersist` in
 * engine.ts:
 *   1. Refund unspent credits via `refundPipelineCredits` (only when `refundCredits > 0`).
 *   2. Flip the pipeline_stages row to failed with the typed reason (mirrors
 *      engine.ts script-stage failure — without this the stage row stays at
 *      `running` while the pipeline is `failed`, leaving the UI rendering an
 *      "in progress" stage for a dead pipeline).
 *   3. Update pipelines.status='failed' + failure_reason=`<reason>`.
 *   4. Emit `pipeline:status failed` + `stage:status failed` SSE.
 *
 * Auto-mode-only — manual/guided keep the failed entity/shot visible so the
 * user can Regenerate.
 *
 * Callers supply `userId` + `refundCredits` (typically computed as
 * `reserved - spent` from a pipelines row already loaded for other purposes).
 * This eliminates the helper's own SELECT against `pipelines`.
 */
export async function failPipelineWithCriticReason(args: {
  supabase: SupabaseClient
  pipelineId: string
  failureReason:
    | "characters_image_critic_unresolvable"
    | "locations_image_critic_unresolvable"
    | "video_critic_unresolvable"
  stageName: PipelineStageName
  userId: string
  refundCredits: number
}): Promise<void> {
  const { supabase, pipelineId, failureReason, stageName, userId, refundCredits } = args

  // 1. Refund only when caller signals there's something to refund.
  if (refundCredits > 0) {
    const { refundPipelineCredits } = await import("./credits.js")
    await refundPipelineCredits({
      supabase,
      userId,
      pipelineId,
      credits: refundCredits,
      reason: `pipeline_failed:${failureReason}`,
    })
  }

  // 2. Flip the pipeline_stages row to failed (mirrors engine.ts:255-279).
  // Without this, the stage row stays at `running` even though the pipeline
  // is `failed`, leaving the UI rendering a half-dead state.
  await supabase
    .from("pipeline_stages")
    .update({
      status: "failed",
      output: { failure_reason: failureReason },
      completed_at: new Date().toISOString(),
    })
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", stageName)

  // 3. Flip the pipeline row to failed with the typed reason.
  await supabase
    .from("pipelines")
    .update({ status: "failed", failure_reason: failureReason })
    .eq("id", pipelineId)

  // 4. Emit SSE: pipeline:status + stage:status. The `pipeline:warning` event
  // was dropped here — no frontend consumer subscribes to it, and the failure
  // surface is already covered by `pipeline:status failed` + the per-stage
  // `failure_reason` written to the pipeline_stages row.
  pipelineEvents.publish({ type: "pipeline:status", pipelineId, status: "failed" })
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName,
    status: "failed",
  })
}
