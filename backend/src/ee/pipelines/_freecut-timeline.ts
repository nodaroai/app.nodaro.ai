import type { SupabaseClient } from "@supabase/supabase-js"
import type { TransitionType } from "@nodaro/shared"
import { uploadBufferToR2 } from "../../lib/storage.js"
import { randomUUID } from "node:crypto"

/**
 * Phase 1C.3 §J1b — shared reduction + persistence helpers for the FreeCut
 * exporters.
 *
 * Both `generateFreecutExport` (JSON) and `generateFcpxmlExport` (FCPXML)
 * derive their per-scene clip layout from the same shot inputs, with the
 * same head/tail trim semantics and the same adjacent-scene transition
 * rules. Without this module the reduction lived twice (drift hazard); now
 * the two serializers walk a shared `ReducedClip[]` and only differ in how
 * they render the final document.
 *
 * Caveats preserved from the original implementations:
 *  - Per-shot trims WITHIN a scene are NOT honored — the scene composite is
 *    pre-merged by Stage 7's per-scene combine; only the FIRST and LAST
 *    shot's `cut_decision` contribute (head trim / tail trim / out-transition).
 *  - `hard_cut` and `match_cut` transitions have zero overlap (timeline
 *    cursor advances by the full clip duration); `dissolve` / `overlap`
 *    overlap by `duration_sec`.
 */

/* ─────────────────────────────── constants ────────────────────────────── */

export const DEFAULT_FADE_OUT_SEC = 0.8
export const TRANSITION_DEFAULT_DURATION_SEC = 0.5
export const OVERLAP_DEFAULT_DURATION_SEC = 1.0

/* ───────────────────────────── numeric helper ─────────────────────────── */

/** Rounds to 3 decimals (millisecond resolution for timeline math). */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/* ──────────────────────── shared input + output types ─────────────────── */

export interface TimelineShotInput {
  shot_id: string
  duration_seconds: number
  cut_decision?: {
    in_offset_sec: number
    out_offset_sec: number
    transition_to_next: TransitionType
    transition_duration_sec?: number
  }
}

export interface TimelineSceneInput {
  sceneEntityId: string
  compositeUrl: string
  shots: ReadonlyArray<TimelineShotInput>
}

export interface NormalizedTransition {
  type: TransitionType
  /** Effective duration in seconds (already defaults-resolved + rounded). */
  durationSec: number
}

export interface ReducedClip {
  sceneEntityId: string
  compositeUrl: string
  fullDurationSec: number
  /** Head-trim — where inside the source asset the clip starts. */
  startInClipSec: number
  /** Tail-trim end — where inside the source asset the clip ends. */
  endInClipSec: number
  /** On-timeline length of the clip (endInClip - startInClip, ≥ 0). */
  clipDurationSec: number
  /** Where the clip lands on the master timeline (after overlap math). */
  timelinePositionSec: number
  /**
   * Transition entering this clip — derived from the PREVIOUS scene's last
   * shot's `transition_to_next`. Null for the first clip OR when the prev
   * shot has no `cut_decision`.
   */
  transitionIn: NormalizedTransition | null
  /**
   * Transition leaving this clip — derived from THIS scene's last shot's
   * `transition_to_next`. Null for the last clip OR when the shot has no
   * `cut_decision`.
   */
  transitionOut: NormalizedTransition | null
}

export interface TimelineState {
  clips: ReducedClip[]
  /** Sum of clip durations minus dissolve/overlap overlaps, ≥ 0. */
  timelineDurationSec: number
}

/* ─────────────────────────── transition helper ────────────────────────── */

/**
 * Resolves a shot's `cut_decision` into a normalized `{type, durationSec}`.
 * Default durations:
 *   - hard_cut / match_cut → 0 (butt-join)
 *   - overlap              → 1.0s
 *   - everything else      → 0.5s
 * Explicit `transition_duration_sec` overrides the default.
 */
export function normalizeTransition(decision: {
  transition_to_next: TransitionType
  transition_duration_sec?: number
}): NormalizedTransition {
  const fallback =
    decision.transition_to_next === "overlap"
      ? OVERLAP_DEFAULT_DURATION_SEC
      : decision.transition_to_next === "hard_cut" ||
          decision.transition_to_next === "match_cut"
        ? 0
        : TRANSITION_DEFAULT_DURATION_SEC
  return {
    type: decision.transition_to_next,
    durationSec: round3(decision.transition_duration_sec ?? fallback),
  }
}

