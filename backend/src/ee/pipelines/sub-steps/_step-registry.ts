import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  PipelineConfig,
  SceneNodeData,
  ShowrunnerPlan,
  SubGateName,
} from "@nodaro/shared"
import type { MusicTimelineResult } from "../music-timeline.js"
import type { EditorCutDecision, EditorShotInput } from "../llms/editor.js"
import type { FinalMergeSceneInput } from "../services/pipeline-final-merge.js"

/**
 * Phase 1C.3 Task A1 — Table-driven sub-step loop for Stage 7
 * (`runAnimateAudioEditStage`). Foundation for Methods 3/8/10: the 7-block
 * sequential chain in the original handler would balloon to 10+ blocks across
 * Phase 1C.3's three PRs, causing file-level conflicts and obscuring the
 * resume / paid-checkpoint / sub-gate semantics. The registry decouples each
 * sub-step's logic from the handler's control flow:
 *
 *   - `SubStepDef.shouldRun(ctx)` — gates the step (mode / config / dynamic).
 *   - `SubStepDef.run(ctx)` — runs the step; returns a discriminated union
 *     telling the handler whether to continue, terminal-pause at a sub-gate,
 *     or terminal-fail the stage.
 *   - `SubStepDef.checkpoint` — true => flush `stageOutputAcc` to the DB after
 *     success (paid steps: narration, music, editor, final_merge). The non-
 *     paid steps (dialogue_recheck, silent_cut, realignment) batch into the
 *     end-of-handler `finally` flush.
 *
 * The handler loops over `STAGE_7_SUB_STEPS` in order, skipping any
 * `completed[step.key]` rows from a resumed run. Adding a Method-3/8/10
 * sub-step is a single-line insert into the array — no new `if (!completed.X)`
 * block, no risk of forgetting the checkpoint flush. Existing observable
 * behavior is byte-identical with the pre-refactor handler (see 22 baseline
 * tests in `__tests__/animate-audio-edit.test.ts`).
 *
 * The wrapper functions below import each existing sub-step module via
 * dynamic `await import()`. That preserves the lazy-load posture that the
 * pre-refactor handler had (modules pulled in only when the step actually
 * runs) AND keeps the EE-import boundary lint clean — this file is itself
 * under `ee/` so the dynamic imports stay ee→ee.
 */

/* --- Public types ----------------------------------------------------- */

export interface SubStepSceneRow {
  id: string
  entity_key: string
  metadata: Record<string, unknown> | null
}

export interface SubStepContext {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  /** Pipeline mode — drives terminal_pause behavior in manual/guided. */
  mode: "manual" | "guided" | "auto"
  /** Pipeline config block — narration_enabled / music_enabled / freecut etc. */
  config: Partial<PipelineConfig> & {
    shot_generation_mode?: "parallel" | "sequential"
    lipsync_enabled?: boolean
    music_enabled?: boolean
    narration_enabled?: boolean
    freecut_export_enabled?: boolean
    freecut_export_format?: "json" | "fcpxml"
  }
  /**
   * Target pipeline duration in seconds. Feeds `runMusicTimeline.totalDurationSec`
   * AND `runEditor.targetDurationSec`. Loaded from `pipelines.target_duration_seconds`
   * at handler entry (default 60).
   */
  targetDurationSec: number
  /**
   * Accumulated stage output. Sub-steps mutate this in-place; the handler
   * flushes it to `pipeline_stages.output` after each paid-checkpoint step
   * and once in the end-of-handler `finally`. `sub_step_completed` is kept
   * in sync via `completed` (see below).
   */
  stageOutputAcc: Record<string, unknown>
  /**
   * `sub_step_completed` map — keyed by `SubStepDef.key`. Mirrors
   * `stageOutputAcc.sub_step_completed`; the handler updates both on every
   * step. On worker resume the handler hydrates `completed` from
   * `existingStage.output.sub_step_completed` and the loop skips any row
   * whose key is `true`.
   */
  completed: Record<string, boolean>
  /**
   * Mutable scenes view. The Editor sub-step replaces this via
   * `result.scenesPatch` so downstream final_merge sees the patched
   * `cut_decisions`. All other sub-steps either mutate scene metadata via the
   * supabase client AND return a `scenesPatch` (dialogue_recheck,
   * shot_realignment), or leave it untouched.
   */
  scenes: ReadonlyArray<SubStepSceneRow>
}

