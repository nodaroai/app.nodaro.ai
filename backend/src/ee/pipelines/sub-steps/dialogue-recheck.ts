import type { SupabaseClient } from "@supabase/supabase-js"
import type { SceneNodeData, ShotSpec } from "@nodaro/shared"
import { pipelineEvents } from "../events.js"

/**
 * Phase 1C.2 sub-step 7d' — Dialogue duration recheck.
 *
 * After Stage 7 step 4 (speech generation) populates each shot's
 * `actual_audio_duration_sec`, we reconcile the recorded audio length against
 * the planned `duration_seconds` for every shot with `dialogue_line`. If the
 * actual audio is longer than the plan, we:
 *   1. Cap the shot's new duration at 8s (ShotSpec hard max).
 *   2. Set `dialogue_no_cut_zone = { start: 0, end: actual_audio_duration_sec }`
 *      so the Editor LLM (sub-step 7h) never cuts inside the dialogue.
 *   3. Rebalance the delta by proportionally subtracting from the longest
 *      non-dialogue shots in the SAME scene.
 *   4. If the rebalance can't keep the scene total within ±10% of the original
 *      target, log a warning + flag the scene for user approval.
 *
 * Mode behavior:
 *   - auto:           always proceed; warnings emitted via `pipeline:warning`.
 *   - manual/guided:  if ANY scene flagged → caller pauses at sub-gate
 *                     'dialogue_recheck'; otherwise auto-advance.
 *
 * Updates land directly on `pipeline_entities.metadata.scene_node_data.shots[]`.
 */

const SHOT_MAX_DURATION = 8 // ShotSpec.duration_seconds Zod max
const SCENE_TOTAL_TOLERANCE = 0.10 // ±10% of original target

export interface DialogueRecheckArgs {
  supabase: SupabaseClient
  pipelineId: string
  mode: "manual" | "guided" | "auto"
}

export interface DialogueRebalanceEntry {
  scene_entity_id: string
  shot_id: string
  delta_sec: number
  new_intended_duration_sec: number
}

export interface DialogueRecheckResult {
  ok: boolean
  rebalances: DialogueRebalanceEntry[]
  warnings: string[]
  awaitingUserDecision: boolean
}

interface SceneRow {
  id: string
  entity_key: string
  metadata: Record<string, unknown> | null
}

/**
 * Runs the dialogue recheck across every scene in the pipeline. Persists any
 * updated shot durations + dialogue_no_cut_zone fields back to each scene's
 * `scene_node_data` and returns the per-shot rebalances + warnings.
 */
export async function runDialogueRecheck(
  args: DialogueRecheckArgs,
): Promise<DialogueRecheckResult> {
  const { supabase, pipelineId, mode } = args

  const { data: scenes, error: scenesErr } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")
    .order("entity_key", { ascending: true })
  if (scenesErr) {
    return {
      ok: false,
      rebalances: [],
      warnings: [`load_scenes_failed: ${scenesErr.message}`],
      awaitingUserDecision: false,
    }
  }
  if (!scenes || scenes.length === 0) {
    return { ok: true, rebalances: [], warnings: [], awaitingUserDecision: false }
  }

  const rebalances: DialogueRebalanceEntry[] = []
  const warnings: string[] = []
  let anyAwaiting = false

  for (const sceneRow of scenes as SceneRow[]) {
    const meta = sceneRow.metadata as Record<string, unknown> | null
    const sceneNodeData = meta?.scene_node_data as SceneNodeData | undefined
    if (!sceneNodeData?.shots || sceneNodeData.shots.length === 0) continue

    const result = rebalanceScene(sceneNodeData)
    if (result.rebalances.length === 0 && result.warnings.length === 0) continue

    for (const r of result.rebalances) {
      rebalances.push({
        scene_entity_id: sceneRow.id,
        shot_id: r.shot_id,
        delta_sec: r.delta_sec,
        new_intended_duration_sec: r.new_intended_duration_sec,
      })
    }
    for (const w of result.warnings) {
      warnings.push(`scene[${sceneRow.entity_key}]: ${w}`)
    }
    if (result.exceedsTolerance) anyAwaiting = true

    // Persist updated shots back to scene metadata.
    const nextMeta = {
      ...(meta ?? {}),
      scene_node_data: {
        ...sceneNodeData,
        shots: result.updatedShots,
      },
    }
    const { error: updateErr } = await supabase
      .from("pipeline_entities")
      .update({ metadata: nextMeta })
      .eq("id", sceneRow.id)
    if (updateErr) {
      warnings.push(
        `scene[${sceneRow.entity_key}]: persist_failed: ${updateErr.message}`,
      )
    }
  }

  // Mode-specific behavior:
  //   auto      → never pause; emit pipeline:warning for every warning.
  //   manual/guided → pause when any scene exceeded ±10% tolerance.
  if (mode === "auto") {
    for (const message of warnings) {
      pipelineEvents.publish({
        type: "pipeline:warning",
        pipelineId,
        code: "dialogue_recheck_rebalance",
        message,
      })
    }
    return { ok: true, rebalances, warnings, awaitingUserDecision: false }
  }

  return { ok: true, rebalances, warnings, awaitingUserDecision: anyAwaiting }
}

