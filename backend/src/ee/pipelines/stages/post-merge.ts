import type { SupabaseClient } from "@supabase/supabase-js"
import { ensureStageRow, failStage } from "../stage-utils.js"
import { pipelineEvents } from "../events.js"

export interface RunPostMergeStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
}

/**
 * Stage 8 (`post_merge`). PURE APPROVAL GATE — Phase 1C.2 J1.
 *
 * The concat work moved to Stage 7 (animate_audio_edit) in I2 — Stage 7 now
 * calls `pipelineFinalMerge` at the end of its per-scene loop and writes
 * `pipelines.final_output_asset_id`. Stage 8 reads that field and decides:
 *
 *   - `pipelines.mode = 'auto'`  → flip status=completed immediately +
 *                                   emit `pipeline:completed`.
 *   - `pipelines.mode = 'manual' | 'guided'` → set the stage row to
 *                                   `awaiting_approval` with the asset URL
 *                                   in `output.final_output_url`. The
 *                                   existing `POST /v1/pipelines/:id/stages/
 *                                   post_merge/approve` endpoint (from 1A)
 *                                   flips `pipelines.status='completed'`
 *                                   on user approval.
 *
 * Failure modes:
 *   - Stage 7 didn't write `final_output_asset_id` → fail with
 *     `final_output_missing`. This indicates the per-scene loop completed
 *     but `pipelineFinalMerge` was either skipped or its result wasn't
 *     persisted on the pipeline row. The user can retry from the panel.
 *
 * `pipelines.mode` is a top-level column on the pipelines table (CHECK
 * constraint in migration 121 line 17: `mode IN ('manual', 'auto',
 * 'guided')`). Reading from the column is preferred over `config.mode`.
 */
export async function runPostMergeStage(
  args: RunPostMergeStageArgs,
): Promise<void> {
  const { supabase, pipelineId } = args

  const stageId = await ensureStageRow(supabase, pipelineId, "post_merge", 8)

  // Re-entrancy guard — once the stage is terminal (approved → user
  // approved; failed → user retry). Mirrors the pattern in every other
  // stage runner.
  const { data: existingStage } = await supabase
    .from("pipeline_stages")
    .select("status")
    .eq("id", stageId)
    .maybeSingle()
  if (existingStage?.status === "approved") {
    return
  }
  // If we're already awaiting_approval, idempotency: re-emit nothing, the
  // existing approve route will drive completion.
  if (existingStage?.status === "awaiting_approval") {
    return
  }

  // 1. Read final_output_asset_id + mode off the pipelines row.
  const { data: pipeline, error: pipelineErr } = await supabase
    .from("pipelines")
    .select("final_output_asset_id, mode")
    .eq("id", pipelineId)
    .single()
  if (pipelineErr || !pipeline) {
    await failStage(
      supabase,
      stageId,
      `pipeline_load_failed: ${pipelineErr?.message ?? "no row"}`,
    )
    return
  }

  const finalAssetId = (pipeline as { final_output_asset_id: string | null })
    .final_output_asset_id
  if (!finalAssetId) {
    await failStage(supabase, stageId, "final_output_missing")
    return
  }

  // Resolve the asset URL so we can include it in either the awaiting_approval
  // output OR the pipeline:completed event payload.
  const { data: asset, error: assetErr } = await supabase
    .from("assets")
    .select("r2_url")
    .eq("id", finalAssetId)
    .single()
  if (assetErr || !asset) {
    await failStage(
      supabase,
      stageId,
      `asset_load_failed: ${assetErr?.message ?? "no row"}`,
    )
    return
  }
  const finalAssetUrl = (asset as { r2_url: string }).r2_url

  const mode = ((pipeline as { mode?: string }).mode ?? "manual") as
    | "manual"
    | "auto"
    | "guided"
  const completedAt = new Date().toISOString()

  if (mode === "auto") {
    // Auto-advance — no user approval needed. Flip status=completed +
    // emit completion event.
    const { error: pipelineUpdateErr } = await supabase
      .from("pipelines")
      .update({ status: "completed" })
      .eq("id", pipelineId)
    if (pipelineUpdateErr) {
      await failStage(
        supabase,
        stageId,
        `pipelines_update_failed: ${pipelineUpdateErr.message}`,
      )
      return
    }
    await supabase
      .from("pipeline_stages")
      .update({
        status: "approved",
        completed_at: completedAt,
        output: {
          final_output_url: finalAssetUrl,
          final_output_asset_id: finalAssetId,
        },
      })
      .eq("id", stageId)

    pipelineEvents.publish({
      type: "stage:status",
      pipelineId,
      stageName: "post_merge",
      status: "approved",
    })
    pipelineEvents.publish({
      type: "pipeline:status",
      pipelineId,
      status: "completed",
    })
    pipelineEvents.publish({
      type: "pipeline:completed",
      pipelineId,
      finalOutputAssetId: finalAssetId,
      finalOutputUrl: finalAssetUrl,
    })
    return
  }

  // Manual + Guided — pause at awaiting_approval. The user clicks Approve
  // in the panel; the existing `/v1/pipelines/:id/stages/post_merge/approve`
  // endpoint flips `pipelines.status='completed'` + emits the completion
  // event.
  await supabase
    .from("pipeline_stages")
    .update({
      status: "awaiting_approval",
      output: {
        final_output_url: finalAssetUrl,
        final_output_asset_id: finalAssetId,
      },
    })
    .eq("id", stageId)

  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "post_merge",
    status: "awaiting_approval",
  })
}
