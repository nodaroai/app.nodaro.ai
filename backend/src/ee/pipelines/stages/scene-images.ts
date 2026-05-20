import type { SupabaseClient } from "@supabase/supabase-js"
import type { MatchCutVerdict, SceneNodeData, ShotSpec, ShowrunnerPlan } from "@nodaro/shared"
import { bulkApproveStageEntities, ensureStageRow, failStage } from "../stage-utils.js"
import { pipelineEvents } from "../events.js"
import { pipelineGenerateImage } from "../services/pipeline-generate-image.js"
import { allocateReferenceSlots } from "../continuity.js"
import { transitionStageEntityNodesAndEmit } from "../depends-on.js"
import { settledWithLimit } from "../../../lib/settled-with-limit.js"
import { runMatchCutOrchestrator } from "../match-cut-orchestrator.js"

export interface RunSceneImagesStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
  /**
   * Phase 1D.2a §4.1 (H2): when `"auto"`, the stage skips the keyframe-review
   * `awaiting_approval` pause AFTER the Phase 1D.1 match-cut critic clears
   * (no pending breaks). On a clean critic pass, the stage bulk-flips every
   * scene entity from `awaiting_approval` → `approved`, batch-flips the
   * matching canvas nodes from `pipeline_owned_awaiting_approval` →
   * `pipeline_owned_approved`, marks the stage row `approved`, emits the
   * `stage:status approved` SSE, and re-enqueues the orchestrator with
   * `reason: "stage_advance"` so Stage 7 (animate_audio_edit) picks up.
   *
   * **Match-cut sub-gate is preserved unconditionally** — when the critic
   * reports any pending break, the stage still pauses at sub-gate
   * `match_cut_break_pending` regardless of mode. Auto-advance only happens
   * on the no-break path; the user must explicitly accept every break via
   * `acceptMatchCutBreak`, which re-enqueues the stage and the next pass
   * runs through `resumingFromMatchCutGate` (also gated on mode here).
   *
   * Defaults to `"manual"`, preserving the prior pause-for-user behavior.
   */
  mode?: "manual" | "auto" | "guided"
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
  const { supabase, pipelineId, userId, mode } = args

  const stageId = await ensureStageRow(supabase, pipelineId, "scene_images", 6)

  // Re-entrancy guard: if a prior pass already approved or completed the stage,
  // the engine wouldn't re-invoke us; but if a partial retry lands and the row
  // is already awaiting_approval we bail without doing redundant gen.
  //
  // Exception: when the stage is awaiting_approval WITH current_sub_gate =
  // "match_cut_break_pending", the accept_match_cut_break route set it back to
  // "running" before re-enqueueing — so we only skip on awaiting_approval when
  // current_sub_gate is absent (i.e. the standard keyframe-review pause).
  const { data: existingStage } = await supabase
    .from("pipeline_stages")
    .select("status, output")
    .eq("id", stageId)
    .maybeSingle()
  const existingOutput = (existingStage?.output as Record<string, unknown> | null) ?? {}
  const resumingFromMatchCutGate =
    existingStage?.status === "running" &&
    Array.isArray(existingOutput.match_cut_break_pending) &&
    (existingOutput.match_cut_break_pending as string[]).length === 0 &&
    existingOutput.keyframes_generated === true
  if (
    (existingStage?.status === "awaiting_approval" &&
      !existingOutput.current_sub_gate) ||
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

  // Phase 1D.1: When resuming after the match_cut_break_pending sub-gate was
  // cleared (all breaks accepted), skip straight to the final transition —
  // keyframes are already persisted from the first pass.
  //
  // Phase 1D.2a §4.1 (H2): in auto-mode, advance straight to `approved` and
  // re-enqueue the orchestrator. Manual/guided keep the prior pause for the
  // keyframe-review user gate. The match-cut sub-gate above already ran in
  // the prior pass and was cleared by `acceptMatchCutBreak` — auto-mode never
  // bypasses the critic, only the human-only keyframe-review pause.
  if (resumingFromMatchCutGate) {
    if (mode === "auto") {
      await advanceToApproved(supabase, pipelineId, stageId, userId, existingOutput)
    } else {
      await advanceToAwaitingApproval(supabase, pipelineId, stageId, existingOutput)
    }
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

  // 5b. Phase 1D.1 — MatchCutCritic pass. Run the match-cut orchestrator over
  //     every scene. Aggregate verdicts and pending-break lists across scenes.
  //     A "break" verdict means the two keyframes don't form a viable match cut
  //     and the user must explicitly accept the break before Stage 7 animates
  //     them. Store verdicts on the stage output for the panel to render.
  const allMatchCutVerdicts: Record<string, MatchCutVerdict> = {}
  const allPendingBreaks: string[] = []

  // Re-read scenes with updated metadata (keyframes now persisted).
  const { data: scenesWithKeyframes } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")
    .order("entity_key", { ascending: true })

  for (const sceneEntity of scenesWithKeyframes ?? []) {
    const sceneNodeData = (
      (sceneEntity.metadata as Record<string, unknown> | null)?.scene_node_data
    ) as SceneNodeData | undefined
    if (!sceneNodeData) continue

    const { verdicts, pendingBreaks } = await runMatchCutOrchestrator({
      supabase,
      pipelineId,
      stageId,
      sceneId: sceneEntity.id,
      userId,
      plan,
      scene: sceneNodeData,
    })
    Object.assign(allMatchCutVerdicts, verdicts)
    allPendingBreaks.push(...pendingBreaks)
  }

  if (allPendingBreaks.length > 0) {
    // Sub-gate: user must accept each break before Stage 7 can proceed.
    // Write verdicts + pending list to stage output, set current_sub_gate,
    // and pause at awaiting_approval. The accept_match_cut_break route will
    // remove shots from the list; when the list empties it sets status back
    // to "running" and re-enqueues the pipeline.
    await supabase
      .from("pipeline_stages")
      .update({
        output: {
          ...existingOutput,
          keyframes_generated: true,
          match_cut_verdicts: allMatchCutVerdicts,
          match_cut_break_pending: allPendingBreaks,
          current_sub_gate: "match_cut_break_pending",
        },
        status: "awaiting_approval",
      })
      .eq("id", stageId)
    pipelineEvents.publish({
      type: "stage:awaiting_sub_gate",
      pipelineId,
      stageName: "scene_images",
      subGate: "match_cut_break_pending",
      payload: { pendingBreaks: allPendingBreaks },
    })
    return
  }

  // 6. No pending match-cut breaks (or no match-cut shots at all). Persist
  //    verdicts for audit and advance.
  //
  //    Phase 1D.2a §4.1 (H2): auto-mode advances straight to `approved` here
  //    (no user pause for keyframe review). The critic already ran and
  //    cleared with zero breaks — auto-advance only kicks in on the clean
  //    path. Manual/guided keep the existing `awaiting_approval` pause.
  const sharedOutput = {
    ...existingOutput,
    keyframes_generated: true,
    match_cut_verdicts: allMatchCutVerdicts,
    match_cut_break_pending: [],
  }
  if (mode === "auto") {
    await advanceToApproved(supabase, pipelineId, stageId, userId, sharedOutput)
  } else {
    await advanceToAwaitingApproval(supabase, pipelineId, stageId, sharedOutput)
  }
}

/**
 * Final transition for Stage 6: flip canvas SceneNodes to
 * `pipeline_owned_awaiting_approval`, write stage output, and emit SSE.
 * Called both from the normal completion path and from the sub-gate resume path.
 */
async function advanceToAwaitingApproval(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  outputPatch: Record<string, unknown>,
): Promise<void> {
  await transitionStageEntityNodesAndEmit(
    supabase,
    pipelineId,
    "scene",
    "pipeline_owned_awaiting_approval",
    "scene-images",
  )
  // Strip current_sub_gate when advancing from a sub-gated state.
  const nextOutput = { ...outputPatch }
  delete nextOutput.current_sub_gate

  await supabase
    .from("pipeline_stages")
    .update({ status: "awaiting_approval", output: nextOutput })
    .eq("id", stageId)
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "scene_images",
    status: "awaiting_approval",
  })
}