interface SceneRebalanceResult {
  updatedShots: ShotSpec[]
  rebalances: Array<{
    shot_id: string
    delta_sec: number
    new_intended_duration_sec: number
  }>
  warnings: string[]
  exceedsTolerance: boolean
}

/**
 * Per-scene rebalance helper. Pure (no DB). Returns the next shot list +
 * rebalance entries + warnings + a flag for whether the scene exceeded ±10% of
 * its original total. Exported for unit testing.
 */
export function rebalanceScene(sceneNodeData: SceneNodeData): SceneRebalanceResult {
  const shots = sceneNodeData.shots
  const originalTotal = shots.reduce((sum, s) => sum + s.duration_seconds, 0)

  // 1. Find overflowing dialogue shots — `actual_audio_duration_sec` exceeds
  //    the planned `duration_seconds`. Cap each at SHOT_MAX_DURATION.
  const overflows: Array<{
    shot_id: string
    delta_sec: number
    new_duration_sec: number
    audio_duration_sec: number
  }> = []
  for (const s of shots) {
    if (!s.dialogue_line) continue
    const audioDur = s.actual_audio_duration_sec
    if (typeof audioDur !== "number" || audioDur <= s.duration_seconds) continue
    const cappedDur = Math.min(audioDur, SHOT_MAX_DURATION)
    const delta = cappedDur - s.duration_seconds
    if (delta <= 0) continue
    overflows.push({
      shot_id: s.shot_id,
      delta_sec: delta,
      new_duration_sec: cappedDur,
      audio_duration_sec: audioDur,
    })
  }
  if (overflows.length === 0) {
    return {
      updatedShots: shots as ShotSpec[],
      rebalances: [],
      warnings: [],
      exceedsTolerance: false,
    }
  }

  const totalDelta = overflows.reduce((sum, o) => sum + o.delta_sec, 0)

  // 2. Identify non-dialogue shots in the same scene; sort by duration desc.
  //    These are the candidates we'll subtract from proportionally.
  const overflowIds = new Set(overflows.map((o) => o.shot_id))
  const trimCandidates = shots
    .filter((s) => !s.dialogue_line && !overflowIds.has(s.shot_id))
    .sort((a, b) => b.duration_seconds - a.duration_seconds)

  // 3. Build the shot lookup so we apply both extensions + trims in one pass.
  const trimMap = new Map<string, number>() // shot_id → new duration
  const warnings: string[] = []

  if (trimCandidates.length === 0) {
    warnings.push(
      "no_non_dialogue_shots: cannot rebalance — every shot has dialogue",
    )
  } else {
    const candidateTotal = trimCandidates.reduce(
      (sum, s) => sum + s.duration_seconds,
      0,
    )
    // Distribute the delta proportionally across non-dialogue shots. Floor at
    // 0.3s (ShotSpec.duration_seconds Zod min) so we don't drop a shot to
    // sub-fractional length.
    const SHOT_MIN_DURATION = 0.3
    let remainingDelta = totalDelta
    for (const s of trimCandidates) {
      const proportionalCut = candidateTotal > 0
        ? (s.duration_seconds / candidateTotal) * totalDelta
        : 0
      const newDur = Math.max(SHOT_MIN_DURATION, s.duration_seconds - proportionalCut)
      const actualCut = s.duration_seconds - newDur
      remainingDelta -= actualCut
      trimMap.set(s.shot_id, newDur)
    }
    if (remainingDelta > 0.01) {
      warnings.push(
        `unrebalanced_delta_${remainingDelta.toFixed(2)}s: trim candidates hit floor`,
      )
    }
  }

  // 4. Build updated shots and compute new total.
  const overflowMap = new Map(overflows.map((o) => [o.shot_id, o]))
  const updatedShots: ShotSpec[] = shots.map((s) => {
    const o = overflowMap.get(s.shot_id)
    if (o) {
      return {
        ...s,
        duration_seconds: o.new_duration_sec,
        dialogue_no_cut_zone: { start: 0, end: o.audio_duration_sec },
      }
    }
    const trimmed = trimMap.get(s.shot_id)
    if (trimmed !== undefined) {
      return { ...s, duration_seconds: trimmed }
    }
    return s
  })

  const newTotal = updatedShots.reduce((sum, s) => sum + s.duration_seconds, 0)
  const tolerance = originalTotal * SCENE_TOTAL_TOLERANCE
  const exceedsTolerance = Math.abs(newTotal - originalTotal) > tolerance
  if (exceedsTolerance) {
    warnings.push(
      `scene_total_drift: original=${originalTotal.toFixed(2)}s, new=${newTotal.toFixed(2)}s, tolerance=±${tolerance.toFixed(2)}s`,
    )
  }

  return {
    updatedShots,
    rebalances: overflows.map((o) => ({
      shot_id: o.shot_id,
      delta_sec: o.delta_sec,
      new_intended_duration_sec: o.new_duration_sec,
    })),
    warnings,
    exceedsTolerance,
  }
}
