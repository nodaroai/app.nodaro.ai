import type { SupabaseClient } from "@supabase/supabase-js"
import { ensureStageRow, failStage } from "../stage-utils.js"
import { pipelineEvents } from "../events.js"
import { pipelineCombineVideos } from "../services/pipeline-combine-videos.js"

export interface RunPostMergeStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
}

/**
 * Stage 8 (`post_merge`). Final stage of the pipeline — concatenates every
 * approved scene's composite video into a single final MP4 and persists the
 * resulting asset id on `pipelines.final_output_asset_id` (added in
 * migration 134).
 *
 * Flow:
 *   1. Load every scene entity in canvas order.
 *   2. Extract `composite_video_url` (+ `composite_video_asset_id`) from
 *      each scene's `metadata.scene_node_data` (Stage 7 wrote these).
 *   3. Single-scene short-circuit: when the pipeline has exactly one scene,
 *      copy its composite url + asset id directly to the pipeline row —
 *      `pipelineCombineVideos` requires ≥2 inputs (route Zod check) so a
 *      single combine call would throw. Option (a) from the plan.
 *   4. Multi-scene path: call `pipelineCombineVideos` with the ordered URL
 *      list. The wrapper handles credit reservation, job creation, polling,
 *      and asset upload.
 *   5. Flip `pipelines.status='completed'` + write the asset id, mark the
 *      stage row completed (the `pipeline_stages` row DOES have `completed_at`;
 *      the `pipelines` row does NOT — see migration 121), emit
 *      `pipeline:completed`.
 *
 * On any failure: `failStage` with a structured reason. The pipeline row is
 * NOT marked completed; the engine driver leaves the pipeline at `running`
 * so the user can retry from the panel.
 */
export async function runPostMergeStage(
  args: RunPostMergeStageArgs,
): Promise<void> {
  const { supabase, pipelineId, userId } = args

  const stageId = await ensureStageRow(supabase, pipelineId, "post_merge", 8)

  // Re-entrancy guard — if the stage is already terminal, return early.
  // Mirrors Stage 6 / Stage 7's defensive pattern. `pipeline_stages.status`
  // doesn't have a 'completed' enum value (DB CHECK in migration 121); the
  // terminal success state for stages is 'approved'. The pipeline ROW
  // separately flips to 'completed'.
  const { data: existingStage } = await supabase
    .from("pipeline_stages")
    .select("status")
    .eq("id", stageId)
    .maybeSingle()
  if (existingStage?.status === "approved") {
    return
  }

  // 1. Load scene composites in canvas order.
  const { data: scenes, error: scenesErr } = await supabase
    .from("pipeline_entities")
    .select("metadata, entity_key")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")
    .order("entity_key", { ascending: true })
  if (scenesErr) {
    await failStage(supabase, stageId, `load_scenes: ${scenesErr.message}`)
    return
  }

  // 2. Extract composite_video_url + composite_video_asset_id from each scene.
  //    Drop scenes missing a composite (Stage 7 should have populated every
  //    scene; a missing one means Stage 7 was skipped or never wrote back).
  //    TODO: duration-aware combine credit reservation. The previous
  //    `upstreamDurations` plumbing here was dead code — the per-clip
  //    durations never reached `CreditsService.reserveCredits` because
  //    `runPipelineWorkerJob` reserves a fixed cost from the model
  //    identifier. Re-add once the credit path supports a per-call override.
  const sceneVideoUrls: string[] = []
  const sceneAssetIds: Array<string | null> = []
  for (const scene of scenes ?? []) {
    const sceneNodeData = (scene.metadata as Record<string, unknown> | null)
      ?.scene_node_data as
      | {
          composite_video_url?: string
          composite_video_asset_id?: string
        }
      | undefined
    const url = sceneNodeData?.composite_video_url
    if (!url) continue
    sceneVideoUrls.push(url)
    sceneAssetIds.push(sceneNodeData?.composite_video_asset_id ?? null)
  }
  if (sceneVideoUrls.length === 0) {
    await failStage(supabase, stageId, "no_scene_videos")
    return
  }

  // 3. Compute the final asset id + url.
  //
  // Single-scene short-circuit (option a from the plan): pipelineCombineVideos
  // requires ≥2 inputs (the route Zod schema enforces this), so a 1-scene
  // pipeline can't be sent through combine — instead we copy the lone scene's
  // composite url + asset id straight to pipelines.final_output_asset_id.
  // This keeps single-scene pipelines completable without an extra FFmpeg
  // round-trip.
  let finalAssetId: string | null
  let finalAssetUrl: string
  if (sceneVideoUrls.length === 1) {
    finalAssetId = sceneAssetIds[0] ?? null
    finalAssetUrl = sceneVideoUrls[0]!
  } else {
    try {
      const result = await pipelineCombineVideos({
        supabase,
        pipelineId,
        // No pipelineEntityId — Stage 8's output is the pipeline-level final
        // asset, not tied to any individual SceneNode entity. The wrapper
        // skips the assets.pipeline_entity_id update when this is undefined.
        userId,
        videoUrls: sceneVideoUrls,
      })
      finalAssetId = result.assetId
      finalAssetUrl = result.assetUrl
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[post-merge] combine_videos failed for pipeline ${pipelineId}:`, msg)
      await failStage(supabase, stageId, `combine_failed: ${msg}`)
      return
    }
  }

  // 4. Persist final asset on the pipeline row + flip status to completed.
  //    Note: the `pipelines` table does NOT have a `completed_at` column
  //    (migration 121). Only `pipeline_stages` does. PostgREST silently 400s
  //    the entire UPDATE if we include an unknown column — we explicitly
  //    check the error result below so future schema mismatches surface as a
  //    stage failure rather than silent data loss.
  const completedAt = new Date().toISOString()
  const { error: pipelineUpdateErr } = await supabase
    .from("pipelines")
    .update({
      final_output_asset_id: finalAssetId,
      status: "completed",
    })
    .eq("id", pipelineId)
  if (pipelineUpdateErr) {
    console.error(
      `[stage:post_merge] pipelines update failed for ${pipelineId}:`,
      pipelineUpdateErr.message,
    )
    return failStage(
      supabase,
      stageId,
      `pipelines_update_failed: ${pipelineUpdateErr.message}`,
    )
  }

  // 5. Mark the stage approved (terminal success state per the DB CHECK —
  //    pipeline_stages has no 'completed' enum value; only pipeline ROW does).
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

  // 6. Emit the pipeline:completed lifecycle event. The companion
  //    pipeline:status='completed' event would normally fire from the engine
  //    driver's fallback branch on next drive; emit it here too so consumers
  //    closing on either signal see a clean shutdown without an extra
  //    drivePipeline round-trip.
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
}
