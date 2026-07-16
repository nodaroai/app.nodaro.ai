import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  ShowrunnerPlanSchema,
  SceneNodeDataSchema,
  type ShowrunnerPlan,
  type SceneNodeData,
  type VideoCriticFrameMode,
} from "@nodaro/shared"

/**
 * Seeded pipeline creation lane — start the existing 8-stage film-director
 * pipeline with PRE-SUPPLIED creative artifacts instead of LLM-generated ones.
 *
 * Generic + content-free: a caller hands a validated ShowrunnerPlan (and,
 * optionally, per-scene SceneNodeData for the shot_list stage); the engine runs
 * the remaining stages unattended in `mode:'auto'` (every gate auto-approves).
 *
 * ── Precedents pinned before writing this (Step 1) ──────────────────────────
 *  - Engine walk (engine.ts:44-93): drivePipeline picks the FIRST `pipeline_stages`
 *    row whose status is NOT in {approved,cancelled,failed}, ordered by stage_order.
 *    When every row IS approved it advances to STAGE_ORDER[lastApprovedIdx + 1].
 *    STAGE_ORDER = PIPELINE_STAGE_NAMES: script(1) characters(2) objects(3)
 *    locations(4) shot_list(5) scene_images(6) animate_audio_edit(7) post_merge(8).
 *    ⇒ Pre-approving script(1) AND shot_list(5) WITHOUT pending rows for chars(2)/
 *    objects(3)/locations(4) would make the "all approved → jump past last approved"
 *    branch skip straight to scene_images(6). So when scenes are seeded we ALSO
 *    pre-insert `pending` rows for 2-4; the first non-terminal row is then
 *    characters(2) and entity generation runs.
 *  - ensureStageRow (stage-utils.ts:100-127): selects (pipeline_id, stage_name)
 *    via maybeSingle() and RETURNS the existing row's id without re-inserting —
 *    idempotent on the UNIQUE(pipeline_id, stage_name) key. So a pre-inserted
 *    `pending` row is tolerated: when the engine dispatches that stage the handler
 *    reuses our row rather than colliding.
 *  - script stage output shape (engine.ts:299): `output: { plan }`; shot-list.ts:59
 *    reads `scriptStage.output.plan`. shot_list writes NO stage output of its own
 *    (shot-list.ts only updates status/completed_at) ⇒ its seeded `output` is null.
 *  - scene entity (shot-list.ts:80-96 + scene-images.ts:162-165/541-544):
 *    entity_type='scene', entity_key=`scene_${scene_index padStart(2,"0")}` (scene_01…),
 *    scene_images reads `metadata.scene_node_data` (must be valid SceneNodeData, else
 *    `scene_node_data_missing`). We pre-approve the entity and pre-populate that.
 *  - reservation cleanup (create-pipeline.ts:188-192): on reservation failure DELETE
 *    the pipelines row and propagate — mirrored here exactly (we reserve BEFORE any
 *    stage/entity insert so the rollback is a single delete).
 *  - enqueuePipelineRun (queue.ts:30): OBJECT arg `{ pipelineId, userId, reason }`.
 *  - DB constraints (migration 121): pipeline_stages.status ∈ {pending,running,
 *    awaiting_approval,approved,rejected,failed,cancelled}; pipelines.status default
 *    'queued'; activation_mode ∈ {interactive,programmatic}; UNIQUE(pipeline_id,stage_name).
 *
 * credits.js / queue.js / prompt-registry.js are imported dynamically inside the
 * body — matching create-pipeline.ts. queue.js opens an IORedis connection at
 * module scope, so a static import would connect on every import of this module.
 */

export class SeedConsistencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SeedConsistencyError"
  }
}

export interface SeededPipelineInput {
  userId: string
  workflowId: string
  /** Headless runs have no canvas node — default a fresh UUID. */
  rootNodeId?: string
  /** Provenance line stored as the pipeline's input_prompt. */
  inputPrompt: string
  /** Validated against ShowrunnerPlanSchema inside. */
  plan: unknown
  /** Pre-built shot_list artifacts (validated against SceneNodeDataSchema inside). */
  scenes?: Array<{ sceneIndex: number; sceneNodeData: unknown }>
  /** PipelineConfigSchema partial (music_enabled, video_model, …). */
  config?: Record<string, unknown>
  maxCostCredits?: number
}

