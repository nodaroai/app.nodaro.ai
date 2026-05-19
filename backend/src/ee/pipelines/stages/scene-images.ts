import type { SupabaseClient } from "@supabase/supabase-js"
import type { SceneNodeData, ShotSpec, ShowrunnerPlan } from "@nodaro/shared"
import { ensureStageRow, failStage } from "../stage-utils.js"
import { pipelineEvents } from "../events.js"
import { pipelineGenerateImage } from "../services/pipeline-generate-image.js"
import { allocateReferenceSlots } from "../continuity.js"
import { transitionStageEntityNodesAndEmit } from "../depends-on.js"
import { settledWithLimit } from "../../../lib/settled-with-limit.js"

export interface RunSceneImagesStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
}

/**
 * Cross-scene fan-out cap. Each scene runs its shots sequentially internally
 * (keyframe gen for shot N+1 may depend on shot N's last_frame in 1C.3), but
 * across scenes we parallelize. Matches Stage 5's `SCENE_CONCURRENCY_LIMIT`
 * so we never blow Anthropic / KIE / Replicate tier-1 rate limits.
 */
const CROSS_SCENE_CONCURRENCY = 5

/**
 * Stage 6 (`scene_images`). For every approved scene entity from Stage 5,
 * generate one keyframe image per shot in the scene's planned shot list.
 *
 * Per-shot output is persisted back into `pipeline_entities.metadata
 * .scene_node_data.shots[N]` as `keyframe_url` + `keyframe_asset_id` so
 * Stage 7 (animate_audio_edit) can read them when wiring the start frame
 * for each shot's animate call.
 *
 *   1. Load approved scene entities (entity_type='scene', ordered by entity_key)
 *   2. Load Showrunner plan from Stage 1 output
 *   3. Mark canvas SceneNodes `pipeline_owned_running`
 *   4. Fan out scenes via `settledWithLimit` at concurrency=5
 *   5. Per scene: generate keyframes for every shot sequentially via
 *      `pipelineGenerateImage`. Reference slots allocated by
 *      `allocateReferenceSlots` (continuity anchor is null in Stage 6 — the
 *      Method 1 chain only kicks in during Stage 7's animate step).
 *   6. Persist `keyframe_asset_id` + `keyframe_url` back to each shot
 *   7. On any blocking failure → `failStage("scene_keyframe_gen_failed")`
 *   8. On success → batch-flip canvas SceneNodes to
 *      `pipeline_owned_awaiting_approval` + mark stage `awaiting_approval`
 *
 * The stage stops short of advancing the pipeline — the engine driver
 * re-enters once the user approves the keyframe batch.
 */
