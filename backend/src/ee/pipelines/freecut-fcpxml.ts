import type { SupabaseClient } from "@supabase/supabase-js"
import {
  DEFAULT_FADE_OUT_SEC,
  persistExportAsset,
  reduceTimeline,
  round3,
  type ReducedClip,
  type TimelineSceneInput,
  type TimelineShotInput,
} from "./_freecut-timeline.js"

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
    fadeOutDurationSec = DEFAULT_FADE_OUT_SEC,
  } = args

  if (scenes.length === 0) {
    throw new Error("generateFcpxmlExport requires at least 1 scene")
  }

  // Reuse the same fadeOutDurationSec parameter as JSON FreeCut so toggling
  // the export format is a no-op on every other knob. The actual fade-out
  // behavior on import is up to the consuming NLE (FCP renders the music
  // track as-is — fade information isn't part of the FCPXML spec at this
  // level). Tracked here for parity / future use.
  void fadeOutDurationSec

  const xml = buildFcpxml({
    pipelineId,
    scenes,
    musicAssetUrl,
    narrationAssetUrl: narrationAssetUrl ?? "",
  })

  const persisted = await persistExportAsset({
    supabase,
    pipelineId,
    userId,
    filenameStem: "freecut",
    fileExtension: "fcpxml",
    mimeType: "application/xml",
    formatTag: "fcpxml-v1.10",
    content: xml,
    logTag: "pipeline-freecut-fcpxml",
  })

  return {
    exportAssetId: persisted.assetId,
    exportAssetUrl: persisted.assetUrl,
    format: "fcpxml-v1.10",
  }
}

interface BuildFcpxmlArgs {
  pipelineId: string
  scenes: ReadonlyArray<FcpxmlSceneInput>
  musicAssetUrl: string
  narrationAssetUrl: string
}

/**
 * Pure XML builder — exported for snapshot tests. Walks the shared timeline
 * reduction once and emits the document as a string.
 */
export function buildFcpxml(args: BuildFcpxmlArgs): string {
  const { pipelineId, scenes, musicAssetUrl, narrationAssetUrl } = args

  // ─── Reduction (shared) ──────────────────────────────────────────────
  const reduced = reduceTimeline(scenes)

  // Allocate one FCPXML resource id per scene + (optionally) per audio lane.
  // r1 is reserved for the video format element.
  let nextResourceIndex = 2
  type Plan = ReducedClip & { assetId: string; sceneName: string }
  const plans: Plan[] = reduced.clips.map((clip, i) => ({
    ...clip,
    assetId: `r${nextResourceIndex++}`,
    sceneName: `scene-${i + 1}`,
  }))
  const musicResourceId = musicAssetUrl ? `r${nextResourceIndex++}` : null
  const narrationResourceId = narrationAssetUrl
    ? `r${nextResourceIndex++}`
    : null

  const timelineDuration = reduced.timelineDurationSec

  // ─── Resources block ─────────────────────────────────────────────────
  const resources: string[] = []
  resources.push(
    `    <format id="r1" name="FFVideoFormat1080p30" frameDuration="1001/30000s" width="1920" height="1080"/>`,
  )
  for (const plan of plans) {
    resources.push(
      `    <asset id="${plan.assetId}" name="${escXml(plan.sceneName)}" src="${escXml(plan.compositeUrl)}" duration="${formatDuration(plan.fullDurationSec)}" hasVideo="1" hasAudio="1" format="r1"/>`,
    )
  }
  if (musicResourceId) {
    resources.push(
      `    <asset id="${musicResourceId}" name="music" src="${escXml(musicAssetUrl)}" duration="${formatDuration(timelineDuration)}" hasAudio="1"/>`,
    )
  }
  if (narrationResourceId) {
    resources.push(
      `    <asset id="${narrationResourceId}" name="narration" src="${escXml(narrationAssetUrl)}" duration="${formatDuration(timelineDuration)}" hasAudio="1"/>`,
    )
  }

  // ─── Spine ───────────────────────────────────────────────────────────
  const spine: string[] = []
  let runningOffset = 0
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]!
    spine.push(
      `          <asset-clip ref="${plan.assetId}" offset="${formatDuration(runningOffset)}" duration="${formatDuration(plan.clipDurationSec)}" start="${formatDuration(plan.startInClipSec)}" name="${escXml(plan.sceneName)}"/>`,
    )
    const next = plan.transitionOut
    if (i < plans.length - 1 && next && next.type !== "hard_cut" && next.type !== "match_cut") {
      const transitionName = "Cross Dissolve"
      const transitionOffset = runningOffset + plan.clipDurationSec - next.durationSec
      spine.push(
        `          <transition name="${escXml(transitionName)}" offset="${formatDuration(Math.max(0, transitionOffset))}" duration="${formatDuration(next.durationSec)}"/>`,
      )
      runningOffset += plan.clipDurationSec - next.durationSec
    } else {
      runningOffset += plan.clipDurationSec
    }
  }

  // Audio overlays: music on lane -1, narration on lane -2. Both span the
  // full timeline. The fade-out behavior is a downstream-NLE concern.
  if (musicResourceId) {
    spine.push(
      `          <asset-clip ref="${musicResourceId}" lane="-1" offset="0s" duration="${formatDuration(timelineDuration)}" name="music"/>`,
    )
  }
  if (narrationResourceId) {
    spine.push(
      `          <asset-clip ref="${narrationResourceId}" lane="-2" offset="0s" duration="${formatDuration(timelineDuration)}" name="narration"/>`,
    )
  }

  // ─── Assemble document ───────────────────────────────────────────────
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<fcpxml version="1.10">`,
    `  <resources>`,
    ...resources,
    `  </resources>`,
    `  <library>`,
    `    <event name="Nodaro Pipeline Export">`,
    `      <project name="${escXml(`Nodaro ${pipelineId}`)}">`,
    `        <sequence format="r1" duration="${formatDuration(timelineDuration)}">`,
    `          <spine>`,
    ...spine.map((line) => `  ${line}`),
    `          </spine>`,
    `        </sequence>`,
    `      </project>`,
    `    </event>`,
    `  </library>`,
    `</fcpxml>`,
    ``,
  ].join("\n")
}

/** XML special-character escape — handles &, <, >, ", and ' for attributes. */
function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function formatDuration(sec: number): string {
  return `${round3(sec).toFixed(3)}s`
}
