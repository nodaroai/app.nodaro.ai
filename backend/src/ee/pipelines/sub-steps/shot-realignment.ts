import type { SupabaseClient } from "@supabase/supabase-js"
import type { SceneNodeData, ShotSpec } from "@nodaro/shared"

/**
 * Phase 1C.2 sub-step 7g' — Shot-duration realignment for music BPM drift.
 *
 * After the music-timeline sub-step (7f/7g) detects that the generated
 * track's `detectedBPM` drifted >2 BPM from the Showrunner's
 * `plannedBPM`, the planned shot grid no longer lands cleanly on real beats.
 * We try to nudge each shot's `duration_seconds` by ≤ ±1 actual-beat-interval
 * (`60 / detectedBPM`) so the shot's end-of-shot timeline position lands
 * within ±0.1s of a beat in the actual beat grid.
 *
 * **Bounds:**
 *   - Per-shot shift: at most ±1 beat interval.
 *   - Per-scene cumulative shift: must keep scene total within ±0.3s of the
 *     original — otherwise the candidate shift is skipped + a warning logged.
 *   - Skip entirely when `|detectedBPM - plannedBPM| <= 2`.
 *
 * **Persistence:**
 * The spec mentions "Updates passed to Editor as `realigned_intended_duration`
 * (falls back to original when no music or BPM matches plan)." For 1C.2 v1
 * we DIRECTLY mutate `duration_seconds` (simpler — no separate column). The
 * Editor LLM (Section G) reads `duration_seconds` directly. If a future
 * phase needs to preserve the original for diffing/undo, switch to a
 * sidecar `realigned_intended_duration` field.
 *
 * Updates land on `pipeline_entities.metadata.scene_node_data.shots[]` —
 * same persistence path as `runDialogueRecheck` (sub-step 7d').
 */

const BPM_DRIFT_TOLERANCE = 2
const BEAT_SNAP_WINDOW_SEC = 0.1
const SCENE_BUDGET_SEC = 0.3
const SHOT_MIN_DURATION = 0.3 // ShotSpec.duration_seconds Zod min
const SHOT_MAX_DURATION = 8 // ShotSpec.duration_seconds Zod max

export interface ShotRealignmentArgs {
  supabase: SupabaseClient
  pipelineId: string
  detectedBPM: number
  plannedBPM: number
  /** Absolute seconds from start of music. */
  beatGrid: ReadonlyArray<number>
}

export interface ShotRealignmentEntry {
  scene_entity_id: string
  shot_id: string
  original_duration_sec: number
  realigned_duration_sec: number
}

export interface ShotRealignmentResult {
  ok: boolean
  realignedShots: ShotRealignmentEntry[]
  warnings: string[]
}

interface SceneRow {
  id: string
  entity_key: string
  metadata: Record<string, unknown> | null
}