export async function runSceneImagesStage(args: RunSceneImagesStageArgs): Promise<void> {
  const { supabase, pipelineId, userId } = args

  const stageId = await ensureStageRow(supabase, pipelineId, "scene_images", 6)

  // Re-entrancy guard: if a prior pass already approved or completed the stage,
  // the engine wouldn't re-invoke us; but if a partial retry lands and the row
  // is already awaiting_approval we bail without doing redundant gen.
  const { data: existingStage } = await supabase
    .from("pipeline_stages")
    .select("status")
    .eq("id", stageId)
    .maybeSingle()
  if (
    existingStage?.status === "awaiting_approval" ||
    existingStage?.status === "approved" ||
    existingStage?.status === "completed"
  ) {
    return
  }

  // 1. Load Showrunner plan from Stage 1 (Scene Director references it for
  //    style + dependency keys; we pass it through to allocateReferenceSlots).
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

  // 2. Load all scene entities — pulled by entity_key order so the canvas
  //    materialization order is stable across runs.
  const { data: scenes, error } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")
    .order("entity_key", { ascending: true })
  if (error) {
    await failStage(supabase, stageId, `load_scenes: ${error.message}`)
    return
  }
  if (!scenes || scenes.length === 0) {
    await failStage(supabase, stageId, "no_scenes")
    return
  }

  // 3. Mark every materialized SceneNode `pipeline_owned_running` — UI hint
  //    that the engine is generating keyframes. No-op when no canvas node
  //    rows exist yet (Phase 1B.1 materializes on user approve).
  await transitionStageEntityNodesAndEmit(
    supabase,
    pipelineId,
    "scene",
    "pipeline_owned_running",
    "scene-images",
  )

  // 4. Fan out scenes. `settledWithLimit` takes a list of thunks; each thunk
  //    runs `generateKeyframesForScene` for one scene. We disable failFast
  //    so a single scene's failure doesn't cancel the others' un-started
  //    gens — we want a complete picture of which scenes failed.
  const tasks = scenes.map(
    (scene) => () =>
      generateKeyframesForScene({
        supabase,
        pipelineId,
        userId,
        plan,
        scene: scene as {
          id: string
          entity_key: string
          metadata: Record<string, unknown> | null
        },
      }),
  )
  const results = await settledWithLimit(tasks, CROSS_SCENE_CONCURRENCY, undefined, false)

  // 5. Collect blocking failures. Both rejection (thrown) and a `{ ok: false }`
  //    fulfilment count as failures — the inner helper catches its own errors
  //    and returns a structured reason, but a hard throw still bubbles up here.
  const blocking = results.filter(
    (r) =>
      r.status === "rejected" ||
      (r.status === "fulfilled" && r.value.ok === false),
  )
  if (blocking.length > 0) {
    await failStage(
      supabase,
      stageId,
      `scene_keyframe_gen_failed: ${blocking.length}/${results.length} scenes`,
    )
    return
  }

  // 6. Transition canvas SceneNodes to awaiting_approval + mark stage.
  await transitionStageEntityNodesAndEmit(
    supabase,
    pipelineId,
    "scene",
    "pipeline_owned_awaiting_approval",
    "scene-images",
  )
  await supabase
    .from("pipeline_stages")
    .update({ status: "awaiting_approval" })
    .eq("id", stageId)
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "scene_images",
    status: "awaiting_approval",
  })
}

interface GenerateKeyframesForSceneArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  plan: ShowrunnerPlan
  scene: { id: string; entity_key: string; metadata: Record<string, unknown> | null }
}

/**
 * Per-scene helper. Generates one keyframe per shot in `scene_node_data.shots`
 * sequentially, persists `keyframe_asset_id` + `keyframe_url` back to each
 * shot, and emits a single `entity:state_change` ack at the end.
 *
 * Returns `{ ok: false, reason }` on any failure rather than throwing — the
 * caller (`runSceneImagesStage`) uses the structured reason to build the
 * stage failure message.
 */
