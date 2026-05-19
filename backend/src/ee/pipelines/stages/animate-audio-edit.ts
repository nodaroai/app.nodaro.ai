import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineConfig, SubGateName } from "@nodaro/shared"
import { ensureStageRow, failStage } from "../stage-utils.js"
import { pipelineEvents } from "../events.js"
import { transitionStageEntityNodesAndEmit } from "../depends-on.js"
import { settledWithLimit } from "../../../lib/settled-with-limit.js"
import { runSceneInternalPipeline } from "../scene-internal-pipeline.js"
import {
  STAGE_7_SUB_STEPS,
  type SubStepContext,
  type SubStepSceneRow,
} from "../sub-steps/_step-registry.js"

export interface RunAnimateAudioEditStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
}

const SCENE_CONCURRENCY_SEQUENTIAL = 1
const SCENE_CONCURRENCY_PARALLEL = 3

/**
 * Stage 7 (animate_audio_edit). Phase 1C.2 wires the full sub-step chain
 * after the per-scene runSceneInternalPipeline loop:
 *
 *   per-scene loop (1C.1) -> animate / speech / lipsync / combine per scene
 *   7d' dialogue duration recheck   (manual + guided pause if >10% drift)
 *   7e' silent-cut review            (manual + guided pause)
 *   7f + 7g music timeline           (Suno + beat-grid extract)
 *   7g' shot realignment             (only when BPM drift > 2 BPM)
 *   7h  Editor LLM                   (Sonnet vision -> per-shot cut_decisions)
 *   7j  final merge                  (FFmpeg merge with cut_decisions + music)
 *
 * Re-entrancy: each sub-step records completion under
 * pipeline_stages.output.sub_step_completed: { dialogue_recheck?, silent_cut?,
 * music?, realignment?, editor?, final_merge? }. When a sub-gate pauses the
 * stage, we flip status='awaiting_approval'. The L1 approve route clears the
 * gate, flips status back to 'running', and re-enqueues the orchestrator;
 * the completed map causes this handler to skip past finished steps.
 *
 * The per-scene loop runs unconditionally on every invocation. That's
 * intentional - runSceneInternalPipeline is idempotent at the scene level
 * (composite_video_url is persisted on first success; runner short-circuits
 * when it's already present).
 */