export async function runShotRealignment(
  args: ShotRealignmentArgs,
): Promise<ShotRealignmentResult> {
  const { supabase, pipelineId, detectedBPM, plannedBPM, beatGrid } = args

  // Gate 1 — no BPM drift → no-op.
  if (Math.abs(detectedBPM - plannedBPM) <= BPM_DRIFT_TOLERANCE) {
    return { ok: true, realignedShots: [], warnings: [] }
  }
  // Gate 2 — no beat grid → no snap targets, no-op.
  if (beatGrid.length === 0) {
    return { ok: true, realignedShots: [], warnings: [] }
  }
  // Gate 3 — degenerate BPM → can't compute a beat interval.
  if (detectedBPM <= 0) {
    return { ok: true, realignedShots: [], warnings: [] }
  }

  const beatIntervalSec = 60 / detectedBPM

  const { data: scenes, error: scenesErr } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")
    .order("entity_key", { ascending: true })
  if (scenesErr) {
    return {
      ok: false,
      realignedShots: [],
      warnings: [`load_scenes_failed: ${scenesErr.message}`],
    }
  }
  if (!scenes || scenes.length === 0) {
    return { ok: true, realignedShots: [], warnings: [] }
  }

  const realignedShots: ShotRealignmentEntry[] = []
  const warnings: string[] = []

  // Running cumulative timeline position across scenes — the beat grid is in
  // absolute timeline seconds, so we need the timeline cursor to compute the
  // end-of-shot position for each shot.
  let timelineCursor = 0

  for (const sceneRow of scenes as SceneRow[]) {
    const meta = sceneRow.metadata as Record<string, unknown> | null
    const sceneNodeData = meta?.scene_node_data as SceneNodeData | undefined
    if (!sceneNodeData?.shots || sceneNodeData.shots.length === 0) continue

    const sceneResult = realignSceneShots(
      sceneNodeData.shots,
      timelineCursor,
      beatGrid,
      beatIntervalSec,
    )

    timelineCursor += sceneResult.newSceneTotal

    if (sceneResult.shifts.length === 0 && sceneResult.warnings.length === 0) {
      continue
    }

    for (const w of sceneResult.warnings) {
      warnings.push(`scene[${sceneRow.entity_key}]: ${w}`)
    }
    for (const s of sceneResult.shifts) {
      realignedShots.push({
        scene_entity_id: sceneRow.id,
        shot_id: s.shot_id,
        original_duration_sec: s.original_duration_sec,
        realigned_duration_sec: s.realigned_duration_sec,
      })
    }

    // Persist updated shots back to scene metadata when any shifts applied.
    if (sceneResult.shifts.length > 0) {
      const nextMeta = {
        ...(meta ?? {}),
        scene_node_data: {
          ...sceneNodeData,
          shots: sceneResult.updatedShots,
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
  }

  return { ok: true, realignedShots, warnings }
}

interface SceneRealignResult {
  updatedShots: ShotSpec[]
  shifts: Array<{
    shot_id: string
    original_duration_sec: number
    realigned_duration_sec: number
  }>
  warnings: string[]
  /** New total scene duration after applied shifts. */
  newSceneTotal: number
}

/**
 * Per-scene realignment helper. Pure (no DB). Walks each shot's end-of-shot
 * position and, when it lands mid-beat, picks the nearest valid shift (≤ ±1
 * beat interval, ≥ SHOT_MIN, ≤ SHOT_MAX) that snaps to a beat, subject to the
 * cumulative-budget constraint (±0.3s of the original scene total).
 * Exported for unit testing.
 */
export function realignSceneShots(
  shots: ReadonlyArray<ShotSpec>,
  sceneStartOffsetSec: number,
  beatGrid: ReadonlyArray<number>,
  beatIntervalSec: number,
): SceneRealignResult {
  const originalTotal = shots.reduce((sum, s) => sum + s.duration_seconds, 0)
  const shifts: SceneRealignResult["shifts"] = []
  const warnings: string[] = []

  const updatedShots: ShotSpec[] = shots.map((s) => ({ ...s }))
  let cumulativeShift = 0 // signed
  let cursor = sceneStartOffsetSec

  for (let i = 0; i < updatedShots.length; i++) {
    const shot = updatedShots[i]!
    const proposedEnd = cursor + shot.duration_seconds

    // Already on-beat? No shift needed.
    if (isOnBeat(proposedEnd, beatGrid, BEAT_SNAP_WINDOW_SEC)) {
      cursor = proposedEnd
      continue
    }

    // Find the closest beat within ±1 beat-interval of proposedEnd.
    const targetBeat = nearestBeatWithinWindow(
      proposedEnd,
      beatGrid,
      beatIntervalSec,
    )
    if (targetBeat == null) {
      cursor = proposedEnd
      continue
    }

    const candidateNewDur = targetBeat - cursor
    if (
      candidateNewDur < SHOT_MIN_DURATION ||
      candidateNewDur > SHOT_MAX_DURATION
    ) {
      // Snap would violate ShotSpec bounds.
      warnings.push(
        `shot[${shot.shot_id}]: candidate_out_of_bounds (would set duration=${candidateNewDur.toFixed(3)}s)`,
      )
      cursor = proposedEnd
      continue
    }

    const shiftDelta = candidateNewDur - shot.duration_seconds
    // Check cumulative budget before committing.
    const nextCumulative = cumulativeShift + shiftDelta
    if (Math.abs(nextCumulative) > SCENE_BUDGET_SEC) {
      warnings.push(
        `shot[${shot.shot_id}]: budget_exceeded (would push cumulative shift to ${nextCumulative.toFixed(3)}s, max ±${SCENE_BUDGET_SEC}s)`,
      )
      cursor = proposedEnd
      continue
    }

    // Apply the shift.
    shifts.push({
      shot_id: shot.shot_id,
      original_duration_sec: shot.duration_seconds,
      realigned_duration_sec: candidateNewDur,
    })
    updatedShots[i] = { ...shot, duration_seconds: candidateNewDur }
    cumulativeShift = nextCumulative
    cursor = targetBeat
  }

  const newSceneTotal = updatedShots.reduce(
    (sum, s) => sum + s.duration_seconds,
    0,
  )

  // Sanity: cumulative shift should match (newTotal - originalTotal).
  const drift = Math.abs(newSceneTotal - originalTotal - cumulativeShift)
  if (drift > 0.01) {
    warnings.push(
      `cumulative_shift_mismatch: drift=${drift.toFixed(3)}s (likely arithmetic edge)`,
    )
  }

  return { updatedShots, shifts, warnings, newSceneTotal }
}

/**
 * True when `t` is within `window` seconds of any beat in `beatGrid`.
 * Exported for unit testing.
 */
export function isOnBeat(
  t: number,
  beatGrid: ReadonlyArray<number>,
  window: number,
): boolean {
  for (const b of beatGrid) {
    if (Math.abs(b - t) <= window) return true
  }
  return false
}

/**
 * Returns the beat in `beatGrid` closest to `t` AND within `±beatIntervalSec`
 * of it. Returns null when no beat is close enough.
 * Exported for unit testing.
 */
export function nearestBeatWithinWindow(
  t: number,
  beatGrid: ReadonlyArray<number>,
  beatIntervalSec: number,
): number | null {
  let best: number | null = null
  let bestDelta = Infinity
  for (const b of beatGrid) {
    const delta = Math.abs(b - t)
    if (delta <= beatIntervalSec && delta < bestDelta) {
      best = b
      bestDelta = delta
    }
  }
  return best
}