export type SubStepResult =
  | { kind: "continue"; scenesPatch?: ReadonlyArray<SubStepSceneRow> }
  | {
      kind: "terminal_pause"
      gate: SubGateName
      /** Patched onto `stageOutputAcc` before `setSubGate` writes the row. */
      outputPatch?: Record<string, unknown>
    }
  | { kind: "terminal_fail"; reason: string }

export interface SubStepDef {
  /** Matches the key in `stageOutputAcc.sub_step_completed`. Load-bearing
   *  for resume semantics — DO NOT rename without a migration. */
  key: string
  /** Returning false skips the step (but still marks `completed[key]=true`
   *  so the handler doesn't re-evaluate on resume). */
  shouldRun: (ctx: SubStepContext) => boolean
  run: (ctx: SubStepContext) => Promise<SubStepResult>
  /** True => flush `stageOutputAcc` to the DB after success. Paid steps
   *  (Suno music, ElevenLabs narration, Editor LLM, FFmpeg final merge) MUST
   *  checkpoint so worker resume doesn't re-pay. Non-paid steps batch into
   *  the end-of-handler `finally` flush. */
  checkpoint: boolean
}

/* --- Helpers shared across wrappers ---------------------------------- */

/**
 * Loads the Showrunner plan for sub-steps that need it (narration, music,
 * editor). Returns null when the script stage has no plan attached. Each
 * step calls this lazily so a stage where narration is disabled doesn't pay
 * the round-trip.
 */
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
  scenes: ReadonlyArray<SubStepSceneRow>,
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
 * Identical semantics to the pre-refactor helper — fans out per-scene UPDATEs
 * in parallel and returns the next-state `SubStepSceneRow[]` so the handler
 * can refresh its in-memory `scenes` array without a re-read.
 */