export async function runAnimateAudioEditStage(
  args: RunAnimateAudioEditStageArgs,
): Promise<void> {
  const { supabase, pipelineId, userId } = args

  const stageId = await ensureStageRow(supabase, pipelineId, "animate_audio_edit", 7)

  const { data: existingStage } = await supabase
    .from("pipeline_stages")
    .select("status, output")
    .eq("id", stageId)
    .maybeSingle()
  if (
    existingStage?.status === "awaiting_approval" ||
    existingStage?.status === "approved" ||
    existingStage?.status === "completed"
  ) {
    return
  }

  const { data: pipelineRow } = await supabase
    .from("pipelines")
    .select("config, mode, target_duration_seconds")
    .eq("id", pipelineId)
    .single()
  const config = (pipelineRow?.config ?? {}) as Partial<PipelineConfig>
  const mode: "parallel" | "sequential" = config.shot_generation_mode ?? "parallel"
  const lipSyncEnabled = config.lipsync_enabled ?? true
  const runImageCritic = mode === "sequential"
  const pipelineMode = ((pipelineRow as { mode?: string } | null)?.mode ?? "manual") as
    | "manual"
    | "auto"
    | "guided"
  const targetDurationSec =
    ((pipelineRow as { target_duration_seconds?: number } | null)
      ?.target_duration_seconds) ?? 60

  const loadResult = await loadScenes(supabase, pipelineId)
  if (loadResult.error) {
    await failStage(supabase, stageId, `load_scenes: ${loadResult.error}`)
    return
  }
  let scenes = loadResult.scenes
  if (scenes.length === 0) {
    await failStage(supabase, stageId, "no_scenes")
    return
  }

  await transitionStageEntityNodesAndEmit(
    supabase,
    pipelineId,
    "scene",
    "pipeline_owned_running",
    "animate_audio_edit",
  )

  const sceneConcurrency =
    mode === "sequential" ? SCENE_CONCURRENCY_SEQUENTIAL : SCENE_CONCURRENCY_PARALLEL
  // Phase 1C.3 — plumb pipelineMode into the SceneNode internal pipeline so
  // `pipelineAnimateShot` can apply the Method 8 auto-mode fallback (skip
  // frame_interpolation on auto runs to keep cost in check).
  const ctx = { supabase, pipelineId, userId, pipelineMode }
  // Persist per-scene metadata updates into a Map keyed by scene id so we can
  // reassign into `scenes` (the locally-cached `SceneRow[]`) after the fan-out
  // settles WITHOUT mutating the input rows in place. Mirrors the
  // return-fresh-array convention `persistCutDecisions` already follows.
  const updatedByScene = new Map<string, Record<string, unknown>>()
  const tasks = scenes.map((scene) => async () => {
    const sceneEntity = scene as {
      id: string
      entity_key: string
      metadata: Record<string, unknown> | null
    }
    const result = await runSceneInternalPipeline(ctx, sceneEntity, {
      mode,
      lipSyncEnabled,
      runImageCritic,
    })

    if (result.ok && result.composite_video_url && result.updated_metadata) {
      const nextMetadata = result.updated_metadata
      await supabase
        .from("pipeline_entities")
        .update({ metadata: nextMetadata })
        .eq("id", sceneEntity.id)
      // Stage the in-memory metadata refresh for after the fan-out completes
      // — runSceneInternalPipeline is contractually immutable on its input,
      // so we don't reach in and mutate `sceneEntity.metadata` here. The
      // reassignment into `scenes[i]` happens once below.
      updatedByScene.set(sceneEntity.id, nextMetadata)
    }

    return result
  })

  const results = await settledWithLimit(tasks, sceneConcurrency, undefined, false)

  // Apply the staged per-scene metadata updates into the local `scenes`
  // array so downstream helpers (`collectAllShotsFromScenes`,
  // `loadScenesWithCutDecisions`) see the fresh values without an extra
  // `loadScenes` round-trip.
  if (updatedByScene.size > 0) {
    scenes = scenes.map((s) => {
      const nextMeta = updatedByScene.get(s.id)
      return nextMeta ? { ...s, metadata: nextMeta } : s
    })
  }

  const failed = results.filter(
    (r) =>
      r.status === "rejected" ||
      (r.status === "fulfilled" && r.value.ok === false),
  )
  if (failed.length > 0) {
    await failStage(supabase, stageId, `${failed.length} scenes failed`)
    return
  }

  // Phase 1C.3 Task A1 — table-driven sub-step loop. The handler walks the
  // STAGE_7_SUB_STEPS registry in order, skipping any `completed[key]=true`
  // rows from a resumed run. Each sub-step mutates `stageOutputAcc` /
  // `completed` and returns a discriminated `SubStepResult`:
  //
  //   - `continue` → keep going; the loop flips `completed[key]=true` and
  //                  (when `step.checkpoint === true`) flushes the stage row.
  //   - `terminal_pause` → write `current_sub_gate` + `sub_step_completed`
  //                        atomically via setSubGate and return.
  //   - `terminal_fail` → call failStage(reason) and return.
  //
  // The end-of-handler `finally` flushes the accumulator iff no terminal write
  // occurred. Without that net, a crash after a paid sub-step succeeds but
  // before the next sub-step finishes would lose `completed.<step>=true` and
  // the orchestrator resume would re-pay (the regression class fixed in
  // commit fixing a0a23642). `handlerResult` is the typed sentinel from the
  // pre-refactor handler so the compiler still enforces "any early-return
  // site MUST visibly thread a terminal value through the variable."
  //
  // ⚠️ Side-channel hazard: any sub-step that writes to `pipeline_stages.output`
  // out-of-band MUST also mutate `stageOutputAcc` (so the subsequent flush is
  // idempotent) OR return one of the terminal kinds. The pre-refactor regression
  // — Suno re-paid on resume because `runSilentCutReview` wrote the row directly
  // and the batched flush wiped its write — is preserved against because every
  // wrapper in `_step-registry.ts` writes ONLY through `stageOutputAcc`.
  const stageOutputAcc: Record<string, unknown> = {
    ...((existingStage?.output as Record<string, unknown> | null) ?? {}),
  }
  const completed: Record<string, boolean> = {
    ...((stageOutputAcc.sub_step_completed as Record<string, boolean> | undefined) ??
      {}),
  }
  let handlerResult: StageHandlerResult = { kind: "continue" }
  const flushStageOutput = async () => {
    stageOutputAcc.sub_step_completed = { ...completed }
    await supabase
      .from("pipeline_stages")
      .update({ output: stageOutputAcc })
      .eq("id", stageId)
  }
  const failAndMarkTerminal = async (
    reason: string,
  ): Promise<StageHandlerResultTerminal> => {
    await failStage(supabase, stageId, reason)
    return TERMINAL
  }

  const subStepCtx: SubStepContext = {
    supabase,
    pipelineId,
    stageId,
    userId,
    mode: pipelineMode,
    config,
    targetDurationSec,
    stageOutputAcc,
    completed,
    scenes: scenes as ReadonlyArray<SubStepSceneRow>,
  }

  try {
    for (const step of STAGE_7_SUB_STEPS) {
      if (completed[step.key]) continue
      if (!step.shouldRun(subStepCtx)) {
        // Still mark the step complete so resume doesn't re-evaluate it. This
        // mirrors the pre-refactor "set completed.<step>=true even when the
        // sub-step internally skipped" defensive semantics.
        completed[step.key] = true
        stageOutputAcc.sub_step_completed = { ...completed }
        continue
      }
      const result = await step.run(subStepCtx)
      if (result.kind === "terminal_pause") {
        handlerResult = await setSubGate(
          supabase,
          pipelineId,
          stageId,
          result.gate,
          {
            ...stageOutputAcc,
            ...(result.outputPatch ?? {}),
            sub_step_completed: { ...completed },
          },
        )
        return
      }
      if (result.kind === "terminal_fail") {
        handlerResult = await failAndMarkTerminal(result.reason)
        return
      }
      // continue — apply the optional scenesPatch (Editor sub-step) so the
      // downstream final_merge sees the patched view, then mark the step
      // complete and (when paid) flush the row.
      if (result.scenesPatch) {
        scenes = result.scenesPatch as SubStepSceneRow[]
        subStepCtx.scenes = scenes as ReadonlyArray<SubStepSceneRow>
      }
      completed[step.key] = true
      stageOutputAcc.sub_step_completed = { ...completed }
      if (step.checkpoint) await flushStageOutput()
    }
  } finally {
    // Guarantee: any sub-step that mutated `stageOutputAcc` / `completed`
    // — including ones that ran BEFORE an exception further down the chain —
    // gets persisted. Without this, a crash after `runMusicTimeline` succeeds
    // but before `runEditor` finishes would leave the DB with `completed.music
    // === false`, and the orchestrator resume would re-pay Suno. The flush is
    // suppressed when the caller already wrote the row (setSubGate / failStage
    // paths) to avoid clobbering `current_sub_gate` or `failure_reason`.
    if (handlerResult.kind === "continue") {
      await flushStageOutput().catch((err) => {
        console.error("[stage:animate_audio_edit] final flush failed:", err)
      })
    }
  }

  await transitionStageEntityNodesAndEmit(
    supabase,
    pipelineId,
    "scene",
    "pipeline_owned_awaiting_approval",
    "animate_audio_edit",
  )
  await supabase
    .from("pipeline_stages")
    .update({ status: "approved", completed_at: new Date().toISOString() })
    .eq("id", stageId)
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "animate_audio_edit",
    status: "approved",
  })
}

