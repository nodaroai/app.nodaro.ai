/**
 * Phase 1D.3 — branchPipeline cloning service.
 *
 * Clones a completed pipeline's upstream stages and entities into a new
 * `pipelines` row and enqueues it to re-run from the branch stage. Per spec
 * §5.9:
 *   - Upstream stages (stage_order < branch.stage_order) clone as 'approved'.
 *   - The branch stage itself starts as 'running'.
 *   - Downstream stages are NOT cloned (created by the orchestrator as it
 *     advances).
 *   - Asset rows are NOT duplicated — new `pipeline_entities` rows reference
 *     the same `main_asset_id` / `last_frame_asset_id` values (assets are
 *     content-addressed by R2 path; safe to share across pipelines).
 *   - `pipeline_chat_turns` (Phase 1D.2) explicitly do NOT clone per spec
 *     line 721 — the branched pipeline starts each chat-enabled stage fresh.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { PIPELINE_STAGE_NAMES, type PipelineStageName } from "@nodaro/shared"

// Re-export so callers have one import point.
export { PIPELINE_STAGE_NAMES, type PipelineStageName }

// Ordered list (index + 1 = stage_order in DB).
const STAGE_ORDER = PIPELINE_STAGE_NAMES

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BranchPipelineArgs {
  supabase: SupabaseClient
  originalPipelineId: string
  fromStage: PipelineStageName
  userId: string
}

export interface BranchPipelineResult {
  newPipelineId: string
  clonedStages: readonly PipelineStageName[]
  clonedEntities: number
}

export class BranchPipelineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "BranchPipelineError"
  }
}

// ---------------------------------------------------------------------------
// Entity types to clone per branch stage (spec §5.9 table)
//
// "branch FROM <stage>" means <stage> is re-run; anything produced by stages
// *before* it must be present in the new pipeline so the stage handler can
// reference it.
// ---------------------------------------------------------------------------

const ENTITY_BY_STAGE: Record<PipelineStageName, readonly string[]> = {
  script: [],
  characters: [], // characters stage re-runs; nothing to carry forward yet
  objects: ["character"],
  locations: ["character", "object"],
  shot_list: ["character", "object", "location"],
  // scenes were created by shot_list; carry them so scene_images can work with them
  scene_images: ["character", "object", "location", "scene"],
  animate_audio_edit: ["character", "object", "location", "scene"],
  post_merge: ["character", "object", "location", "scene"],
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

export async function branchPipeline(
  args: BranchPipelineArgs,
): Promise<BranchPipelineResult> {
  const { supabase, originalPipelineId, fromStage, userId } = args

  // 1. Validate fromStage
  const branchOrder = STAGE_ORDER.indexOf(fromStage)
  if (branchOrder < 0) {
    throw new BranchPipelineError("invalid_stage", `Unknown stage: ${fromStage}`)
  }

  // 2. Fetch original pipeline
  const { data: original, error: origErr } = await supabase
    .from("pipelines")
    .select(
      "id, status, user_id, workflow_id, root_node_id, pipeline_type, activation_mode, mode, input_prompt, target_duration_seconds, format, output_resolution, language, style_directives, config, max_cost_credits",
    )
    .eq("id", originalPipelineId)
    .single()
  if (origErr || !original) {
    throw new BranchPipelineError(
      "pipeline_not_found",
      `Pipeline ${originalPipelineId} not found`,
    )
  }

  // 3. Guard: source must be completed
  if (original.status !== "completed") {
    throw new BranchPipelineError(
      "pipeline_not_completed",
      `Pipeline ${originalPipelineId} must be status='completed' to branch (current: ${original.status})`,
    )
  }

  // 4. Ownership check (also done at the route layer — belt-and-suspenders)
  if (original.user_id !== userId) {
    throw new BranchPipelineError("forbidden", "Pipeline belongs to a different user")
  }

  // 4b. Tier model-pin guard + upfront credit reservation. A branch RE-RUNS the
  // pipeline from `fromStage` onward — real LLM-orchestration compute. Previously
  // it reserved 0 credits → a free, repeatable re-run on every branch. Reserve the
  // same conservative upfront estimate createPipeline uses (unused portion refunds
  // on completion via the pipeline's normal reconciliation), and re-check the
  // cloned pinned models against the user's CURRENT tier (it may have been
  // downgraded since the original run).
  const { estimateUpfrontCredits, reservePipelineCredits, refundPipelineCredits } =
    await import("./credits.js")
  const cfg = (original.config ?? {}) as Record<string, unknown>

  const pinnedModels = Array.from(
    new Set(
      [
        cfg.image_model,
        cfg.video_model,
        cfg.script_llm,
        ...(cfg.stage_models && typeof cfg.stage_models === "object"
          ? Object.values(cfg.stage_models as Record<string, unknown>)
          : []),
      ].filter((m): m is string => typeof m === "string" && m.length > 0),
    ),
  )
  if (pinnedModels.length > 0) {
    const { CreditsService } = await import("../billing/credits.js")
    for (const modelId of pinnedModels) {
      const check = await CreditsService.checkCredits(userId, modelId)
      if (!check.allowed) {
        throw new BranchPipelineError(
          "model_pin_forbidden",
          check.error ?? `Model '${modelId}' is not available on your current plan`,
        )
      }
    }
  }

  const upfront = estimateUpfrontCredits({
    targetDurationSeconds: (original.target_duration_seconds as number) ?? 0,
    format: original.format,
    mode: original.mode,
    musicEnabled: (cfg.music_enabled as boolean | undefined) ?? true,
    narrationEnabled: (cfg.narration_enabled as boolean | undefined) ?? true,
    lipsyncEnabled: (cfg.lipsync_enabled as boolean | undefined) ?? true,
    videoCriticFrameCount: cfg.video_critic_frame_count as never,
  })

  // 5. Insert new pipelines row with branched-from lineage
  const { data: newPipeline, error: insErr } = await supabase
    .from("pipelines")
    .insert({
      user_id: userId,
      workflow_id: original.workflow_id ?? null,
      root_node_id: original.root_node_id,
      pipeline_type: original.pipeline_type,
      activation_mode: original.activation_mode,
      mode: original.mode,
      input_prompt: original.input_prompt,
      target_duration_seconds: original.target_duration_seconds,
      format: original.format,
      output_resolution: original.output_resolution,
      language: original.language,
      style_directives: original.style_directives ?? null,
      config: original.config ?? null,
      max_cost_credits: original.max_cost_credits ?? null,
      upfront_credit_estimate: upfront,
      reserved_credits: upfront,
      status: "running",
      branched_from_pipeline_id: originalPipelineId,
      branched_from_stage: fromStage,
    })
    .select("id")
    .single()
  if (insErr || !newPipeline) {
    throw new BranchPipelineError(
      "insert_failed",
      `Failed to insert branched pipeline: ${insErr?.message ?? "no data"}`,
    )
  }

  const newPipelineId = newPipeline.id as string

  // 5b. Reserve the upfront credits against the new pipeline row. Roll back the
  // row on insufficient credits — nothing else has been inserted yet, so the
  // cleanup is just this one DELETE (no orphan stages/entities).
  const reservation = await reservePipelineCredits({
    supabase,
    userId,
    pipelineId: newPipelineId,
    credits: upfront,
  })
  if (!reservation.ok) {
    await supabase.from("pipelines").delete().eq("id", newPipelineId)
    throw new BranchPipelineError(
      reservation.reason === "insufficient_credits" ? "insufficient_credits" : "reservation_failed",
      reservation.reason === "insufficient_credits"
        ? "Not enough credits to branch this pipeline"
        : `Credit reservation failed: ${reservation.reason}`,
    )
  }

  // Steps 6-9 run AFTER the credit reservation (5b). On ANY failure here (a DB
  // error cloning stages/entities, or enqueue throwing when Redis is down), roll
  // the reservation back — otherwise the credits stay locked until the reconcile
  // cron abandons the pipeline (up to 6h). refundPipelineCredits is idempotent
  // (CAS via pipelines.reservation_usage_log_id), so a later cron refund is a
  // safe no-op. Also mark the orphan pipeline failed so the resume cron doesn't
  // churn re-enqueuing a pipeline with no/partial stages.
  try {
    // 6. Clone upstream pipeline_stages rows as 'approved'
    const stagesToClone = STAGE_ORDER.slice(0, branchOrder) as readonly PipelineStageName[]
    if (stagesToClone.length > 0) {
      const { data: originalStages, error: stagesErr } = await supabase
        .from("pipeline_stages")
        .select("stage_name, stage_order, output, critic_feedback, user_edits")
        .eq("pipeline_id", originalPipelineId)
        .in("stage_name", stagesToClone as unknown as string[])
      if (stagesErr) {
        throw new BranchPipelineError("stages_fetch_failed", stagesErr.message)
      }
      if (originalStages && originalStages.length > 0) {
        const { error: stagesInsErr } = await supabase.from("pipeline_stages").insert(
          originalStages.map((s) => ({
            pipeline_id: newPipelineId,
            stage_name: s.stage_name,
            stage_order: s.stage_order,
            status: "approved",
            output: s.output ?? null,
            critic_feedback: s.critic_feedback ?? null,
            user_edits: s.user_edits ?? null,
          })),
        )
        if (stagesInsErr) {
          throw new BranchPipelineError(
            "stages_insert_failed",
            `Failed to clone upstream stages: ${stagesInsErr.message}`,
          )
        }
      }
    }

    // 7. Insert the branch stage itself as 'running'
    const { error: branchStageErr } = await supabase.from("pipeline_stages").insert({
      pipeline_id: newPipelineId,
      stage_name: fromStage,
      stage_order: branchOrder + 1,
      status: "running",
      output: null,
    })
    if (branchStageErr) {
      throw new BranchPipelineError(
        "branch_stage_insert_failed",
        `Failed to insert branch stage: ${branchStageErr.message}`,
      )
    }

    // 8. Clone pipeline_entities rows for types produced by upstream stages
    const entityTypesToClone = ENTITY_BY_STAGE[fromStage]
    let clonedEntities = 0
    if (entityTypesToClone.length > 0) {
      const { data: origEntities, error: entitiesErr } = await supabase
        .from("pipeline_entities")
        .select(
          "entity_type, entity_key, status, main_asset_id, last_frame_asset_id, metadata",
        )
        .eq("pipeline_id", originalPipelineId)
        .in("entity_type", entityTypesToClone as unknown as string[])
      if (entitiesErr) {
        throw new BranchPipelineError("entities_fetch_failed", entitiesErr.message)
      }
      if (origEntities && origEntities.length > 0) {
        const { error: entitiesInsErr } = await supabase.from("pipeline_entities").insert(
          origEntities.map((e) => ({
            pipeline_id: newPipelineId,
            entity_type: e.entity_type,
            entity_key: e.entity_key,
            // Carry over approved status — the entities are already blessed
            status: "approved",
            main_asset_id: e.main_asset_id ?? null,
            last_frame_asset_id: e.last_frame_asset_id ?? null,
            metadata: e.metadata ?? null,
          })),
        )
        if (entitiesInsErr) {
          throw new BranchPipelineError(
            "entities_insert_failed",
            `Failed to clone pipeline entities: ${entitiesInsErr.message}`,
          )
        }
        clonedEntities = origEntities.length
      }
    }

    // 9. Enqueue pipeline-run job for the new pipeline
    const { enqueuePipelineRun } = await import("./queue.js")
    await enqueuePipelineRun({
      pipelineId: newPipelineId,
      userId,
      reason: "branched",
    })

    return {
      newPipelineId,
      clonedStages: stagesToClone,
      clonedEntities,
    }
  } catch (err) {
    await refundPipelineCredits({
      supabase,
      userId,
      pipelineId: newPipelineId,
      reason: "branch_setup_failed",
    })
    await supabase
      .from("pipelines")
      .update({ status: "failed", failure_reason: "branch_setup_failed" })
      .eq("id", newPipelineId)
    throw err
  }
}
