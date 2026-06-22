import type { SupabaseClient } from "@supabase/supabase-js"
import {
  persistExportAsset,
  reduceTimeline,
  type TimelineSceneInput,
  type TimelineShotInput,
} from "./_freecut-timeline.js"
import { serializeFreecut } from "./freecut-serialize.js"

// The FreecutTimeline document types now live in the shared serialize core.
// Re-export them here so existing importers of `freecut-export.js` (tests,
// callers) keep their import paths unchanged.
export type {
  FreecutClipTransition,
  FreecutVideoClip,
  FreecutAudioClip,
  FreecutTimeline,
} from "./freecut-serialize.js"

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

export interface FreecutExportResult {
  exportAssetId: string | null
  /** R2 URL to the .json file. */
  exportAssetUrl: string
}

/**
 * Build the timeline + upload as JSON + persist asset row. Returns the new
 * asset id + R2 URL. Mirrors the per-scene + per-shot reduction in
 * `pipelineFinalMerge` so the resulting timeline lines up with what the
 * MP4 path would have produced.
 *
 * Thin wrapper (FreeCut-in-Studio F2): the FreecutTimeline construction now
 * lives in the shared pure core `serializeFreecut`; this function only reduces
 * the scenes, stamps a live `generatedAt`, serializes, and persists. Output is
 * byte-identical to before (the live `new Date()` stamp is unchanged).
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
    fadeOutDurationSec,
  } = args

  if (scenes.length === 0) {
    throw new Error("generateFreecutExport requires at least 1 scene")
  }

  const reduced = reduceTimeline(scenes)
  const { content, mimeType, fileExtension, formatTag } = serializeFreecut(
    reduced,
    "json",
    {
      musicAssetUrl,
      narrationAssetUrl,
      fadeOutDurationSec,
      generatedAt: new Date().toISOString(),
      pipelineId,
      source: "pipeline-freecut-export",
    },
  )

  const persisted = await persistExportAsset({
    supabase,
    pipelineId,
    userId,
    filenameStem: "freecut",
    fileExtension,
    mimeType,
    formatTag,
    source: "pipeline-freecut-export",
    content,
    logTag: "pipeline-freecut-export",
  })

  return {
    exportAssetId: persisted.assetId,
    exportAssetUrl: persisted.assetUrl,
  }
}