async function persistCutDecisions(
  supabase: SupabaseClient,
  scenes: ReadonlyArray<SubStepSceneRow>,
  decisions: ReadonlyArray<EditorCutDecision>,
): Promise<SubStepSceneRow[]> {
  if (decisions.length === 0) return [...scenes]

  const decisionByShotId = new Map<string, EditorCutDecision>(
    decisions.map((d) => [d.shot_id, d]),
  )

  const nextScenes: SubStepSceneRow[] = []
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
  scenes: ReadonlyArray<SubStepSceneRow>,
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

/* --- Sub-step wrappers ----------------------------------------------- */

/**
 * 7c — Narration audio. Runs ONCE per pipeline (not per-scene). Skips when
 * narration_enabled=false OR no Showrunner plan OR plan.narration_script is
 * undefined. Paid (ElevenLabs TTS) — must checkpoint after success.
 *
 * `completed.narration` is set unconditionally — even when the plan is
 * missing — so resume doesn't retry the no-op. Mirrors the pre-refactor
 * handler's "defensive completion" semantics.
 *
 * J2d — `loadShowrunnerPlan` is gated behind `narration_enabled !== false`
 * so pipelines with narration disabled skip the script-stage DB query
 * entirely (was: always queried, then returned early after plan check).
 */
async function runNarrationStep(ctx: SubStepContext): Promise<SubStepResult> {
  // Gate the DB query: when narration is explicitly disabled there is no
  // work to do and no plan to load. The `completed.narration=true` flag is
  // written by the checkpoint machinery regardless, keeping resume semantics.
  if (ctx.config.narration_enabled === false) return { kind: "continue" }

  const plan = await loadShowrunnerPlan(ctx.supabase, ctx.pipelineId)
  if (!plan) return { kind: "continue" }

  const { runNarrationAudio } = await import("./narration-audio.js")
  const narration = await runNarrationAudio({
    supabase: ctx.supabase,
    pipelineId: ctx.pipelineId,
    stageId: ctx.stageId,
    userId: ctx.userId,
    plan,
    config: ctx.config,
  })
  if (!narration.skipped) {
    ctx.stageOutputAcc.narration_audio_url = narration.narrationUrl
    ctx.stageOutputAcc.narration_audio_duration_sec = narration.narrationDurationSec
    ctx.stageOutputAcc.narration_audio_asset_id = narration.narrationAssetId
  }
  return { kind: "continue" }
}

/**
 * 7d' — Dialogue duration recheck. Pauses at sub-gate `dialogue_recheck`
 * (manual/guided) when any scene exceeded the ±10% drift tolerance. The
 * orchestrator merges the recheck result into `stageOutputAcc` BEFORE the
 * setSubGate write so the single-UPDATE write batches everything (sub-gate +
 * sub_step_completed + recheck payload).
 */
async function runDialogueRecheckStep(
  ctx: SubStepContext,
): Promise<SubStepResult> {
  const { runDialogueRecheck } = await import("./dialogue-recheck.js")
  const recheck = await runDialogueRecheck({
    supabase: ctx.supabase,
    pipelineId: ctx.pipelineId,
    mode: ctx.mode,
  })
  if (recheck.awaitingUserDecision) {
    ctx.stageOutputAcc.dialogue_recheck_result = recheck
    return { kind: "terminal_pause", gate: "dialogue_recheck" }
  }
  ctx.stageOutputAcc.dialogue_recheck_result = recheck
  return { kind: "continue" }
}

/**
 * 7e' — Silent-cut review. Auto mode skips entirely (sub-step returns
 * `awaitingApproval: false`). Manual/guided pause at sub-gate
 * `silent_cut_preview` and the preview URL gets merged into `stageOutputAcc`
 * BEFORE the row write — moving the merge to the sub-step previously caused
 * the a0a23642 regression (preview URL + sub_step_completed got clobbered by
 * the batched flush).
 */
async function runSilentCutStep(ctx: SubStepContext): Promise<SubStepResult> {
  const { runSilentCutReview } = await import("./silent-cut-review.js")
  const silent = await runSilentCutReview({
    supabase: ctx.supabase,
    pipelineId: ctx.pipelineId,
    userId: ctx.userId,
    mode: ctx.mode,
  })
  if (silent.awaitingApproval) {
    ctx.stageOutputAcc.silent_cut_preview_url = silent.previewUrl
    return { kind: "terminal_pause", gate: "silent_cut_preview" }
  }
  return { kind: "continue" }
}

/**
 * 7f + 7g — Music timeline. Suno generation + beat-grid extract.
 * Paid (Suno) — must checkpoint after success. The result lands on
 * `stageOutputAcc.music_result` and is read back by the realignment / editor /
 * final_merge wrappers below (kept on stageOutputAcc so resume after a
 * post-music crash sees the fresh musicResult).
 */
async function runMusicStep(ctx: SubStepContext): Promise<SubStepResult> {
  const plan = await loadShowrunnerPlan(ctx.supabase, ctx.pipelineId)
  const { runMusicTimeline } = await import("../music-timeline.js")
  const musicResult = await runMusicTimeline({
    supabase: ctx.supabase,
    pipelineId: ctx.pipelineId,
    stageId: ctx.stageId,
    userId: ctx.userId,
    totalDurationSec: ctx.targetDurationSec,
    config: { music_enabled: ctx.config.music_enabled },
    plan: plan ? { music_plan: plan.music_plan } : {},
  })
  ctx.stageOutputAcc.music_result = musicResult
  return { kind: "continue" }
}

function getMusicResult(ctx: SubStepContext): MusicTimelineResult | null {
  return (ctx.stageOutputAcc.music_result ?? null) as MusicTimelineResult | null
}

/**
 * 7g' — Shot realignment. Runs ONLY when the music sub-step reported
 * `realignmentNeeded` (BPM drift > 2 BPM vs the Showrunner plan). The
 * sub-step persists each scene's updated `duration_seconds` directly via the
 * supabase client; nothing else needs to land on `stageOutputAcc`.
 *
 * NOTE: pre-refactor the gate was `if (musicResult?.realignmentNeeded)` and
 * `completed.realignment = true` was set unconditionally. Here `shouldRun`
 * returns false when there's no realignment work, which mirrors that — the
 * handler still flips `completed[key]=true` for the skipped case.
 */
async function runRealignmentStep(
  ctx: SubStepContext,
): Promise<SubStepResult> {
  const musicResult = getMusicResult(ctx)
  if (!musicResult?.realignmentNeeded) return { kind: "continue" }

  const { runShotRealignment } = await import("./shot-realignment.js")
  await runShotRealignment({
    supabase: ctx.supabase,
    pipelineId: ctx.pipelineId,
    detectedBPM: musicResult.detectedBPM,
    plannedBPM: musicResult.plannedBPM,
    beatGrid: musicResult.beatGrid,
  })
  return { kind: "continue" }
}

/**
 * 7h — Editor LLM. Sonnet vision call that emits per-shot `cut_decisions`.
 * Paid (LLM call) — must checkpoint after success.
 *
 * Mutates the scenes list: `persistCutDecisions` returns a fresh
 * `SubStepSceneRow[]` with the new `cut_decision` patched onto every shot
 * with a matching decision, and we surface it via `scenesPatch` so the
 * downstream final_merge sees the patched view without an extra round-trip.
 *
 * When the scene list has no shots (degenerate input), we treat the step as
 * a no-op `continue` — matches the pre-refactor `completed.editor = true;`
 * early-return for the empty-shots case.
 */
async function runEditorStep(ctx: SubStepContext): Promise<SubStepResult> {
  const shotInputs = collectAllShotsFromScenes(ctx.scenes)
  if (shotInputs.length === 0) return { kind: "continue" }

  const plan = await loadShowrunnerPlan(ctx.supabase, ctx.pipelineId)
  const musicResult = getMusicResult(ctx)
  const { runEditor } = await import("../llms/editor.js")
  const editorResult = await runEditor({
    supabase: ctx.supabase,
    pipelineId: ctx.pipelineId,
    stageId: ctx.stageId,
    userId: ctx.userId,
    shots: shotInputs,
    beatGrid: musicResult?.beatGrid ?? [],
    targetDurationSec: ctx.targetDurationSec,
    globalStyle: plan?.global_style as Record<string, unknown> | undefined,
  })
  const nextScenes = await persistCutDecisions(
    ctx.supabase,
    ctx.scenes,
    editorResult.cut_decisions,
  )
  return { kind: "continue", scenesPatch: nextScenes }
}

/**
 * 7j — Final merge (MP4) OR FreeCut export (JSON / FCPXML).
 *
 * Branches:
 *   - useFreecut=true + format=fcpxml  → `generateFcpxmlExport`
 *   - useFreecut=true + format=json    → `generateFreecutExport`
 *   - else                             → `pipelineFinalMerge` (FFmpeg MP4)
 *
 * `useFreecut` requires BOTH `config.freecut_export_enabled === true` AND
 * `mode === "manual"` (auto/guided always produce a final MP4 — the
 * post-pipeline NLE workflow only makes sense in manual). All three branches
 * accept the optional narration URL surfaced by sub-step 7c.
 *
 * Failure modes propagate as `terminal_fail` so the handler invokes
 * `failAndMarkTerminal` and the finally clause skips its flush (avoiding a
 * clobber of `failure_reason`).
 */
async function runFinalMergeStep(
  ctx: SubStepContext,
): Promise<SubStepResult> {
  const mergeScenes = loadScenesWithCutDecisions(ctx.scenes)
  if (mergeScenes.length === 0) {
    return { kind: "terminal_fail", reason: "no_scene_composites_for_final_merge" }
  }

  const musicResult = getMusicResult(ctx)
  const useFreecut =
    ctx.config.freecut_export_enabled === true && ctx.mode === "manual"
  const narrationAssetUrl =
    (ctx.stageOutputAcc.narration_audio_url as string | undefined) ?? ""

  let finalAssetId: string | null = null
  let finalAssetUrl = ""
  let finalOutputFormat: "mp4" | "freecut" | "fcpxml" = "mp4"
  try {
    if (useFreecut) {
      const exportFormat = ctx.config.freecut_export_format ?? "json"
      if (exportFormat === "fcpxml") {
        const { generateFcpxmlExport } = await import("../freecut-fcpxml.js")
        const exportResult = await generateFcpxmlExport({
          supabase: ctx.supabase,
          pipelineId: ctx.pipelineId,
          userId: ctx.userId,
          scenes: mergeScenes,
          musicAssetUrl: musicResult?.musicAssetUrl ?? "",
          narrationAssetUrl,
        })
        finalAssetId = exportResult.exportAssetId
        finalAssetUrl = exportResult.exportAssetUrl
        finalOutputFormat = "fcpxml"
      } else {
        const { generateFreecutExport } = await import("../freecut-export.js")
        const exportResult = await generateFreecutExport({
          supabase: ctx.supabase,
          pipelineId: ctx.pipelineId,
          userId: ctx.userId,
          scenes: mergeScenes,
          musicAssetUrl: musicResult?.musicAssetUrl ?? "",
          narrationAssetUrl,
        })
        finalAssetId = exportResult.exportAssetId
        finalAssetUrl = exportResult.exportAssetUrl
        finalOutputFormat = "freecut"
      }
    } else {
      const { pipelineFinalMerge } = await import(
        "../services/pipeline-final-merge.js"
      )
      const result = await pipelineFinalMerge({
        supabase: ctx.supabase,
        pipelineId: ctx.pipelineId,
        userId: ctx.userId,
        scenes: mergeScenes,
        musicAssetUrl: musicResult?.musicAssetUrl ?? "",
        narrationAssetUrl,
      })
      finalAssetId = result.finalAssetId
      finalAssetUrl = result.finalAssetUrl
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { kind: "terminal_fail", reason: `final_merge_failed: ${msg}` }
  }

  const { error: pipelineUpdateErr } = await ctx.supabase
    .from("pipelines")
    .update({ final_output_asset_id: finalAssetId })
    .eq("id", ctx.pipelineId)
  if (pipelineUpdateErr) {
    return {
      kind: "terminal_fail",
      reason: `pipelines_update_failed: ${pipelineUpdateErr.message}`,
    }
  }

  ctx.stageOutputAcc.final_output_url = finalAssetUrl
  ctx.stageOutputAcc.final_output_asset_id = finalAssetId
  ctx.stageOutputAcc.final_output_format = finalOutputFormat
  return { kind: "continue" }
}

/* --- The registry ----------------------------------------------------- */

/**
 * Order is load-bearing — sub-steps consume earlier sub-steps' outputs from
 * `stageOutputAcc` (e.g. final_merge reads `narration_audio_url` AND
 * `music_result`). The order snapshot is pinned by a registry-order test in
 * `__tests__/animate-audio-edit.test.ts` so a careless append doesn't break
 * the 7c→7d'→7e'→7f/g→7g'→7h→7j chain.
 *
 * Methods 3/8/10 in Phase 1C.3 will APPEND to this array (no inserts into
 * the middle).
 */
export const STAGE_7_SUB_STEPS: ReadonlyArray<SubStepDef> = [
  {
    key: "narration",
    // Always run — the wrapper gates on narration_enabled AND plan
    // availability so the checkpoint (`completed.narration=true`) is written
    // even for the no-op path. `shouldRun: () => true` preserves the
    // pre-refactor's defensive completion semantics.
    shouldRun: () => true,
    run: runNarrationStep,
    checkpoint: true,
  },
  {
    key: "dialogue_recheck",
    shouldRun: () => true,
    run: runDialogueRecheckStep,
    checkpoint: false,
  },
  {
    key: "silent_cut",
    shouldRun: () => true,
    run: runSilentCutStep,
    checkpoint: false,
  },
  {
    key: "music",
    shouldRun: () => true,
    run: runMusicStep,
    checkpoint: true,
  },
  {
    key: "realignment",
    shouldRun: () => true,
    run: runRealignmentStep,
    checkpoint: false,
  },
  {
    key: "editor",
    shouldRun: () => true,
    run: runEditorStep,
    checkpoint: true,
  },
  {
    key: "final_merge",
    shouldRun: () => true,
    run: runFinalMergeStep,
    checkpoint: true,
  },
]
