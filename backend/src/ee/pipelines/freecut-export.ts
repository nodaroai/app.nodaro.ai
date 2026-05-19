import type { SupabaseClient } from "@supabase/supabase-js"
import type { TransitionType } from "@nodaro/shared"
import {
  DEFAULT_FADE_OUT_SEC,
  persistExportAsset,
  reduceTimeline,
  round3,
  type TimelineSceneInput,
  type TimelineShotInput,
} from "./_freecut-timeline.js"

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
 *
 * Phase 1C.3 §J1b — the per-scene clip reduction + asset persistence are
 * shared with `generateFcpxmlExport` via `_freecut-timeline.ts`.
 */

export type FreecutShotInput = TimelineShotInput
export type FreecutSceneInput = TimelineSceneInput

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

  // 1. Build the flat per-clip timeline via the shared reducer. Each scene
  //    becomes one video clip; cut_decision drives the head/tail trim window
  //    + transitions between adjacent scenes. Scene-internal transitions are
  //    already baked into each scene composite by Stage 7's per-scene combine
  //    (same simplification pipelineFinalMerge documents).
  const reduced = reduceTimeline(scenes)
  const videoClips: FreecutVideoClip[] = reduced.clips.map((c) => ({
    asset_url: c.compositeUrl,
    start_in_clip_sec: round3(c.startInClipSec),
    end_in_clip_sec: round3(c.endInClipSec),
    timeline_position_sec: round3(c.timelinePositionSec),
    transition_in: c.transitionIn
      ? { type: c.transitionIn.type, duration_sec: c.transitionIn.durationSec }
      : null,
    transition_out: c.transitionOut
      ? { type: c.transitionOut.type, duration_sec: c.transitionOut.durationSec }
      : null,
  }))

  // 2. Build the audio track (single music clip across the whole timeline).
  //    `reduced.timelineDurationSec` already accounts for transition overlaps.
  const timelineDuration = round3(reduced.timelineDurationSec)
  const musicClips: FreecutAudioClip[] =
    musicAssetUrl.length > 0
      ? [
          {
            asset_url: musicAssetUrl,
            start_in_clip_sec: 0,
            end_in_clip_sec: timelineDuration,
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
            end_in_clip_sec: timelineDuration,
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
    duration_seconds: timelineDuration,
    tracks,
    metadata: {
      pipeline_id: pipelineId,
      generated_at: new Date().toISOString(),
      note: FORMAT_NOTE,
    },
  }

  // 3. Serialize + upload + persist via shared helper.
  const persisted = await persistExportAsset({
    supabase,
    pipelineId,
    userId,
    filenameStem: "freecut",
    fileExtension: "json",
    mimeType: "application/json",
    formatTag: "freecut-v1",
    content: JSON.stringify(timeline, null, 2),
    logTag: "pipeline-freecut-export",
  })

  return {
    exportAssetId: persisted.assetId,
    exportAssetUrl: persisted.assetUrl,
  }
}
