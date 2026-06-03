import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineConfig, ShowrunnerPlan } from "@nodaro/shared"
import { resolvePipelineModel } from "@nodaro/shared"
import { pipelineEvents } from "../events.js"
import { pipelineGenerateImage } from "../services/pipeline-generate-image.js"
import {
  bulkApproveStageEntities,
  ensureStageRow,
  failStage,
  recoverFailedEntitiesToChoose,
  rejectFeedbackSuffix,
} from "../stage-utils.js"
import { transitionEntityNodeAndEmit } from "../depends-on.js"
import { emitDependentStaleEvents } from "../entity-approval.js"

export interface RunObjectsStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
  /**
   * Phase 1D.2a §4.1 (G2): when `"auto"`, the stage skips the per-object
   * approval gate — it bulk-flips every object entity from `awaiting_approval`
   * → `approved`, batches the matching `pipeline_entity_nodes` rows from
   * `pipeline_owned_awaiting_approval` → `pipeline_owned_approved`, marks the
   * stage row `approved`, emits the `stage:status approved` SSE, and
   * re-enqueues the orchestrator with `reason: "stage_advance"`.
   *
   * Defaults to `"manual"` so existing callers (and tests) keep the prior
   * behavior: stop after generation so the user approves each object.
   */
  mode?: "manual" | "auto" | "guided"
  /** Pipeline `config` row; resolved via `resolvePipelineModel(config, "objects_image")` to pick the entity image model. */
  config?: Partial<PipelineConfig> | null
}

/**
 * Stage 3 (Objects). For each object: generate one reference image, batch-approval.
 * Simpler than Stage 2 — no variants, no voice match.
 */