/**
 * Stage-row layout after seeding (engine walk contract, engine.ts:59-92):
 *   script     approved  (output = { plan })
 *   characters pending ┐ pre-inserted (only with scenes) so the "all approved →
 *   objects    pending ├ jump past the last approved row" branch can never skip
 *   locations  pending ┘ entity generation when shot_list is also pre-approved
 *   shot_list  approved  (only with scenes; its own stage output is null)
 */
export async function createSeededPipeline(
  supabase: SupabaseClient,
  input: SeededPipelineInput,
): Promise<{ pipelineId: string; reservedCredits: number }> {
  const { pipelinePromptsAvailable } = await import("./llms/prompt-registry.js")
  if (!pipelinePromptsAvailable()) {
    throw new Error("Pipeline prompts unavailable")
  }

  const plan = ShowrunnerPlanSchema.parse(input.plan)
  const scenes = input.scenes?.map((s) => ({
    sceneIndex: s.sceneIndex,
    sceneNodeData: SceneNodeDataSchema.parse(s.sceneNodeData),
  }))

  // Key-resolution + scene-coverage guard. Pre-empts the engine's drift guard
  // (engine.ts:101 → canvas_drift), which would otherwise pause an unattended run.
  assertSeedConsistency(plan, scenes)

  const config = (input.config ?? {}) as Record<string, unknown>

  const { estimateUpfrontCredits, reservePipelineCredits } = await import("./credits.js")
  const estimate = estimateUpfrontCredits({
    targetDurationSeconds: plan.target_duration_seconds,
    format: plan.format,
    mode: "auto",
    musicEnabled: (config.music_enabled as boolean | undefined) ?? true,
    narrationEnabled: (config.narration_enabled as boolean | undefined) ?? true,
    lipsyncEnabled: (config.lipsync_enabled as boolean | undefined) ?? true,
    videoCriticFrameCount: config.video_critic_frame_count as VideoCriticFrameMode | undefined,
  })

  // 1. Insert the pipeline row (auto mode, queued). pipeline_type is the
  //    film-director pipeline's value (create-pipeline.ts default).
  const { data: pipeline, error: insertErr } = await supabase
    .from("pipelines")
    .insert({
      user_id: input.userId,
      workflow_id: input.workflowId,
      root_node_id: input.rootNodeId ?? randomUUID(),
      pipeline_type: "story_to_video",
      activation_mode: "interactive",
      mode: "auto",
      status: "queued",
      input_prompt: input.inputPrompt,
      target_duration_seconds: plan.target_duration_seconds,
      format: plan.format,
      output_resolution: plan.output_resolution,
      language: plan.language,
      style_directives: null,
      config,
      upfront_credit_estimate: estimate,
      reserved_credits: estimate,
      max_cost_credits: input.maxCostCredits ?? null,
    })
    .select("id")
    .single()
  if (insertErr || !pipeline) {
    throw new Error(`Failed to insert seeded pipeline: ${insertErr?.message ?? "no data"}`)
  }
  const pipelineId = pipeline.id as string

  // 2. Reserve credits. On failure roll the pipeline row back and propagate —
  //    mirrors create-pipeline.ts:188-192 exactly (nothing else inserted yet).
  const reservation = await reservePipelineCredits({
    supabase,
    userId: input.userId,
    pipelineId,
    credits: estimate,
  })
  if (!reservation.ok) {
    await supabase.from("pipelines").delete().eq("id", pipelineId)
    throw new Error(`Credit reservation failed: ${reservation.reason}`)
  }

  // 3. Seed the pre-approved / pre-inserted stage rows.
  const stageRows: Array<Record<string, unknown>> = [
    { pipeline_id: pipelineId, stage_name: "script", stage_order: 1, status: "approved", output: { plan } },
  ]
  if (scenes) {
    stageRows.push(
      { pipeline_id: pipelineId, stage_name: "characters", stage_order: 2, status: "pending", output: null },
      { pipeline_id: pipelineId, stage_name: "objects", stage_order: 3, status: "pending", output: null },
      { pipeline_id: pipelineId, stage_name: "locations", stage_order: 4, status: "pending", output: null },
      { pipeline_id: pipelineId, stage_name: "shot_list", stage_order: 5, status: "approved", output: null },
    )
  }
  const { error: stagesErr } = await supabase.from("pipeline_stages").insert(stageRows)
  if (stagesErr) {
    throw new Error(`Failed to insert seeded stage rows: ${stagesErr.message}`)
  }

  // 4. Materialize one approved scene entity per scene — scene_images reads
  //    metadata.scene_node_data. Metadata mirrors shot-list.ts's own shape.
  if (scenes) {
    const sceneEntities = scenes.map(({ sceneIndex, sceneNodeData }) => {
      const sceneId = `scene_${String(sceneIndex).padStart(2, "0")}`
      return {
        pipeline_id: pipelineId,
        entity_type: "scene",
        entity_key: sceneId,
        status: "approved",
        metadata: {
          entity_type: "scene",
          scene_id: sceneId,
          scene_index: sceneIndex,
          shot_ids: [],
          emotional_beat: sceneNodeData.emotional_beat,
          scene_node_id: "",
          exploded_to_workflow_id: null,
          scene_node_data: sceneNodeData,
        },
      }
    })
    const { error: entitiesErr } = await supabase
      .from("pipeline_entities")
      .insert(sceneEntities)
    if (entitiesErr) {
      throw new Error(`Failed to insert seeded scene entities: ${entitiesErr.message}`)
    }
  }

  // 5. Enqueue the orchestrator (object arg — queue.ts:30).
  const { enqueuePipelineRun } = await import("./queue.js")
  await enqueuePipelineRun({ pipelineId, userId: input.userId, reason: "initial" })

  return { pipelineId, reservedCredits: estimate }
}

