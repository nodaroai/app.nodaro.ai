import type { SupabaseClient } from "@supabase/supabase-js"
import type { TransitionType } from "@nodaro/shared"
import { uploadBufferToR2 } from "../../lib/storage.js"
import { randomUUID } from "node:crypto"

/**
 * Phase 1C.2 sub-step 7j (alternative path) — FreeCut export.
 *
 * When the user opts in via `pipelines.config.freecut_export_enabled = true`
 * AND the pipeline is running in `mode = "manual"`, Stage 7's final-merge
 * step takes this alternative branch instead of `pipelineFinalMerge`.
 *
 * Rather than render a single concatenated MP4, we emit a flat JSON
 * timeline that any FreeCut / NLE-compatible editor can import. The shape
 * is "Nodaro-flat-timeline-v1" — close to FreeCut's wire format but kept
 * loose enough to evolve. Real FreeCut compatibility is a follow-up; most
 * NLE software can ingest via XML/EDL converters from this shape.
 *
 * Credits: 0 (`pipeline-freecut-export` per migration 135). The pipeline-
 * level upfront reservation already covers the 3 credits the regular
 * final-merge path would have charged; FreeCut's 0-cost slot leaves the
 * reservation intact and the unused 3cr refunded as part of pipeline
 * settlement (no per-job reservation here).
 *
 * Asset persistence: the JSON file is uploaded to R2 and an `assets` row
 * is inserted with `type = 'document'` + `mime_type = 'application/json'`.
 * The returned asset id is written to `pipelines.final_output_asset_id`
 * (caller's responsibility, mirroring the `pipelineFinalMerge` flow).
 */

export interface FreecutShotInput {
  shot_id: string
  duration_seconds: number
  cut_decision?: {
    in_offset_sec: number
    out_offset_sec: number
    transition_to_next: TransitionType
    transition_duration_sec?: number
  }
}

export interface FreecutSceneInput {
  sceneEntityId: string
  compositeUrl: string
  shots: ReadonlyArray<FreecutShotInput>
}

export interface FreecutExportArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  scenes: ReadonlyArray<FreecutSceneInput>
  /** R2 URL of the merged music track. Empty string skips the music track. */
  musicAssetUrl: string
  /**
   * Phase 1C.2.1 §H2 — R2 URL of the narration audio track from sub-step
   * 7c. When present, emits a SECOND audio track entry on the timeline so
   * downstream NLEs can render music + narration as separate layers (no
   * pre-mix happens here; FFmpeg ducking is the MP4 path's concern).
   * Empty/undefined skips the narration track.
   */
  narrationAssetUrl?: string
  /** Tail fade-out applied to the music clip in seconds. Default 0.8 — matches
   *  pipelineFinalMerge / spec §6 sub-step 7g. */
  fadeOutDurationSec?: number
}

export interface FreecutClipTransition {
  type: TransitionType
  duration_sec: number
}

export interface FreecutVideoClip {
  asset_url: string
  start_in_clip_sec: number
  end_in_clip_sec: number
  timeline_position_sec: number
  transition_in: FreecutClipTransition | null
  transition_out: FreecutClipTransition | null
}

export interface FreecutAudioClip {
  asset_url: string
  start_in_clip_sec: number
  end_in_clip_sec: number
  timeline_position_sec: number
  fade_out_sec: number
}

export interface FreecutTimeline {
  version: "1.0"
  format: "freecut-v1"
  duration_seconds: number
  tracks: Array<
    | { type: "video"; clips: FreecutVideoClip[] }
    | { type: "audio"; clips: FreecutAudioClip[] }
  >
  metadata: {
    pipeline_id: string
    generated_at: string
    note: string
  }
}

export interface FreecutExportResult {
  exportAssetId: string | null
  /** R2 URL to the .json file. */
  exportAssetUrl: string
}

const DEFAULT_FADE_OUT_SEC = 0.8
const TRANSITION_DEFAULT_DURATION_SEC = 0.5
const OVERLAP_DEFAULT_DURATION_SEC = 1.0
const FORMAT_NOTE =
  "Format is Nodaro-flat-timeline-v1; FreeCut compatibility is a follow-up — most NLE software can ingest via XML/EDL converters."

/**
 * Build the timeline + upload as JSON + persist asset row. Returns the new
 * asset id + R2 URL. Mirrors the per-scene + per-shot reduction in
 * `pipelineFinalMerge` so the resulting timeline lines up with what the
 * MP4 path would have produced.
 */