/* --- Helpers ----------------------------------------------------------- */

/**
 * Load every scene entity for a pipeline. The result is handed to the
 * sub-step registry as `ctx.scenes`; the Editor sub-step swaps in a fresh
 * array (via `result.scenesPatch`) after patching cut_decisions so the
 * downstream final_merge sees the up-to-date view without another DB read.
 */
async function loadScenes(
  supabase: SupabaseClient,
  pipelineId: string,
): Promise<{ scenes: SubStepSceneRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")
    .order("entity_key", { ascending: true })
  if (error) return { scenes: [], error: error.message }
  return { scenes: (data ?? []) as SubStepSceneRow[], error: null }
}

/**
 * Typed sentinel for the Stage 7 handler's flow control. The handler kicks
 * off in `{ kind: "continue" }` and any sub-step that performs a terminal
 * write to `pipeline_stages.output` (sub-gate pause, failStage) reassigns
 * the result to `{ kind: "terminal" }`. The finally clause checks this
 * sentinel to decide whether to flush the accumulator — flushing on top of
 * a terminal write would clobber `current_sub_gate` or `failure_reason`.
 *
 * Pattern matches the discriminated-union signaling used elsewhere in the
 * pipeline engine (e.g. `SceneInternalPipelineResult`). The compiler still
 * forces every early-return site to thread this value visibly even though
 * the early returns now live inside the registry loop's terminal-result
 * branches rather than inline `if (...) return` blocks.
 */
type StageHandlerResultContinue = { kind: "continue" }
type StageHandlerResultTerminal = { kind: "terminal" }
type StageHandlerResult = StageHandlerResultContinue | StageHandlerResultTerminal
const TERMINAL: StageHandlerResultTerminal = { kind: "terminal" }

async function setSubGate(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  gate: SubGateName,
  outputPatch: Record<string, unknown>,
): Promise<StageHandlerResultTerminal> {
  // Single UPDATE: write the accumulated stage output (with `current_sub_gate`
  // + sub_step_completed) AND flip status to awaiting_approval at once. This
  // replaces the prior 2-query sequence (mergeStageOutput → status update).
  await supabase
    .from("pipeline_stages")
    .update({
      output: { ...outputPatch, current_sub_gate: gate },
      status: "awaiting_approval",
    })
    .eq("id", stageId)
  pipelineEvents.publish({
    type: "stage:awaiting_sub_gate",
    pipelineId,
    stageName: "animate_audio_edit",
    subGate: gate,
    payload: outputPatch,
  })
  return TERMINAL
}
