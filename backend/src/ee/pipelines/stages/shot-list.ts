import type { SupabaseClient } from "@supabase/supabase-js"
import type { SceneInputMode, SceneNodeData, ShowrunnerPlan } from "@nodaro/shared"
import { ensureStageRow, failStage } from "../stage-utils.js"
import { pipelineEvents } from "../events.js"
import { runSceneDirector } from "../llms/scene-director.js"
import { runShotListCritic, type ShotListCriticVerdict } from "../llms/shot-list-critic.js"
import { settledWithLimit } from "../../../lib/settled-with-limit.js"
import {
  resolveEntityKeysToIds,
  setEntityDepends,
  transitionEntityNodeAndEmit,
} from "../depends-on.js"

export interface RunShotListStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
}

const MAX_CRITIC_RETRIES_PER_SCENE = 2

// Each runOneScene issues 2-6 Sonnet calls (Scene Director + retries + critic).
// Cap fan-out so >6 scenes don't exceed Anthropic tier-1 rate limits (50 RPM).
const SCENE_CONCURRENCY_LIMIT = 5

export async function runShotListStage(args: RunShotListStageArgs): Promise<void> {
  const { supabase, pipelineId, userId } = args

  const stageId = await ensureStageRow(supabase, pipelineId, "shot_list", 5)

  // Load ShowrunnerPlan from Stage 1.
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

  // Default shot_input_mode for Phase 1B.2 — `first_frame` unless the pipeline config overrides.
  // (Provider-aware auto-selection lands in Phase 1C.)
  const shotInputMode: SceneInputMode = "first_frame"

  // Materialize one pipeline_entities row per scene (entity_type='scene', idempotent).
  // Batched into a single upsert so we don't pay N round-trips for N scenes.
  const sceneRows = plan.scenes.map((scene) => ({
    pipeline_id: pipelineId,
    stage_id: stageId,
    entity_type: "scene",
    entity_key: `scene_${String(scene.scene_index).padStart(2, "0")}`,
    status: "pending",
    metadata: {
      entity_type: "scene",
      scene_id: `scene_${String(scene.scene_index).padStart(2, "0")}`,
      scene_index: scene.scene_index, // avoids parseInt round-trip in runOneScene
      shot_ids: [],
      emotional_beat: scene.emotional_beat,
      scene_node_id: "", // set when canvas materializer runs (Section M)
      exploded_to_workflow_id: null,
      // scene_node_data lands after Scene Director succeeds
    },
  }))
  await supabase
    .from("pipeline_entities")
    .upsert(sceneRows, {
      onConflict: "pipeline_id,entity_type,entity_key",
      ignoreDuplicates: true,
    })

  // Load all scene entities for this pipeline.
  const { data: entities } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, status, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")
    .order("entity_key", { ascending: true })

  // Process scenes in parallel — only those still needing generation.
  const todo = (entities ?? []).filter(
    (e) => e.status !== "approved" && e.status !== "awaiting_approval",
  )

  if (todo.length > 0) {
    // Pre-build ref lookup Maps once for the whole stage so each scene's
    // runSceneDirector skips O(N) find() scans over cast/locations/objects.
    const castByKey = new Map(plan.cast.map((c) => [c.key, c]))
    const locationsByKey = new Map(plan.locations.map((l) => [l.key, l]))
    const objectsByKey = new Map(plan.objects.map((o) => [o.key, o]))

    // Bounded concurrency — each runOneScene issues 2-6 Sonnet calls. Without a
    // cap, >6 scenes blows past Anthropic tier-1 rate limits. runOneScene catches
    // its own errors and never throws, so failFast=false is safe here.
    await settledWithLimit(
      todo.map(
        (entity) => () =>
          runOneScene({
            supabase,
            pipelineId,
            stageId,
            userId,
            entity,
            plan,
            shotInputMode,
            castByKey,
            locationsByKey,
            objectsByKey,
          }),
      ),
      SCENE_CONCURRENCY_LIMIT,
      undefined,
      false,
    )
  }

  // Check end-of-stage condition: all scenes reach awaiting_approval or approved.
  const { data: refreshed } = await supabase
    .from("pipeline_entities")
    .select("status")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")

  const anyFailed = (refreshed ?? []).some((e) => e.status === "failed")
  if (anyFailed) {
    // Some scenes failed permanently — surface to user; stage stays running so the user can retry per scene.
    return
  }

  const allApproved = (refreshed ?? []).every((e) => e.status === "approved")
  if (allApproved) {
    await supabase
      .from("pipeline_stages")
      .update({ status: "approved", completed_at: new Date().toISOString() })
      .eq("id", stageId)
    pipelineEvents.publish({
      type: "stage:status",
      pipelineId,
      stageName: "shot_list",
      status: "approved",
    })
  }
}