/**
 * Cross-field seed validation the schemas can't express:
 *   - every scene's cast_keys/object_keys and its location_key must resolve to a
 *     key declared on the plan's own cast/objects/locations;
 *   - when the caller pre-supplies shot_list scenes, their sceneIndex set must
 *     equal the plan's scene_index set exactly (no gaps, no extras).
 * A violation would surface downstream as the engine's `canvas_drift` pause,
 * hanging an unattended auto run — so we reject up front.
 */
function assertSeedConsistency(
  plan: ShowrunnerPlan,
  scenes?: Array<{ sceneIndex: number; sceneNodeData: SceneNodeData }>,
): void {
  const castKeys = new Set(plan.cast.map((c) => c.key))
  const locationKeys = new Set(plan.locations.map((l) => l.key))
  const objectKeys = new Set(plan.objects.map((o) => o.key))

  const unresolved = new Set<string>()
  for (const scene of plan.scenes) {
    for (const key of scene.cast_keys) {
      if (!castKeys.has(key)) unresolved.add(`cast:${key}`)
    }
    if (scene.location_key && !locationKeys.has(scene.location_key)) {
      unresolved.add(`location:${scene.location_key}`)
    }
    for (const key of scene.object_keys) {
      if (!objectKeys.has(key)) unresolved.add(`object:${key}`)
    }
  }
  if (unresolved.size > 0) {
    throw new SeedConsistencyError(
      `Seed plan references entity keys absent from its own cast/objects/locations: ${[
        ...unresolved,
      ].join(", ")}`,
    )
  }

  if (scenes) {
    const planIndices = new Set(plan.scenes.map((s) => s.scene_index))
    const seedIndices = new Set(scenes.map((s) => s.sceneIndex))
    const missing = [...planIndices].filter((i) => !seedIndices.has(i))
    const extra = [...seedIndices].filter((i) => !planIndices.has(i))
    if (missing.length > 0 || extra.length > 0) {
      throw new SeedConsistencyError(
        `Seeded scenes must cover the plan's scene indices exactly. ` +
          `Missing: [${missing.join(", ")}]; extra: [${extra.join(", ")}]`,
      )
    }
  }
}