/**
 * Phase 1D.2a §4.1 (H2): auto-mode counterpart to `advanceToAwaitingApproval`.
 * Bulk-flips every scene entity from `awaiting_approval` → `approved` (idempotent
 * — only touches awaiting_approval rows so previously-approved scenes from a
 * resumed run aren't bumped), batch-flips canvas nodes to
 * `pipeline_owned_approved`, marks the stage row `approved`, emits the
 * `stage:status approved` SSE, and re-enqueues the orchestrator with
 * `reason: "stage_advance"` so Stage 7 picks up.
 *
 * Called ONLY when the match-cut critic cleared with zero pending breaks —
 * auto-mode never bypasses the critic, only the human-only keyframe-review
 * pause that comes after a clean critic pass.
 */
async function advanceToApproved(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  userId: string,
  outputPatch: Record<string, unknown>,
): Promise<void> {
  // Bulk-flip awaiting_approval scene entities → approved. This UPDATE is a
  // no-op when scenes are already `pending`/`generating` (the post-keyframe
  // loop above hasn't paused at awaiting_approval for them yet) — the
  // status='awaiting_approval' filter scopes the write.
  //
  // In practice every scene reaches `awaiting_approval` via the
  // transitionStageEntityNodesAndEmit call below in the manual path, but
  // scene entities themselves are not flipped to awaiting_approval by Stage 6
  // — only the canvas nodes are. Scene entity statuses are managed by Stage
  // 5 (shot-list). We mirror G1/G2/G3 here as a defensive idempotency net
  // for the case where a future change re-introduces a per-scene entity
  // awaiting_approval inside Stage 6.
  await bulkApproveStageEntities(supabase, pipelineId, "scene", "scene-images")
  // Strip current_sub_gate when advancing from a sub-gated state.
  const nextOutput = { ...outputPatch }
  delete nextOutput.current_sub_gate

  await supabase
    .from("pipeline_stages")
    .update({
      status: "approved",
      completed_at: new Date().toISOString(),
      output: nextOutput,
    })
    .eq("id", stageId)
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "scene_images",
    status: "approved",
  })
  const { enqueuePipelineRun } = await import("../queue.js")
  await enqueuePipelineRun({ pipelineId, userId, reason: "stage_advance" })
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