/* ─────────────────────────── main reduction pass ──────────────────────── */

/**
 * Walks the per-scene + per-shot inputs and produces the flat clip plan
 * both exporters consume. Pure — same input always yields the same output.
 */
export function reduceTimeline(
  scenes: ReadonlyArray<TimelineSceneInput>,
): TimelineState {
  const clips: ReducedClip[] = []
  let runningPos = 0

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!
    const firstShot = scene.shots[0]
    const lastShot = scene.shots[scene.shots.length - 1]
    const inOffset = firstShot?.cut_decision?.in_offset_sec ?? 0
    const outOffset = lastShot?.cut_decision?.out_offset_sec ?? 0

    const fullDur = scene.shots.reduce(
      (acc, s) => acc + (s.duration_seconds ?? 0),
      0,
    )
    const startInClip = Math.max(0, inOffset)
    const endInClip = Math.max(startInClip, fullDur - outOffset)
    const clipDur = Math.max(0, endInClip - startInClip)

    const prevScene = i > 0 ? scenes[i - 1]! : null
    const prevLastShot = prevScene?.shots[prevScene.shots.length - 1] ?? null
    const transitionIn =
      prevLastShot?.cut_decision != null
        ? normalizeTransition(prevLastShot.cut_decision)
        : null

    const transitionOut =
      i < scenes.length - 1 && lastShot?.cut_decision != null
        ? normalizeTransition(lastShot.cut_decision)
        : null

    clips.push({
      sceneEntityId: scene.sceneEntityId,
      compositeUrl: scene.compositeUrl,
      fullDurationSec: fullDur,
      startInClipSec: startInClip,
      endInClipSec: endInClip,
      clipDurationSec: clipDur,
      timelinePositionSec: runningPos,
      transitionIn,
      transitionOut,
    })

    // Advance the cursor — dissolve/overlap overlap by their duration;
    // hard_cut / match_cut don't overlap.
    const overlap =
      transitionOut &&
      (transitionOut.type === "dissolve" || transitionOut.type === "overlap")
        ? transitionOut.durationSec
        : 0
    runningPos += clipDur - overlap
  }

  return {
    clips,
    timelineDurationSec: Math.max(0, runningPos),
  }
}

/* ──────────────────────────── asset persistence ───────────────────────── */

export interface PersistExportAssetArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  /** Suffix-less unique filename component (the random id half). */
  filenameStem: string
  fileExtension: "json" | "fcpxml"
  mimeType: "application/json" | "application/xml"
  /** What goes into `assets.metadata.format`. */
  formatTag: string
  /** Serialized content to upload (UTF-8 text). */
  content: string
  /** Tag for the warn line if the assets insert fails. */
  logTag: string
}

export interface PersistExportAssetResult {
  assetId: string | null
  assetUrl: string
}

/**
 * Uploads the serialized timeline document to R2 and inserts an `assets`
 * row of `type='document'`. Returns the (nullable) asset id + R2 URL —
 * mirrors the original per-exporter persistence step. Failures in the
 * assets insert are logged but non-fatal (R2 upload already succeeded).
 */
export async function persistExportAsset(
  args: PersistExportAssetArgs,
): Promise<PersistExportAssetResult> {
  const {
    supabase,
    pipelineId,
    userId,
    filenameStem,
    fileExtension,
    mimeType,
    formatTag,
    content,
    logTag,
  } = args

  const buffer = Buffer.from(content, "utf-8")
  const filename = `${filenameStem}-${randomUUID()}.${fileExtension}`
  const r2Key = `pipelines/${pipelineId}/exports/${filename}`
  const r2Url = await uploadBufferToR2(buffer, r2Key, mimeType, userId)

  const { data: inserted, error } = await supabase
    .from("assets")
    .insert({
      user_id: userId,
      type: "document",
      filename,
      mime_type: mimeType,
      size_bytes: buffer.length,
      r2_key: r2Key,
      r2_url: r2Url,
      pipeline_id: pipelineId,
      metadata: { source: "pipeline-freecut-export", format: formatTag },
    })
    .select("id")
    .single()
  if (error) {
    console.error(`[${logTag}] assets insert failed:`, error.message)
  }

  return {
    assetId: (inserted?.id as string | undefined) ?? null,
    assetUrl: r2Url,
  }
}