export async function generateFreecutExport(
  args: FreecutExportArgs,
): Promise<FreecutExportResult> {
  const {
    supabase,
    pipelineId,
    userId,
    scenes,
    musicAssetUrl,
    narrationAssetUrl,
    fadeOutDurationSec = DEFAULT_FADE_OUT_SEC,
  } = args

  if (scenes.length === 0) {
    throw new Error("generateFreecutExport requires at least 1 scene")
  }

  // 1. Build the flat per-clip timeline. Each scene becomes one video clip;
  //    cut_decision drives the head/tail trim window + transitions between
  //    adjacent scenes. Scene-internal transitions are already baked into
  //    each scene composite by Stage 7's per-scene combine (same simplification
  //    pipelineFinalMerge documents).
  const videoClips: FreecutVideoClip[] = []
  let runningTimelinePos = 0

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!
    const firstShot = scene.shots[0]
    const lastShot = scene.shots[scene.shots.length - 1]
    const inOffset = firstShot?.cut_decision?.in_offset_sec ?? 0
    const outOffset = lastShot?.cut_decision?.out_offset_sec ?? 0

    // Full composite duration = sum of per-shot duration_seconds. Per-shot
    // trims within the scene are NOT applied to the composite (Stage 7
    // already merged the shots). The scene-boundary trim window is:
    //   start_in_clip = inOffset  (head trim)
    //   end_in_clip   = compositeFullDur - outOffset  (tail trim)
    const compositeFullDur = scene.shots.reduce(
      (acc, s) => acc + (s.duration_seconds ?? 0),
      0,
    )
    const startInClip = Math.max(0, inOffset)
    const endInClip = Math.max(startInClip, compositeFullDur - outOffset)
    const clipDur = Math.max(0, endInClip - startInClip)

    // Transition INTO this clip is the previous scene's transition_to_next.
    const prevScene = i > 0 ? scenes[i - 1]! : null
    const prevLastShot =
      prevScene?.shots[prevScene.shots.length - 1] ?? null
    const transitionIn =
      prevLastShot?.cut_decision != null
        ? buildTransition(prevLastShot.cut_decision)
        : null

    // Transition OUT of this clip is this scene's last shot's transition.
    const transitionOut =
      i < scenes.length - 1 && lastShot?.cut_decision != null
        ? buildTransition(lastShot.cut_decision)
        : null

    videoClips.push({
      asset_url: scene.compositeUrl,
      start_in_clip_sec: round3(startInClip),
      end_in_clip_sec: round3(endInClip),
      timeline_position_sec: round3(runningTimelinePos),
      transition_in: transitionIn,
      transition_out: transitionOut,
    })

    // Advance the timeline cursor. Adjacent clips with a transition overlap
    // by transition.duration_sec (xfade-style); hard_cut transitions don't
    // overlap (timeline advances by the full clip duration).
    const overlapWithNext =
      transitionOut && (transitionOut.type === "dissolve" || transitionOut.type === "overlap")
        ? transitionOut.duration_sec
        : 0
    runningTimelinePos += clipDur - overlapWithNext
  }

  // 2. Build the audio track (single music clip across the whole timeline).
  const totalDurationSec = videoClips.reduce(
    (acc, c) => acc + (c.end_in_clip_sec - c.start_in_clip_sec),
    0,
  )
  // The timeline length is `runningTimelinePos + last clip's residual`; the
  // running cursor already accounts for transition overlaps so it's the
  // authoritative final position UNLESS the last clip has no transition_out
  // (typical) — in which case totalDurationSec == runningTimelinePos.
  const timelineDuration = round3(runningTimelinePos + 0)
  const musicClips: FreecutAudioClip[] =
    musicAssetUrl.length > 0
      ? [
          {
            asset_url: musicAssetUrl,
            start_in_clip_sec: 0,
            end_in_clip_sec: round3(timelineDuration),
            timeline_position_sec: 0,
            fade_out_sec: round3(fadeOutDurationSec),
          },
        ]
      : []

  // Phase 1C.2.1 §H2 — narration is a SEPARATE audio track (not pre-mixed
  // with music here; the MP4 path's amix filter handles ducking, but
  // FreeCut exports keep tracks separate so the NLE can re-mix).
  const narrationClips: FreecutAudioClip[] =
    narrationAssetUrl && narrationAssetUrl.length > 0
      ? [
          {
            asset_url: narrationAssetUrl,
            start_in_clip_sec: 0,
            end_in_clip_sec: round3(timelineDuration),
            timeline_position_sec: 0,
            fade_out_sec: 0,
          },
        ]
      : []

  const tracks: FreecutTimeline["tracks"] = [
    { type: "video", clips: videoClips },
  ]
  if (musicClips.length > 0) {
    tracks.push({ type: "audio", clips: musicClips })
  }
  if (narrationClips.length > 0) {
    tracks.push({ type: "audio", clips: narrationClips })
  }

  const timeline: FreecutTimeline = {
    version: "1.0",
    format: "freecut-v1",
    duration_seconds: round3(timelineDuration),
    tracks,
    metadata: {
      pipeline_id: pipelineId,
      generated_at: new Date().toISOString(),
      note: FORMAT_NOTE,
    },
  }

  // 3. Serialize + upload to R2 under a deterministic-ish key.
  const json = JSON.stringify(timeline, null, 2)
  const buffer = Buffer.from(json, "utf-8")
  const filename = `freecut-${randomUUID()}.json`
  const r2Key = `pipelines/${pipelineId}/exports/${filename}`
  const r2Url = await uploadBufferToR2(
    buffer,
    r2Key,
    "application/json",
    userId,
  )

  // 4. Insert the assets row. The CHECK constraint on `assets.type`
  //    accepts ('image', 'video', 'audio', 'document') per migration 001;
  //    JSON timelines map to 'document'.
  const { data: inserted, error } = await supabase
    .from("assets")
    .insert({
      user_id: userId,
      type: "document",
      filename,
      mime_type: "application/json",
      size_bytes: buffer.length,
      r2_key: r2Key,
      r2_url: r2Url,
      pipeline_id: pipelineId,
      metadata: { source: "pipeline-freecut-export", format: "freecut-v1" },
    })
    .select("id")
    .single()
  if (error) {
    console.error("[pipeline-freecut-export] assets insert failed:", error.message)
  }

  return {
    exportAssetId: (inserted?.id as string | undefined) ?? null,
    exportAssetUrl: r2Url,
  }
}

function buildTransition(decision: {
  transition_to_next: TransitionType
  transition_duration_sec?: number
}): FreecutClipTransition {
  const fallback =
    decision.transition_to_next === "overlap"
      ? OVERLAP_DEFAULT_DURATION_SEC
      : decision.transition_to_next === "hard_cut" ||
          decision.transition_to_next === "match_cut"
        ? 0
        : TRANSITION_DEFAULT_DURATION_SEC
  return {
    type: decision.transition_to_next,
    duration_sec: round3(decision.transition_duration_sec ?? fallback),
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