async function generateKeyframesForScene(
  args: GenerateKeyframesForSceneArgs,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { supabase, pipelineId, userId, plan, scene } = args
  const sceneNodeData = (scene.metadata as Record<string, unknown> | null)
    ?.scene_node_data as SceneNodeData | undefined
  if (!sceneNodeData) {
    return { ok: false, reason: `scene_node_data_missing:${scene.entity_key}` }
  }

  // Per-shot keyframe gen — parallelized at concurrency=3 within a scene.
  // Shots in Stage 6 are independent (no last_frame chain; that's Stage 7).
  // Multi-shot reference continuity helpers (allocateReferenceSlots) want
  // the prior shot's last frame, but in Stage 6 we don't have any animated
  // clips yet, so `priorLastFrame` is always null here. Concurrency=3 is a
  // reasonable per-scene bound — provider rate-limits across multiple
  // parallel scenes are still respected by the outer Stage 6 fan-out (cap=5).
  //
  // Phase 1C.3 Method 5 may reintroduce a sequential constraint here when
  // bridge frames wire in (a shot's bridged_frame_url could derive from a
  // prior shot's keyframe within the same scene).
  const shots = sceneNodeData.shots as ShotSpec[]
  type KeyframeOutcome =
    | {
        ok: true
        shotId: string
        asset: { asset_id: string | null; url: string }
        interpolationKeyframeUrls?: string[]
      }
    | { ok: false; shotId: string; reason: string }

  const shotTasks: Array<() => Promise<KeyframeOutcome>> = shots.map((shot) => async () => {
    try {
      const refs = await allocateReferenceSlots({
        supabase,
        pipelineId,
        scene: { id: scene.id },
        shot,
        sceneNodeData,
        priorLastFrame: null,
      })
      const referenceImageUrls = refs.map((r) => r.url)
      const result = await pipelineGenerateImage({
        supabase,
        pipelineId,
        pipelineEntityId: scene.id,
        userId,
        prompt: shot.visual_keyframe_prompt,
        modelIdentifier: sceneNodeData.image_model,
        referenceImageUrls,
      })

      // Phase 1C.3 Method 8 — for frame_interpolation shots, additionally
      // generate one keyframe per `interpolation_keyframes[N].prompt`. The
      // primary `keyframe_url` (above) is still emitted so a Method-8 shot
      // can degrade gracefully via the auto-mode fallback in
      // `pipelineAnimateShot` (which recurses as first_frame using the
      // primary keyframe). Sub-keyframe URLs land in
      // `interpolation_keyframe_urls` for Stage 7 to consume.
      let interpolationKeyframeUrls: string[] | undefined
      if (
        sceneNodeData.shot_input_mode === "frame_interpolation" &&
        shot.interpolation_keyframes &&
        shot.interpolation_keyframes.length >= 2
      ) {
        const subResults = await Promise.all(
          shot.interpolation_keyframes.map(async (kf) => {
            const subResult = await pipelineGenerateImage({
              supabase,
              pipelineId,
              pipelineEntityId: scene.id,
              userId,
              prompt: kf.prompt,
              modelIdentifier: sceneNodeData.image_model,
              referenceImageUrls,
            })
            return subResult.assetUrl
          }),
        )
        interpolationKeyframeUrls = subResults
      }

      return {
        ok: true,
        shotId: shot.shot_id,
        asset: { asset_id: result.assetId, url: result.assetUrl },
        ...(interpolationKeyframeUrls
          ? { interpolationKeyframeUrls }
          : {}),
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        `[scene-images] Keyframe gen failed for scene=${scene.entity_key} shot=${shot.shot_id}:`,
        msg,
      )
      return {
        ok: false,
        shotId: shot.shot_id,
        reason: `keyframe_gen_failed:${scene.entity_key}:${shot.shot_id}`,
      }
    }
  })

  const settled = await settledWithLimit(shotTasks, 3, undefined, false)
  const keyframes: Record<
    string,
    { asset_id: string | null; url: string; interpolationKeyframeUrls?: string[] }
  > = {}
  for (const r of settled) {
    if (r.status !== "fulfilled") {
      // settledWithLimit only rejects on a thrown error; our tasks resolve
      // with `{ok:false}` instead. Treat the rare unhandled-rejection case
      // as a hard failure with a structured reason.
      return { ok: false, reason: `keyframe_gen_failed:${scene.entity_key}:unknown` }
    }
    const out = r.value
    if (!out.ok) return { ok: false, reason: out.reason }
    keyframes[out.shotId] = {
      ...out.asset,
      ...(out.interpolationKeyframeUrls
        ? { interpolationKeyframeUrls: out.interpolationKeyframeUrls }
        : {}),
    }
  }

  // Persist keyframes back to scene_node_data.shots[N]. We write the whole
  // metadata object since each shot keeps its planning fields untouched and
  // gains two new optional fields (plus Method 8's interpolation_keyframe_urls
  // when present).
  const nextShots = (sceneNodeData.shots as ShotSpec[]).map((s) => {
    const kf = keyframes[s.shot_id]
    if (!kf) return s
    return {
      ...s,
      keyframe_asset_id: kf.asset_id ?? undefined,
      keyframe_url: kf.url,
      ...(kf.interpolationKeyframeUrls
        ? { interpolation_keyframe_urls: kf.interpolationKeyframeUrls }
        : {}),
    }
  })
  const nextSceneNodeData: SceneNodeData = { ...sceneNodeData, shots: nextShots }

  const { error: updateErr } = await supabase
    .from("pipeline_entities")
    .update({
      metadata: { ...(scene.metadata ?? {}), scene_node_data: nextSceneNodeData },
    })
    .eq("id", scene.id)
  if (updateErr) {
    return { ok: false, reason: `persist:${scene.entity_key}:${updateErr.message}` }
  }

  // Silence the unused-var lint — plan IS read transitively through
  // allocateReferenceSlots' use of sceneNodeData.cast_keys / location_key
  // (those keys are resolved against pipeline_entities, not the plan itself),
  // but we accept it as an arg for forward-compat with shot-level style
  // overrides that will need the global style block.
  void plan
  return { ok: true }
}
