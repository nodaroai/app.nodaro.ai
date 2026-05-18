import type { SupabaseClient } from "@supabase/supabase-js"
import type { ShowrunnerPlan } from "@nodaro/shared"
import { MAX_LOCATION_VARIANTS } from "@nodaro/shared"
import { pipelineEvents } from "../events.js"
import { pipelineGenerateImage } from "../services/pipeline-generate-image.js"
import { ensureStageRow, failStage } from "../stage-utils.js"

export interface RunLocationsStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
}

/**
 * Stage 4 (Locations). Per-location:
 *  1. Generate MAIN image
 *  2. Await approval
 *  3. Generate variants from variants_needed (capped at MAX_LOCATION_VARIANTS)
 *  4. Batch approve variants
 *
 * Mirrors Stage 2 (Characters) main+variants shape, minus the voice-matcher step
 * and with location-specific variant kinds (time_of_day, weather, aftermath, angle).
 * Re-entrant: the engine driver may call this multiple times as the stage
 * progresses; the function is idempotent — it reads current state and advances
 * whatever's not yet done.
 */
export async function runLocationsStage(args: RunLocationsStageArgs): Promise<void> {
  const { supabase, pipelineId, userId } = args

  const stageId = await ensureStageRow(supabase, pipelineId, "locations", 4)

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

  // Materialize entity rows for each location (idempotent).
  for (const loc of plan.locations) {
    await supabase
      .from("pipeline_entities")
      .upsert(
        {
          pipeline_id: pipelineId,
          stage_id: stageId,
          entity_type: "location",
          entity_key: loc.key,
          status: "pending",
          metadata: {
            entity_type: "location",
            name: loc.name,
            visual_description: loc.visual_description,
            variants_needed: loc.variants_needed.slice(0, MAX_LOCATION_VARIANTS),
          },
        },
        { onConflict: "pipeline_id,entity_type,entity_key", ignoreDuplicates: true },
      )
  }

  const { data: entities } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, status, metadata, main_asset_id")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "location")
    .order("created_at", { ascending: true })

  let anyAwaiting = false
  for (const entity of entities ?? []) {
    if (entity.status === "approved") {
      await ensureLocationVariants(supabase, pipelineId, userId, entity, plan)
      continue
    }
    if (entity.status === "awaiting_approval") {
      anyAwaiting = true
      continue
    }
    if (entity.status === "pending" || entity.status === "generating" || entity.status === "rejected") {
      await generateLocationMain(supabase, pipelineId, userId, entity, plan)
      anyAwaiting = true
    }
  }

  if (anyAwaiting) return

  // Re-fetch to read latest metadata.variants_awaiting_approval after variant generation.
  // The local `entities` snapshot above is stale — reading from it would miss the
  // variants_awaiting_approval flag written by ensureLocationVariants and fall through
  // to the "all approved" branch, skipping the batch-variant approval gate entirely.
  // (Section G's stale-snapshot fix applied preemptively here.)
  const { data: refreshedEntities } = await supabase
    .from("pipeline_entities")
    .select("metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "location")
  const allVariantsAwaiting =
    (refreshedEntities ?? []).length > 0 &&
    (refreshedEntities ?? []).every(
      (e) =>
        (e.metadata as Record<string, unknown> | null)?.variants_awaiting_approval === true,
    )
  if (allVariantsAwaiting) {
    await supabase
      .from("pipeline_stages")
      .update({ status: "awaiting_approval", output: { phase: "variant_batch_approval" } })
      .eq("id", stageId)
    pipelineEvents.publish({
      type: "stage:status",
      pipelineId,
      stageName: "locations",
      status: "awaiting_approval",
    })
    return
  }

  await supabase
    .from("pipeline_stages")
    .update({ status: "approved", completed_at: new Date().toISOString() })
    .eq("id", stageId)
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "locations",
    status: "approved",
  })
}

// ─────────────────────────────────────────────────────────────────────────────

