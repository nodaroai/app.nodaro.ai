import type { SupabaseClient } from "@supabase/supabase-js"
import type { ShowrunnerPlan } from "@nodaro/shared"
import { pipelineEvents } from "../events.js"
import { pipelineGenerateImage } from "../services/pipeline-generate-image.js"
import { ensureStageRow, failStage } from "../stage-utils.js"

export interface RunObjectsStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
}

/**
 * Stage 3 (Objects). For each object: generate one reference image, batch-approval.
 * Simpler than Stage 2 — no variants, no voice match.
 */
export async function runObjectsStage(args: RunObjectsStageArgs): Promise<void> {
  const { supabase, pipelineId, userId } = args

  const stageId = await ensureStageRow(supabase, pipelineId, "objects", 3)

  const { data: scriptStage } = await supabase
    .from("pipeline_stages")
    .select("output")
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", "script")
    .single()
  const plan: ShowrunnerPlan | undefined = (scriptStage?.output as { plan?: ShowrunnerPlan })?.plan
  if (!plan) {
    await failStage(supabase, stageId, "showrunner_plan_missing")
    return
  }

  // Materialize.
  for (const obj of plan.objects) {
    await supabase
      .from("pipeline_entities")
      .upsert(
        {
          pipeline_id: pipelineId,
          stage_id: stageId,
          entity_type: "object",
          entity_key: obj.key,
          status: "pending",
          metadata: {
            entity_type: "object",
            name: obj.name,
            visual_description: obj.visual_description,
            narrative_significance: obj.narrative_significance,
            scenes_present: [],
          },
        },
        { onConflict: "pipeline_id,entity_type,entity_key", ignoreDuplicates: true },
      )
  }

  // Generate where needed.
  const { data: entities } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, status, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "object")
    .order("created_at", { ascending: true })

  let anyGenerating = false
  for (const entity of entities ?? []) {
    if (entity.status === "approved" || entity.status === "awaiting_approval") continue
    const obj = plan.objects.find((o) => o.key === entity.entity_key)
    if (!obj) continue
    await supabase
      .from("pipeline_entities")
      .update({ status: "generating" })
      .eq("id", entity.id)
    anyGenerating = true
    try {
      const prompt = `${obj.visual_description}, ${plan.global_style.visual_style}, ${plan.global_style.lighting}, product/object photograph, isolated on neutral background`
      const { assetId, assetUrl } = await pipelineGenerateImage({
        supabase,
        pipelineId,
        pipelineEntityId: entity.id,
        userId,
        prompt,
      })
      await supabase
        .from("pipeline_entities")
        .update({ main_asset_id: assetId, status: "awaiting_approval" })
        .eq("id", entity.id)
      pipelineEvents.publish({
        type: "entity:status",
        pipelineId,
        entityId: entity.id,
        entityType: "object",
        entityKey: entity.entity_key,
        status: "awaiting_approval",
        mainAssetUrl: assetUrl,
      })
    } catch (err) {
      await supabase
        .from("pipeline_entities")
        .update({ status: "failed" })
        .eq("id", entity.id)
      console.error(`[objects] Failed to generate ${entity.entity_key}:`, err)
    }
  }

  if (anyGenerating) return // pause for user approval

  // Check if any still awaiting.
  const allApproved = (entities ?? []).every((e) => e.status === "approved")
  if (!allApproved) return

  // All approved → advance stage.
  await supabase
    .from("pipeline_stages")
    .update({ status: "approved", completed_at: new Date().toISOString() })
    .eq("id", stageId)
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "objects",
    status: "approved",
  })
}

