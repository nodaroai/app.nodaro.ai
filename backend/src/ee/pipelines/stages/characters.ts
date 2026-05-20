import type { SupabaseClient } from "@supabase/supabase-js"
import type { ShowrunnerPlan } from "@nodaro/shared"
import {
  DEFAULT_CHARACTER_ANGLE_COUNT,
  DEFAULT_CHARACTER_EXPRESSION_COUNT,
} from "@nodaro/shared"
import { pipelineEvents } from "../events.js"
import { runVoiceMatcher } from "../llms/voice-matcher.js"
import { pipelineGenerateImage } from "../services/pipeline-generate-image.js"
import { bulkApproveStageEntities, ensureStageRow, failStage } from "../stage-utils.js"
import {
  transitionEntityNodeAndEmit,
  transitionStageEntityNodesAndEmit,
} from "../depends-on.js"
import { emitDependentStaleEvents } from "../entity-approval.js"

export interface RunCharactersStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
  /**
   * Phase 1D.2a §4.1 (G1): when `"auto"`, the stage skips the
   * batch-variant approval gate — it bulk-flips every character entity from
   * `awaiting_approval` → `approved`, batches the matching
   * `pipeline_entity_nodes` rows from `pipeline_owned_awaiting_approval` →
   * `pipeline_owned_approved`, marks the stage row `approved`, emits the
   * `stage:status approved` SSE, and re-enqueues the orchestrator with
   * `reason: "stage_advance"` so the next stage picks up.
   *
   * Defaults to `"manual"` so existing callers (and tests) keep the prior
   * behavior: pause at `awaiting_approval` for user approval.
   */
  mode?: "manual" | "auto" | "guided"
}

/**
 * Stage 2 (Characters). For each cast member from ShowrunnerPlan:
 *  1. Insert pipeline_entities row (status='pending')
 *  2. Generate main image (and voice match if has_dialogue)
 *  3. Transition to 'awaiting_approval' — pause for user
 *  4. After each user approval, generate angle + expression variants
 *  5. When all entities are approved AND have their variant counts, transition stage to 'awaiting_approval'
 *     for the batch-variants approval gate.
 *
 * This orchestrator is RE-ENTRANT: the engine driver may call runCharactersStage multiple
 * times as the stage progresses. The function is idempotent — it reads current state and
 * advances whatever's not yet done.
 */