async function generateLocationMain(
  supabase: SupabaseClient,
  pipelineId: string,
  userId: string,
  entity: { id: string; entity_key: string; metadata: Record<string, unknown> | null },
  plan: ShowrunnerPlan,
): Promise<void> {
  const loc = plan.locations.find((l) => l.key === entity.entity_key)
  if (!loc) return

  await supabase
    .from("pipeline_entities")
    .update({ status: "generating" })
    .eq("id", entity.id)
  pipelineEvents.publish({
    type: "entity:status",
    pipelineId,
    entityId: entity.id,
    entityType: "location",
    entityKey: entity.entity_key,
    status: "generating",
  })

  const prompt = `${loc.visual_description}, ${plan.global_style.visual_style}, ${plan.global_style.lighting}, wide establishing shot, no people`

  try {
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
      entityType: "location",
      entityKey: entity.entity_key,
      status: "awaiting_approval",
      mainAssetUrl: assetUrl,
    })
  } catch (err) {
    await supabase
      .from("pipeline_entities")
      .update({ status: "failed" })
      .eq("id", entity.id)
    pipelineEvents.publish({
      type: "entity:status",
      pipelineId,
      entityId: entity.id,
      entityType: "location",
      entityKey: entity.entity_key,
      status: "failed",
    })
    throw err
  }
}

async function ensureLocationVariants(
  supabase: SupabaseClient,
  pipelineId: string,
  userId: string,
  entity: {
    id: string
    entity_key: string
    metadata: Record<string, unknown> | null
    main_asset_id: string | null
  },
  plan: ShowrunnerPlan,
): Promise<void> {
  const loc = plan.locations.find((l) => l.key === entity.entity_key)
  if (!loc || !entity.main_asset_id) return

  const variantsNeeded = loc.variants_needed.slice(0, MAX_LOCATION_VARIANTS)
  if (variantsNeeded.length === 0) {
    // No variants requested — mark ready.
    await supabase
      .from("pipeline_entities")
      .update({
        metadata: { ...(entity.metadata ?? {}), variants_awaiting_approval: true },
      })
      .eq("id", entity.id)
    return
  }

  const { data: existing } = await supabase
    .from("pipeline_entity_variants")
    .select("variant_key")
    .eq("entity_id", entity.id)
  const existingKeys = new Set((existing ?? []).map((v) => v.variant_key))

  // Resolve the main reference URL once — every variant uses the same image.
  const mainUrl = await assetUrlForId(supabase, entity.main_asset_id)

  for (const variant of variantsNeeded) {
    if (existingKeys.has(variant)) continue
    const kind =
      variant.includes("sun") ||
      variant.includes("night") ||
      variant.includes("dawn") ||
      variant.includes("dusk")
        ? "time_of_day"
        : variant.includes("storm") || variant.includes("rain") || variant.includes("snow")
          ? "weather"
          : variant.includes("aftermath") ||
              variant.includes("ruined") ||
              variant.includes("destroyed")
            ? "aftermath"
            : "angle"

    await supabase.from("pipeline_entity_variants").insert({
      entity_id: entity.id,
      variant_key: variant,
      variant_kind: kind,
      status: "pending",
    })
    try {
      const prompt = `${loc.visual_description}, ${variant}, ${plan.global_style.visual_style}, wide shot, no people`
      const { assetId, assetUrl } = await pipelineGenerateImage({
        supabase,
        pipelineId,
        pipelineEntityId: entity.id,
        userId,
        prompt,
        referenceImageUrls: [mainUrl],
      })
      await supabase
        .from("pipeline_entity_variants")
        .update({ asset_id: assetId, status: "approved" })
        .eq("entity_id", entity.id)
        .eq("variant_key", variant)
      pipelineEvents.publish({
        type: "entity:variant:added",
        pipelineId,
        entityId: entity.id,
        variantKey: variant,
        assetUrl,
      })
    } catch (err) {
      await supabase
        .from("pipeline_entity_variants")
        .update({ status: "failed" })
        .eq("entity_id", entity.id)
        .eq("variant_key", variant)
      // Log + continue with other variants — one failed variant shouldn't block the entity.
      console.error(
        `[locations] Failed to generate variant ${variant} for ${entity.entity_key}:`,
        err,
      )
    }
  }

  await supabase
    .from("pipeline_entities")
    .update({
      variant_count: variantsNeeded.length,
      metadata: { ...(entity.metadata ?? {}), variants_awaiting_approval: true },
    })
    .eq("id", entity.id)
}

async function assetUrlForId(supabase: SupabaseClient, assetId: string): Promise<string> {
  const { data } = await supabase.from("assets").select("r2_url").eq("id", assetId).single()
  return data?.r2_url ?? ""
}