interface RunOneSceneArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  entity: { id: string; entity_key: string; status: string; metadata: Record<string, unknown> | null }
  plan: ShowrunnerPlan
  shotInputMode: SceneInputMode
  castByKey?: Map<string, ShowrunnerPlan["cast"][number]>
  locationsByKey?: Map<string, ShowrunnerPlan["locations"][number]>
  objectsByKey?: Map<string, ShowrunnerPlan["objects"][number]>
}

async function runOneScene(args: RunOneSceneArgs): Promise<void> {
  const {
    supabase,
    pipelineId,
    stageId,
    userId,
    entity,
    plan,
    shotInputMode,
    castByKey,
    locationsByKey,
    objectsByKey,
  } = args

  await supabase
    .from("pipeline_entities")
    .update({ status: "generating" })
    .eq("id", entity.id)

  // Prefer scene_index from metadata (written at upsert time); fall back to parsing
  // the entity_key for rows that pre-date this change.
  const metadata = (entity.metadata ?? {}) as Record<string, unknown>
  const sceneIndex =
    (metadata.scene_index as number | undefined) ??
    parseInt(entity.entity_key.replace("scene_", ""), 10)

  let sceneNodeData: SceneNodeData | undefined
  let criticVerdict: ShotListCriticVerdict | undefined
  let retries = 0

  while (retries <= MAX_CRITIC_RETRIES_PER_SCENE) {
    try {
      sceneNodeData = await runSceneDirector({
        supabase,
        pipelineId,
        stageId,
        userId,
        sceneId: entity.id,
        plan,
        sceneIndex,
        shotInputMode,
        criticFeedback: retries > 0 ? criticVerdict : undefined,
        castByKey,
        locationsByKey,
        objectsByKey,
      })
    } catch (err) {
      await supabase
        .from("pipeline_entities")
        .update({ status: "failed" })
        .eq("id", entity.id)
      pipelineEvents.publish({
        type: "scene:status",
        pipelineId,
        sceneEntityId: entity.id,
        sceneIndex,
        status: "failed",
      })
      console.error(`[shot-list] Scene Director failed for ${entity.entity_key}:`, err)
      return
    }

    criticVerdict = await runShotListCritic({
      supabase,
      pipelineId,
      stageId,
      sceneId: entity.id,
      userId,
      sceneNodeData,
    })

    const hasBlocking = criticVerdict.issues.some((i) => i.severity === "blocking")
    if (criticVerdict.verdict === "pass" || !hasBlocking) break

    retries++
    if (retries > MAX_CRITIC_RETRIES_PER_SCENE) {
      console.warn(
        `[shot-list] Scene ${entity.entity_key} exhausted critic retries (${retries}); keeping last attempt with warnings`,
      )
      break
    }
  }

  if (!sceneNodeData) {
    await supabase
      .from("pipeline_entities")
      .update({ status: "failed" })
      .eq("id", entity.id)
    return
  }

  // Resolve scene's character/location/object refs into pipeline_entities.ids
  // and record the dependency tree BEFORE flipping to awaiting_approval. Stage
  // 6+ cascade-staleness logic walks this tree, so it must be in place by the
  // time the user can interact with the scene.
  const depKeys: string[] = [
    ...sceneNodeData.cast_keys,
    sceneNodeData.location_key,
    ...sceneNodeData.object_keys,
  ].filter((k): k is string => Boolean(k))
  const depIds = await resolveEntityKeysToIds(supabase, pipelineId, depKeys)
  await setEntityDepends(supabase, entity.id, depIds)

  // Persist scene_node_data + transition to awaiting_approval.
  await supabase
    .from("pipeline_entities")
    .update({
      status: "awaiting_approval",
      metadata: {
        ...(entity.metadata ?? {}),
        shot_ids: sceneNodeData.shots.map((s) => s.shot_id),
        scene_node_data: sceneNodeData,
        shot_list_critic: criticVerdict,
      },
    })
    .eq("id", entity.id)

  // Phase 1B.4 (D1): SceneNode → awaiting_approval. No-op when no canvas node
  // exists yet (Phase 1B.1: SceneNodes materialize on user approve).
  await transitionEntityNodeAndEmit(
    supabase,
    pipelineId,
    entity.id,
    "pipeline_owned_awaiting_approval",
    "shot-list",
  )

  pipelineEvents.publish({
    type: "scene:status",
    pipelineId,
    sceneEntityId: entity.id,
    sceneIndex,
    status: "awaiting_approval",
    shotCount: sceneNodeData.shots.length,
  })
}