export async function runCharactersStage(args: RunCharactersStageArgs): Promise<void> {
  const { supabase, pipelineId, userId } = args

  // 1. Ensure stage row exists.
  const stageId = await ensureStageRow(supabase, pipelineId, "characters", 2)

  // 2. Load ShowrunnerPlan from Stage 1 output.
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

  // 3. Materialize entity rows for each cast member (idempotent).
  for (const cast of plan.cast) {
    await ensureCharacterEntity(supabase, pipelineId, stageId, cast)
  }

  // 4. Process each entity in turn.
  const { data: entities } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, status, metadata, main_asset_id")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "character")
    .order("created_at", { ascending: true })

  let anyAwaiting = false
  for (const entity of entities ?? []) {
    if (entity.status === "approved") {
      // Ensure variants are generated.
      await ensureCharacterVariants(supabase, pipelineId, userId, entity, plan)
      continue
    }
    if (entity.status === "awaiting_approval") {
      anyAwaiting = true
      continue
    }
    if (entity.status === "rejected") {
      // Rejected with feedback — regenerate main.
      await generateCharacterMain(supabase, pipelineId, stageId, userId, entity, plan)
      anyAwaiting = true
      continue
    }
    if (entity.status === "pending" || entity.status === "generating") {
      await generateCharacterMain(supabase, pipelineId, stageId, userId, entity, plan)
      anyAwaiting = true
    }
  }

  if (anyAwaiting) {
    // Phase 1D.2a §4.1 (G1): auto-mode short-circuits the FIRST per-entity
    // approval gate — bulk-flip every character entity from
    // `awaiting_approval` → `approved` (plus their canvas nodes) and
    // re-enqueue the orchestrator so the next iteration runs
    // `ensureCharacterVariants` against the approved entities. Manual/guided
    // modes fall through to the existing pause.
    if (args.mode === "auto") {
      await bulkApproveStageEntities(supabase, pipelineId, "character", "characters")
      const { enqueuePipelineRun } = await import("../queue.js")
      await enqueuePipelineRun({ pipelineId, userId, reason: "stage_advance" })
      return
    }
    // Pause for user — stage stays 'running'; per-entity awaiting_approval gates surface in panel.
    return
  }

  // 5. All entities approved + variants generated → batch-approval gate for the variants.
  // Re-fetch entities to read latest metadata.variants_awaiting_approval written by
  // ensureCharacterVariants above. The local `entities` snapshot from step 4 is stale —
  // reading from it would miss the variants_awaiting_approval flag and fall through to
  // the "all approved" branch, skipping the batch-variant approval gate entirely.
  const { data: refreshedEntities } = await supabase
    .from("pipeline_entities")
    .select("metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "character")
  const allVariantsAwaiting =
    (refreshedEntities ?? []).length > 0 &&
    (refreshedEntities ?? []).every(
      (e) =>
        (e.metadata as Record<string, unknown> | null)?.variants_awaiting_approval === true,
    )
  if (allVariantsAwaiting) {
    // Phase 1D.2a §4.1 (G1): auto-mode short-circuits the batch-variant
    // approval gate — bulk-flip every entity + canvas node to `approved`,
    // mark the stage row `approved`, emit the matching SSE, and re-enqueue
    // the orchestrator for the next stage. Manual/guided modes fall through
    // to the existing `awaiting_approval` pause.
    if (args.mode === "auto") {
      await bulkApproveStageEntities(supabase, pipelineId, "character", "characters")
      await supabase
        .from("pipeline_stages")
        .update({ status: "approved", completed_at: new Date().toISOString() })
        .eq("id", stageId)
      pipelineEvents.publish({
        type: "stage:status",
        pipelineId,
        stageName: "characters",
        status: "approved",
      })
      const { enqueuePipelineRun } = await import("../queue.js")
      await enqueuePipelineRun({ pipelineId, userId, reason: "stage_advance" })
      return
    }

    // Manual / guided modes: transition stage to 'awaiting_approval' for the
    // batch variant gate (existing behavior — unchanged).
    await supabase
      .from("pipeline_stages")
      .update({ status: "awaiting_approval", output: { phase: "variant_batch_approval" } })
      .eq("id", stageId)
    // Phase 1B.4 (D1): batch-flip every materialized character canvas node to
    // `awaiting_approval` in a single UPDATE. Per-entity state_change events
    // follow so the UI animates each card individually.
    await transitionStageEntityNodesAndEmit(
      supabase,
      pipelineId,
      "character",
      "pipeline_owned_awaiting_approval",
      "characters",
    )
    pipelineEvents.publish({
      type: "stage:status",
      pipelineId,
      stageName: "characters",
      status: "awaiting_approval",
    })
    return
  }

  // 6. Variants approved → advance stage.
  await supabase
    .from("pipeline_stages")
    .update({
      status: "approved",
      completed_at: new Date().toISOString(),
    })
    .eq("id", stageId)
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "characters",
    status: "approved",
  })
}

// ─────────────────────────────────────────────────────────────────────────────

async function ensureCharacterEntity(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  cast: ShowrunnerPlan["cast"][number],
): Promise<void> {
  await supabase
    .from("pipeline_entities")
    .upsert(
      {
        pipeline_id: pipelineId,
        stage_id: stageId,
        entity_type: "character",
        entity_key: cast.key,
        status: "pending",
        metadata: {
          entity_type: "character",
          name: cast.name,
          visual_description: cast.visual_description,
          role: cast.role,
          estimated_screen_time_shots: 0, // filled in Stage 5
          has_dialogue: cast.has_dialogue,
          voice_profile: cast.voice_profile,
          angle_count: cast.angle_count_hint ?? DEFAULT_CHARACTER_ANGLE_COUNT,
        },
      },
      { onConflict: "pipeline_id,entity_type,entity_key", ignoreDuplicates: true },
    )
}