export async function runObjectsStage(args: RunObjectsStageArgs): Promise<void> {
  const { supabase, pipelineId, userId } = args
  const userOverride = resolvePipelineModel(args.config, "objects_image")

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

  // Mark the stage active so the studio breadcrumb highlights "Props" while the
  // user is at the gate (mirrors characters.ts — without a running/awaiting
  // stage:status the tracker can't tell which step we're on). Auto mode emits
  // `approved` below; this just covers the manual/guided pause window.
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "objects",
    status: "running",
  })

  // Materialize. New objects start at `pending_description` so manual/guided
  // pipelines pause for the user's Step A choice (edit the prompt / Generate /
  // Upload / Reuse / Skip) BEFORE any credits are spent — mirrors Stage 2
  // (characters). Auto mode bulk-flips them to `pending` just below so the
  // existing parallel-gen flow runs unattended.
  for (const obj of plan.objects) {
    await supabase
      .from("pipeline_entities")
      .upsert(
        {
          pipeline_id: pipelineId,
          stage_id: stageId,
          entity_type: "object",
          entity_key: obj.key,
          status: "pending_description",
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

  // Auto mode short-circuits the Step A wizard: flip every freshly-inserted
  // `pending_description` object to `pending` so the generation loop below
  // picks them up exactly as before. Manual/guided pause at the gate.
  if (args.mode === "auto") {
    await supabase
      .from("pipeline_entities")
      .update({ status: "pending" })
      .eq("pipeline_id", pipelineId)
      .eq("entity_type", "object")
      .eq("status", "pending_description")
  }

  // Generate where needed.
  const { data: entities } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, status, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "object")
    .order("created_at", { ascending: true })

  // Failed objects go back to the choose-gate (holds the stage open + lets the
  // user edit / regenerate / upload / reuse / skip). Auto: no-op.
  const recovered = await recoverFailedEntitiesToChoose(
    supabase,
    pipelineId,
    "object",
    entities ?? [],
    args.mode,
  )

  let anyGenerating = false
  for (const entity of recovered) {
    // Only `pending` / `generating` get (re)generated. `pending_description`
    // waits for the user's Step A choice (the stage pauses below); approved /
    // awaiting_approval / skipped / failed are already resolved or user-owned.
    if (entity.status !== "pending" && entity.status !== "generating") continue
    const obj = plan.objects.find((o) => o.key === entity.entity_key)
    if (!obj) continue
    await supabase
      .from("pipeline_entities")
      .update({ status: "generating" })
      .eq("id", entity.id)
    anyGenerating = true
    try {
      const prompt = `${obj.visual_description}, ${plan.global_style.visual_style}, ${plan.global_style.lighting}, product/object photograph, isolated on neutral background${rejectFeedbackSuffix(entity.metadata)}`
      const { assetId, assetUrl } = await pipelineGenerateImage({
        supabase,
        pipelineId,
        pipelineEntityId: entity.id,
        userId,
        prompt,
        userOverride,
      })
      await supabase
        .from("pipeline_entities")
        .update({ main_asset_id: assetId, status: "awaiting_approval" })
        .eq("id", entity.id)
      // Phase 1B.4 (C1): the main_asset_id change fires the cascade-staleness
      // trigger (migration 131). Surface the resulting `is_stale` flips to SSE
      // subscribers — `emitDependentStaleEvents` is failure-tolerant and never
      // throws, the trigger already wrote the truth.
      await emitDependentStaleEvents(supabase, pipelineId, entity.id)
      // Phase 1B.4 (D1): canvas-node flips to `awaiting_approval`. No-op when
      // the entity has no pipeline_entity_nodes row yet.
      await transitionEntityNodeAndEmit(
        supabase,
        pipelineId,
        entity.id,
        "pipeline_owned_awaiting_approval",
        "objects",
      )
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

  if (anyGenerating) {
    // Phase 1D.2a §4.1 (G2): auto-mode short-circuits the per-object
    // approval gate — bulk-flip every object entity from `awaiting_approval`
    // → `approved` (plus their canvas nodes), mark the stage row `approved`,
    // emit the matching SSE, and re-enqueue the orchestrator for the next
    // stage. Manual/guided modes fall through to the existing pause.
    if (args.mode === "auto") {
      await autoApproveObjectsStage(supabase, pipelineId, userId, stageId)
      return
    }
    return // pause for user approval
  }

  // Every object resolved? Skipped objects (user opted out at the Step A gate)
  // count as resolved — they don't block the stage from advancing. Anything
  // still at `pending_description` / `awaiting_approval` keeps the stage paused.
  const allResolved = recovered.every(
    (e) => e.status === "approved" || e.status === "skipped",
  )
  if (!allResolved) {
    // Phase 1D.2a §4.1 (G2): on a re-entrant pass (no fresh generation, but
    // entities still sitting at `awaiting_approval`) auto-mode advances the
    // stage. Manual/guided modes pause until the user approves each card.
    if (args.mode === "auto") {
      await autoApproveObjectsStage(supabase, pipelineId, userId, stageId)
    }
    return
  }

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
  // Drive the next stage. Manual mode previously marked the stage approved
  // here but never re-enqueued, so the pipeline stalled at
  // `objects approved / current_stage=NULL` — the lost-wakeup. enqueue both
  // stamps the redrive latch and adds the job; driveWithRedriveLatch coalesces
  // the dedup'd add() from inside this active drive into one more drive that
  // advances to locations. (Auto mode already did this via autoApproveObjectsStage.)
  const { enqueuePipelineRun } = await import("../queue.js")
  await enqueuePipelineRun({ pipelineId, userId, reason: "stage_advance" })
}

/**
 * Phase 1D.2a §4.1 (G2): bulk-approve every `awaiting_approval` object entity
 * for `pipelineId`, batch-flip the matching `pipeline_entity_nodes` rows from
 * `pipeline_owned_awaiting_approval` → `pipeline_owned_approved`, flip the
 * stage row to `approved`, emit the `stage:status approved` SSE, and
 * re-enqueue the orchestrator with `reason: "stage_advance"` so the next
 * stage picks up. Idempotent — safe to call multiple times in the same
 * pass.
 */
async function autoApproveObjectsStage(
  supabase: SupabaseClient,
  pipelineId: string,
  userId: string,
  stageId: string,
): Promise<void> {
  await bulkApproveStageEntities(supabase, pipelineId, "object", "objects")
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
  const { enqueuePipelineRun } = await import("../queue.js")
  await enqueuePipelineRun({ pipelineId, userId, reason: "stage_advance" })
}

