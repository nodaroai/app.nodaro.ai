import type { SupabaseClient } from "@supabase/supabase-js"
import {
  persistExportAsset,
  reduceTimeline,
  type TimelineSceneInput,
  type TimelineShotInput,
} from "./_freecut-timeline.js"
import { serializeFreecut } from "./freecut-serialize.js"

// The pure XML builder now lives in the shared serialize core; re-export it so
// existing importers of `freecut-fcpxml.js` keep their import path unchanged.
export { buildFcpxml } from "./freecut-serialize.js"

/**
 * Phase 1C.2.1 §H — FCPXML export format.
 *
 * Alternative serialization of the same FreeCut in-memory timeline as
 * `generateFreecutExport`. When the user sets
 * `pipelines.config.freecut_export_format = "fcpxml"` (default `"json"`),
 * Stage 7's sub-step 7j alternative path calls this module instead of the
 * JSON serializer. The reduction logic (per-scene + per-shot cut decisions
 * → adjacent-scene transitions + head/tail trim) is now shared via
 * `_freecut-timeline.ts::reduceTimeline` (Phase 1C.3 §J1b) — we only swap
 * the output shape.
 *
 * **Why hand-rolled XML (no xmlbuilder2 dep):** FCPXML 1.10's surface here
 * is small (~60 lines of structured output). A string template is clearer
 * than wiring up xmlbuilder2 for one call site, and avoids adding a new
 * dep. Special-char escaping is handled by `escXml`.
 *
 * **FCPXML conventions:**
 *  - Durations are written as decimal seconds with an `s` suffix (FCP
 *    accepts both rational fractions like `100100/10000s` and decimal
 *    seconds like `4.7s`; decimal is simpler and round-trips).
 *  - Adjacent scenes with a dissolve/overlap transition emit a
 *    `<transition name="Cross Dissolve">` element between the two
 *    `<asset-clip>` elements in the spine.
 *  - Audio overlays (music + narration) become asset-clip elements with
 *    negative `lane` attributes — `lane="-1"` for music, `lane="-2"` for
 *    narration. Negative lanes render below the video lane in FCP.
 *  - The `start` attribute on `<asset-clip>` is the in-point inside the
 *    source asset (i.e., head trim); `duration` is the on-timeline length.
 *  - `hard_cut` and `match_cut` emit no transition element (the spine just
 *    butt-joins). FCP has no "match cut" primitive — Editor LLM uses the
 *    match_cut name to signal intent to the user.
 *
 * Credits: 0 (`pipeline-freecut-export` — same 0-cost slot as JSON
 * FreeCut). FCPXML doesn't get a separate identifier because the work is
 * identical from the credit system's perspective: emit a flat document, no
 * GPU/API work.
 *
 * Asset persistence: the .fcpxml file is uploaded to R2 with
 * `mime_type='application/xml'`, the assets row has `type='document'`.
 */

export type FcpxmlShotInput = TimelineShotInput
export type FcpxmlSceneInput = TimelineSceneInput

export interface FcpxmlExportArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  scenes: ReadonlyArray<FcpxmlSceneInput>
  /** R2 URL of the merged music track. Empty string skips the music lane. */
  musicAssetUrl: string
  /** R2 URL of the narration audio track. Empty/undefined skips the lane. */
  narrationAssetUrl?: string
  /** Tail fade-out applied to the music clip; mirrors the JSON FreeCut path. */
  fadeOutDurationSec?: number
}

export interface FcpxmlExportResult {
  exportAssetId: string | null
  exportAssetUrl: string
  format: "fcpxml-v1.10"
}

/**
 * Build the FCPXML document + upload as XML + persist asset row.
 *
 * The scene reduction here is byte-equivalent to `generateFreecutExport`:
 *   - head/tail trim = first/last shot's `in_offset_sec` / `out_offset_sec`
 *   - between-scene transition = previous scene's last shot's
 *     `transition_to_next` (`dissolve` / `overlap` emit a `<transition>`;
 *     `hard_cut` / `match_cut` butt-join with no element)
 *   - per-shot trims WITHIN a scene are NOT honored (scene composite is
 *     already pre-merged from Stage 7's per-scene combine — same caveat
 *     pipelineFinalMerge documents)
 */
export async function generateFcpxmlExport(
  args: FcpxmlExportArgs,
): Promise<FcpxmlExportResult> {
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
    throw new Error("generateFcpxmlExport requires at least 1 scene")
  }

  // Thin wrapper (FreeCut-in-Studio F2): the XML rendering now lives in the
  // shared pure core `serializeFreecut`. We pass `fadeOutDurationSec` through
  // for parity (the FCPXML body ignores it, as before). The reduction is the
  // same shared `reduceTimeline`, so the output is byte-identical to before.
  const reduced = reduceTimeline(scenes)
  const { content, mimeType, fileExtension } = serializeFreecut(
    reduced,
    "fcpxml",
    {
      musicAssetUrl,
      narrationAssetUrl: narrationAssetUrl ?? "",
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
    // Pipeline path keeps its historical, more-specific format tag (NOT the
    // dispatcher's generic "fcpxml") so `assets.metadata.format` + the typed
    // return below stay byte-identical to pre-F2.
    formatTag: "fcpxml-v1.10",
    source: "pipeline-freecut-export",
    content,
    logTag: "pipeline-freecut-fcpxml",
  })

  return {
    exportAssetId: persisted.assetId,
    exportAssetUrl: persisted.assetUrl,
    format: "fcpxml-v1.10",
  }
}