async function generateCharacterMain(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  userId: string,
  entity: { id: string; entity_key: string; metadata: Record<string, unknown> | null },
  plan: ShowrunnerPlan,
): Promise<void> {
  const cast = plan.cast.find((c) => c.key === entity.entity_key)
  if (!cast) {
    await supabase
      .from("pipeline_entities")
      .update({ status: "failed" })
      .eq("id", entity.id)
    return
  }
  await supabase
    .from("pipeline_entities")
    .update({ status: "generating" })
    .eq("id", entity.id)
  pipelineEvents.publish({
    type: "entity:status",
    pipelineId,
    entityId: entity.id,
    entityType: "character",
    entityKey: entity.entity_key,
    status: "generating",
  })

  // Image prompt: visual_description + global style (read from plan).
  const prompt = `${cast.visual_description}, ${plan.global_style.visual_style}, ${plan.global_style.lighting}, portrait, neutral expression, front-facing`

  try {
    const { assetId, assetUrl } = await pipelineGenerateImage({
      supabase,
      pipelineId,
      pipelineEntityId: entity.id,
      userId,
      prompt,
    })
    // Voice match if dialogue-bearing. Non-fatal — the actual voice
    // selection isn't consumed until Stage 7 (audio). Failing Stage 2 on a
    // voice-matcher error would lose the just-completed image generation
    // and block the whole pipeline; instead we log the error onto entity
    // metadata for the user/admin to retrigger later and proceed.
    let voiceMatchMeta: unknown = undefined
    let voiceMatchError: string | undefined = undefined
    if (cast.has_dialogue) {
      try {
        voiceMatchMeta = await runVoiceMatcher({
          supabase,
          pipelineId,
          stageId,
          userId,
          castKey: cast.key,
          castName: cast.name,
          visualDescription: cast.visual_description,
          voiceProfile: cast.voice_profile,
        })
      } catch (err) {
        voiceMatchError = err instanceof Error ? err.message : String(err)
        console.error(
          `[characters] voice-matcher failed for ${cast.key} (pipeline=${pipelineId}); proceeding without voice assignment:`,
          voiceMatchError,
        )
      }
    }
    await supabase
      .from("pipeline_entities")
      .update({
        main_asset_id: assetId,
        status: "awaiting_approval",
        metadata: {
          ...(entity.metadata ?? {}),
          voice_match: voiceMatchMeta,
          ...(voiceMatchError ? { voice_match_error: voiceMatchError } : {}),
        },
      })
      .eq("id", entity.id)
    // Phase 1B.4 (C1): cascade-staleness trigger fires on main_asset_id change.
    await emitDependentStaleEvents(supabase, pipelineId, entity.id)
    // Phase 1B.4 (D1): canvas node → awaiting_approval (no-op when no row yet).
    await transitionEntityNodeAndEmit(
      supabase,
      pipelineId,
      entity.id,
      "pipeline_owned_awaiting_approval",
      "characters",
    )
    pipelineEvents.publish({
      type: "entity:status",
      pipelineId,
      entityId: entity.id,
      entityType: "character",
      entityKey: entity.entity_key,
      status: "awaiting_approval",
      mainAssetUrl: assetUrl,
    })
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err)
    console.error(
      `[characters] generateCharacterMain failed for ${entity.entity_key} (pipeline=${pipelineId}):`,
      errMessage,
    )
    await supabase
      .from("pipeline_entities")
      .update({
        status: "failed",
        metadata: {
          ...(entity.metadata ?? {}),
          last_error: errMessage,
          last_error_at: new Date().toISOString(),
        },
      })
      .eq("id", entity.id)
    pipelineEvents.publish({
      type: "entity:status",
      pipelineId,
      entityId: entity.id,
      entityType: "character",
      entityKey: entity.entity_key,
      status: "failed",
    })
    throw err
  }
}

