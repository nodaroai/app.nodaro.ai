import type { SupabaseClient } from "@supabase/supabase-js"
import type { SceneNodeData, ShowrunnerPlan, SubGateName } from "@nodaro/shared"
import { ensureStageRow, failStage } from "../stage-utils.js"
import { pipelineEvents } from "../events.js"
import { transitionStageEntityNodesAndEmit } from "../depends-on.js"
import { settledWithLimit } from "../../../lib/settled-with-limit.js"
import { runSceneInternalPipeline } from "../scene-internal-pipeline.js"
import {
  pipelineFinalMerge,
  type FinalMergeSceneInput,
} from "../services/pipeline-final-merge.js"
import { runDialogueRecheck } from "../sub-steps/dialogue-recheck.js"
import { runSilentCutReview } from "../sub-steps/silent-cut-review.js"
import { runShotRealignment } from "../sub-steps/shot-realignment.js"
import { runMusicTimeline, type MusicTimelineResult } from "../music-timeline.js"
import {
  runEditor,
  type EditorCutDecision,
  type EditorShotInput,
} from "../llms/editor.js"
import { generateFreecutExport } from "../freecut-export.js"

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
  const config = (pipelineRow?.config ?? {}) as {
    shot_generation_mode?: "parallel" | "sequential"
    lipsync_enabled?: boolean
    music_enabled?: boolean
    freecut_export_enabled?: boolean
  }
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
  const ctx = { supabase, pipelineId, userId }
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

    if (result.ok && result.composite_video_url) {
      const prevSceneNodeData =
        (sceneEntity.metadata as Record<string, unknown> | null)?.scene_node_data as
          | SceneNodeData
          | undefined
      const nextShots = (prevSceneNodeData?.shots ?? []).map((s) => {
        const r = result.per_shot_results?.find((x) => x.shot_id === s.shot_id)
        if (!r) return s
        return {
          ...s,
          video_asset_id: r.video_asset_id ?? s.video_asset_id,
          video_url: r.video_url ?? s.video_url,
          last_frame_asset_id: r.last_frame_asset_id ?? s.last_frame_asset_id,
          last_frame_url: r.last_frame_url ?? s.last_frame_url,
          ...(r.has_dialogue ? { has_dialogue: true } : {}),
          ...(r.actual_audio_duration_sec != null
            ? { actual_audio_duration_sec: r.actual_audio_duration_sec }
            : {}),
        }
      })
      const nextSceneNodeData = {
        ...(prevSceneNodeData ?? {}),
        shots: nextShots,
        composite_video_asset_id: result.composite_video_asset_id,
        composite_video_url: result.composite_video_url,
      }
      const nextMetadata = {
        ...(sceneEntity.metadata ?? {}),
        scene_node_data: nextSceneNodeData,
      }
      await supabase
        .from("pipeline_entities")
        .update({ metadata: nextMetadata })
        .eq("id", sceneEntity.id)
      // Mutate the in-memory `scenes` entry as well so the downstream
      // sub-step chain (collectAllShotsFromScenes / loadScenesWithCutDecisions)
      // sees the just-written composite_video_url + per_shot results
      // without an extra `loadScenes` round-trip.
      sceneEntity.metadata = nextMetadata
    }

    return result
  })

  const results = await settledWithLimit(tasks, sceneConcurrency, undefined, false)

  const failed = results.filter(
    (r) =>
      r.status === "rejected" ||
      (r.status === "fulfilled" && r.value.ok === false),
  )
  if (failed.length > 0) {
    await failStage(supabase, stageId, `${failed.length} scenes failed`)
    return
  }

  // Hold the stage output in memory + flush via UPDATEs at sub-step
  // boundaries. Each sub-step mutates `stageOutputAcc` + `completed`
  // locally; a `try { ... } finally { flushStageOutput() }` wrapper
  // guarantees the accumulator hits the row even when an expensive
  // sub-step (music / editor / final_merge) throws and the worker dies.
  // Without that guarantee, `resumeActiveOrchestrators` would re-run
  // already-paid sub-steps because `completed.<step>=true` never reached
  // the DB. The finally flush is suppressed by `terminalWriteDone` when
  // `setSubGate` or `failStage` has already written its own output
  // payload (so we don't clobber `current_sub_gate` or `failure_reason`).
  //
  // ⚠️ Side-channel hazard: any helper that writes to
  // `pipeline_stages.output` out-of-band MUST also mutate
  // `stageOutputAcc` (so the subsequent flush is idempotent) OR set
  // `terminalWriteDone = true`. The original 1C.2 regression — Suno was
  // re-paid on resume because `runSilentCutReview` wrote to the row
  // directly and the batched flush wiped both that write AND the
  // updated `sub_step_completed` map — was fixed by moving the silent_cut
  // sub-gate write into `setSubGate`. See commit fixing a0a23642.
  const stageOutputAcc: Record<string, unknown> = {
    ...((existingStage?.output as Record<string, unknown> | null) ?? {}),
  }
  const completed: Record<string, boolean> = {
    ...((stageOutputAcc.sub_step_completed as Record<string, boolean> | undefined) ??
      {}),
  }
  let terminalWriteDone = false
  const flushStageOutput = async () => {
    stageOutputAcc.sub_step_completed = { ...completed }
    await supabase
      .from("pipeline_stages")
      .update({ output: stageOutputAcc })
      .eq("id", stageId)
  }
  const failAndMarkTerminal = async (reason: string) => {
    await failStage(supabase, stageId, reason)
    terminalWriteDone = true
  }

  try {
    // 5a. 7d' Dialogue duration recheck.
    if (!completed.dialogue_recheck) {
      const recheck = await runDialogueRecheck({
        supabase,
        pipelineId,
        mode: pipelineMode,
      })
      if (recheck.awaitingUserDecision) {
        stageOutputAcc.dialogue_recheck_result = recheck
        await setSubGate(supabase, pipelineId, stageId, "dialogue_recheck", {
          ...stageOutputAcc,
          sub_step_completed: { ...completed },
        })
        terminalWriteDone = true
        return
      }
      completed.dialogue_recheck = true
      stageOutputAcc.dialogue_recheck_result = recheck
    }

    // 5b. 7e' Silent-cut review.
    if (!completed.silent_cut) {
      const silent = await runSilentCutReview({
        supabase,
        pipelineId,
        userId,
        mode: pipelineMode,
      })
      if (silent.awaitingApproval) {
        // Merge the preview URL into `stageOutputAcc` BEFORE calling setSubGate
        // — setSubGate writes the full output payload (incl. `current_sub_gate`
        // + `sub_step_completed`) in one row update. If runSilentCutReview did
        // its own update, the batched flush below would overwrite it (this is
        // the regression fixed in commit fixing a0a23642).
        stageOutputAcc.silent_cut_preview_url = silent.previewUrl
        await setSubGate(supabase, pipelineId, stageId, "silent_cut_preview", {
          ...stageOutputAcc,
          sub_step_completed: { ...completed },
        })
        terminalWriteDone = true
        return
      }
      completed.silent_cut = true
    }

    // 5c. 7f + 7g Music timeline.
    let musicResult = (stageOutputAcc.music_result ?? null) as MusicTimelineResult | null
    if (!completed.music) {
      const plan = await loadShowrunnerPlan(supabase, pipelineId)
      musicResult = await runMusicTimeline({
        supabase,
        pipelineId,
        stageId,
        userId,
        totalDurationSec: targetDurationSec,
        config: { music_enabled: config.music_enabled },
        plan: plan ? { music_plan: plan.music_plan } : {},
      })
      completed.music = true
      stageOutputAcc.music_result = musicResult
    }

    // 5d. 7g' Shot realignment.
    if (!completed.realignment) {
      if (musicResult?.realignmentNeeded) {
        await runShotRealignment({
          supabase,
          pipelineId,
          detectedBPM: musicResult.detectedBPM,
          plannedBPM: musicResult.plannedBPM,
          beatGrid: musicResult.beatGrid,
        })
      }
      completed.realignment = true
    }

    // 5e. 7h Editor LLM.
    if (!completed.editor) {
      const shotInputs = collectAllShotsFromScenes(scenes)
      if (shotInputs.length === 0) {
        completed.editor = true
      } else {
        const plan = await loadShowrunnerPlan(supabase, pipelineId)
        const editorResult = await runEditor({
          supabase,
          pipelineId,
          stageId,
          userId,
          shots: shotInputs,
          beatGrid: musicResult?.beatGrid ?? [],
          targetDurationSec,
          globalStyle: plan?.global_style as Record<string, unknown> | undefined,
        })
        // `persistCutDecisions` patches each scene's metadata in parallel +
        // returns the next-state `SceneRow[]` so we skip a re-read entirely —
        // saves one DB round-trip and keeps the in-memory view canonical for
        // the downstream `loadScenesWithCutDecisions`.
        scenes = await persistCutDecisions(
          supabase,
          scenes,
          editorResult.cut_decisions,
        )
        completed.editor = true
      }
    }

    // 5f. 7j Final merge OR FreeCut export.
    //     The alternative FreeCut path is selected when the user opted into a
    //     FreeCut-compatible JSON timeline (`config.freecut_export_enabled`)
    //     AND the pipeline is in `mode = "manual"` (the only mode where
    //     post-pipeline NLE editing makes sense — auto/guided produce a final
    //     MP4 that ships directly).
    if (!completed.final_merge) {
      const mergeScenes = loadScenesWithCutDecisions(scenes)
      if (mergeScenes.length === 0) {
        await failAndMarkTerminal("no_scene_composites_for_final_merge")
        return
      }

      const useFreecut =
        config.freecut_export_enabled === true && pipelineMode === "manual"

      let finalAssetId: string | null = null
      let finalAssetUrl = ""
      let finalOutputFormat: "mp4" | "freecut" = "mp4"
      try {
        if (useFreecut) {
          const exportResult = await generateFreecutExport({
            supabase,
            pipelineId,
            userId,
            scenes: mergeScenes,
            musicAssetUrl: musicResult?.musicAssetUrl ?? "",
          })
          finalAssetId = exportResult.exportAssetId
          finalAssetUrl = exportResult.exportAssetUrl
          finalOutputFormat = "freecut"
        } else {
          const result = await pipelineFinalMerge({
            supabase,
            pipelineId,
            userId,
            scenes: mergeScenes,
            musicAssetUrl: musicResult?.musicAssetUrl ?? "",
          })
          finalAssetId = result.finalAssetId
          finalAssetUrl = result.finalAssetUrl
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await failAndMarkTerminal(`final_merge_failed: ${msg}`)
        return
      }

      const { error: pipelineUpdateErr } = await supabase
        .from("pipelines")
        .update({ final_output_asset_id: finalAssetId })
        .eq("id", pipelineId)
      if (pipelineUpdateErr) {
        await failAndMarkTerminal(
          `pipelines_update_failed: ${pipelineUpdateErr.message}`,
        )
        return
      }

      completed.final_merge = true
      stageOutputAcc.final_output_url = finalAssetUrl
      stageOutputAcc.final_output_asset_id = finalAssetId
      stageOutputAcc.final_output_format = finalOutputFormat
    }
  } finally {
    // Guarantee: any sub-step that mutated `stageOutputAcc` / `completed`
    // — including ones that ran BEFORE an exception further down the chain —
    // gets persisted. Without this, a crash after `runMusicTimeline`
    // succeeds but before `runEditor` finishes would leave the DB with
    // `completed.music === false`, and the orchestrator resume would
    // re-pay Suno. The flush is suppressed when the caller already wrote
    // the row (setSubGate / failStage paths) to avoid clobbering
    // `current_sub_gate` or `failure_reason`.
    if (!terminalWriteDone) {
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

interface SceneRow {
  id: string
  entity_key: string
  metadata: Record<string, unknown> | null
}

/**
 * Load every scene entity for a pipeline. Used at the top of the handler
 * (and exactly once more after `persistCutDecisions` mutates them) so the
 * downstream helpers — collectAllShotsFromScenes / loadScenesWithCutDecisions
 * — operate on an in-memory array instead of re-running the same query each.
 */
async function loadScenes(
  supabase: SupabaseClient,
  pipelineId: string,
): Promise<{ scenes: SceneRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")
    .order("entity_key", { ascending: true })
  if (error) return { scenes: [], error: error.message }
  return { scenes: (data ?? []) as SceneRow[], error: null }
}

async function setSubGate(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  gate: SubGateName,
  outputPatch: Record<string, unknown>,
): Promise<void> {
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
}

async function loadShowrunnerPlan(
  supabase: SupabaseClient,
  pipelineId: string,
): Promise<ShowrunnerPlan | null> {
  const { data: scriptStage } = await supabase
    .from("pipeline_stages")
    .select("output")
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", "script")
    .maybeSingle()
  const plan = (scriptStage?.output as { plan?: ShowrunnerPlan } | null)?.plan
  return plan ?? null
}

function collectAllShotsFromScenes(
  scenes: ReadonlyArray<SceneRow>,
): EditorShotInput[] {
  const out: EditorShotInput[] = []
  for (const scene of scenes) {
    const sceneNodeData = (scene.metadata as Record<string, unknown> | null)
      ?.scene_node_data as SceneNodeData | undefined
    if (!sceneNodeData?.shots) continue
    for (const s of sceneNodeData.shots) {
      out.push({
        shot_id: s.shot_id,
        scene_id: scene.entity_key,
        duration_seconds: s.duration_seconds,
        actual_audio_duration_sec: s.actual_audio_duration_sec ?? null,
        dialogue_no_cut_zone: s.dialogue_no_cut_zone ?? null,
        has_dialogue: s.has_dialogue ?? false,
        keyframe_url: s.keyframe_url ?? null,
        emotional_beat: sceneNodeData.emotional_beat,
      })
    }
  }
  return out
}

/**
 * Patches Editor cut_decisions onto each scene's `scene_node_data.shots[].cut_decision`.
 *
 * Operates on the in-memory `scenes` array (no DB re-read) — computes the
 * mutated row for each scene, fans the UPDATEs out via `Promise.all` (rows
 * are independent), and returns the next-state `SceneRow[]` so the caller
 * can keep its in-memory view fresh without another `loadScenes` round-trip.
 * Scenes with no matching decisions pass through unchanged.
 */
async function persistCutDecisions(
  supabase: SupabaseClient,
  scenes: ReadonlyArray<SceneRow>,
  decisions: ReadonlyArray<EditorCutDecision>,
): Promise<SceneRow[]> {
  if (decisions.length === 0) return [...scenes]

  const decisionByShotId = new Map<string, EditorCutDecision>(
    decisions.map((d) => [d.shot_id, d]),
  )

  const nextScenes: SceneRow[] = []
  const updateTasks: Promise<unknown>[] = []
  for (const scene of scenes) {
    const sceneNodeData = (scene.metadata as Record<string, unknown> | null)
      ?.scene_node_data as SceneNodeData | undefined
    if (!sceneNodeData?.shots) {
      nextScenes.push(scene)
      continue
    }
    let mutated = false
    const nextShots = sceneNodeData.shots.map((s) => {
      const dec = decisionByShotId.get(s.shot_id)
      if (!dec) return s
      mutated = true
      return {
        ...s,
        cut_decision: {
          in_offset_sec: dec.in_offset_sec,
          out_offset_sec: dec.out_offset_sec,
          transition_to_next: dec.transition_to_next,
          ...(dec.transition_duration_sec !== undefined
            ? { transition_duration_sec: dec.transition_duration_sec }
            : {}),
          ...(dec.beat_snap_seconds !== undefined
            ? { beat_snap_seconds: dec.beat_snap_seconds }
            : {}),
        },
      }
    })
    if (!mutated) {
      nextScenes.push(scene)
      continue
    }
    const nextMeta = {
      ...(scene.metadata ?? {}),
      scene_node_data: { ...sceneNodeData, shots: nextShots },
    }
    nextScenes.push({ ...scene, metadata: nextMeta })
    updateTasks.push(
      (async () => {
        await supabase
          .from("pipeline_entities")
          .update({ metadata: nextMeta })
          .eq("id", scene.id)
      })(),
    )
  }
  await Promise.all(updateTasks)
  return nextScenes
}

function loadScenesWithCutDecisions(
  scenes: ReadonlyArray<SceneRow>,
): FinalMergeSceneInput[] {
  const out: FinalMergeSceneInput[] = []
  for (const scene of scenes) {
    const sceneNodeData = (scene.metadata as Record<string, unknown> | null)
      ?.scene_node_data as SceneNodeData | undefined
    const compositeUrl = sceneNodeData?.composite_video_url
    if (!compositeUrl) continue
    out.push({
      sceneEntityId: scene.id,
      compositeUrl,
      shots: (sceneNodeData?.shots ?? []).map((s) => ({
        shot_id: s.shot_id,
        duration_seconds: s.duration_seconds,
        cut_decision: s.cut_decision,
      })),
    })
  }
  return out
}