async function ensureCharacterVariants(
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
  const cast = plan.cast.find((c) => c.key === entity.entity_key)
  if (!cast || !entity.main_asset_id) return

  // Check existing variants.
  const { data: existingVariants } = await supabase
    .from("pipeline_entity_variants")
    .select("variant_key")
    .eq("entity_id", entity.id)

  const existingKeys = new Set((existingVariants ?? []).map((v) => v.variant_key))

  // Decide what to generate.
  const angleCount = cast.angle_count_hint ?? DEFAULT_CHARACTER_ANGLE_COUNT
  const expressions: readonly string[] =
    cast.expression_set_hint.length > 0
      ? [...cast.expression_set_hint]
      : (["neutral", "smiling"].slice(0, DEFAULT_CHARACTER_EXPRESSION_COUNT) as readonly string[])

  // Angle variants (profile, three_quarter, full_body, etc — generic labels).
  const angleLabels = ["profile", "three_quarter", "full_body"].slice(0, Math.max(0, angleCount - 1))
  const variantsToGen: Array<{ key: string; kind: "angle" | "expression"; prompt: string }> = []
  for (const angle of angleLabels) {
    const key = `angle_${angle}`
    if (existingKeys.has(key)) continue
    variantsToGen.push({
      key,
      kind: "angle",
      prompt: `${cast.visual_description}, ${plan.global_style.visual_style}, ${angle} angle, neutral expression`,
    })
  }
  for (const expr of expressions) {
    const key = `expression_${expr}`
    if (existingKeys.has(key)) continue
    variantsToGen.push({
      key,
      kind: "expression",
      prompt: `${cast.visual_description}, ${plan.global_style.visual_style}, ${expr} expression, front-facing`,
    })
  }

  if (variantsToGen.length === 0) {
    // All variants present — mark entity's metadata so the stage knows.
    await supabase
      .from("pipeline_entities")
      .update({
        variant_count: existingKeys.size,
        metadata: {
          ...(entity.metadata ?? {}),
          variants_awaiting_approval: true,
        },
      })
      .eq("id", entity.id)
    return
  }

  // Resolve the main reference URL once — every variant uses the same image.
  const mainUrl = entity.main_asset_id
    ? await assetUrlForId(supabase, entity.main_asset_id)
    : ""

  // Generate sequentially (cheap parallelism risk: voice/credit reservation could spike).
  for (const v of variantsToGen) {
    const { error: insertErr } = await supabase
      .from("pipeline_entity_variants")
      .insert({
        entity_id: entity.id,
        variant_key: v.key,
        variant_kind: v.kind,
        status: "pending",
      })
    if (insertErr && !insertErr.message.includes("duplicate")) throw insertErr
    try {
      const { assetId, assetUrl } = await pipelineGenerateImage({
        supabase,
        pipelineId,
        pipelineEntityId: entity.id,
        userId,
        prompt: v.prompt,
        referenceImageUrls: mainUrl ? [mainUrl] : undefined,
      })
      await supabase
        .from("pipeline_entity_variants")
        .update({ asset_id: assetId, status: "approved" })
        .eq("entity_id", entity.id)
        .eq("variant_key", v.key)
      pipelineEvents.publish({
        type: "entity:variant:added",
        pipelineId,
        entityId: entity.id,
        variantKey: v.key,
        assetUrl,
      })
    } catch (err) {
      await supabase
        .from("pipeline_entity_variants")
        .update({ status: "failed" })
        .eq("entity_id", entity.id)
        .eq("variant_key", v.key)
      // Log + continue with other variants — one failed variant shouldn't block the entity.
      console.error(`[characters] Failed to generate variant ${v.key} for ${entity.entity_key}:`, err)
    }
  }

  // Update entity metadata once all variants attempted.
  await supabase
    .from("pipeline_entities")
    .update({
      variant_count: variantsToGen.length + existingKeys.size,
      metadata: {
        ...(entity.metadata ?? {}),
        variants_awaiting_approval: true,
      },
    })
    .eq("id", entity.id)
}

async function assetUrlForId(supabase: SupabaseClient, assetId: string): Promise<string> {
  const { data } = await supabase.from("assets").select("r2_url").eq("id", assetId).single()
  return data?.r2_url ?? ""
}
