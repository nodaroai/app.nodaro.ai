import type { TransitionType } from "@nodaro/shared"
import {
  DEFAULT_FADE_OUT_SEC,
  round3,
  type ReducedClip,
  type TimelineState,
} from "./_freecut-timeline.js"

/**
 * Phase 1C.3 §J1c (FreeCut-in-Studio F2) — the PURE serialize core shared by
 * both pipeline exporters AND the Studio `POST /v1/freecut-export` route.
 *
 * Extracted verbatim from the two former in-line renderers:
 *   - `buildFreecutTimelineJson` was the FreecutTimeline-object construction
 *     inside `freecut-export.ts::generateFreecutExport`.
 *   - `buildFcpxml` was the XML-rendering body inside
 *     `freecut-fcpxml.ts::generateFcpxmlExport`.
 *
 * The ONLY behavioral change vs. the originals is that `generatedAt` is now an
 * INJECTED param (was `new Date().toISOString()` inline). The two pipeline
 * wrappers still stamp a live `new Date()` at call time, so live pipeline
 * output is byte-identical to before; the route injects its own timestamp.
 *
 * Everything here is pure — same input always yields the same output — so it
 * can be unit-tested deterministically and reused from any call site (pipeline
 * worker or HTTP route) without touching R2 / Supabase / the clock.
 */

/* ───────────────────────────── shared opts ────────────────────────────── */

export interface SerializeOpts {
  /** R2 URL of the merged music track. Empty string skips the music track/lane. */
  musicAssetUrl: string
  /**
   * R2 URL of the narration audio track. When present, emits a SECOND audio
   * track (JSON) / lane (FCPXML) so downstream NLEs render music + narration as
   * separate layers. Empty/undefined skips it.
   */
  narrationAssetUrl?: string
  /** Tail fade-out applied to the music clip in seconds. Default 0.8. */
  fadeOutDurationSec?: number
  /** Injected wall-clock stamp — written into the JSON `metadata.generated_at`. */
  generatedAt: string
  /**
   * Pipeline id — pipeline exports set it (→ `metadata.pipeline_id`); Studio
   * exports omit it (renders `null`).
   */
  pipelineId?: string
  /**
   * `assets.metadata.source` ("pipeline-freecut-export" | "studio-freecut-export").
   * Carried for the persistence layer; NOT written into the file content.
   */
  source: string
}

/* ─────────────────────── FreeCut JSON timeline types ──────────────────── */

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
    pipeline_id: string | null
    generated_at: string
    note: string
  }
}

const FORMAT_NOTE =
  "Format is Nodaro-flat-timeline-v1; FreeCut compatibility is a follow-up — most NLE software can ingest via XML/EDL converters."

/* ─────────────────────────── JSON serializer ──────────────────────────── */

/**
 * Pure FreecutTimeline builder — moved verbatim from `generateFreecutExport`.
 * Walks the shared reduction once and emits the flat timeline object. Each
 * scene → one video clip; the cut_decision-derived head/tail trim + adjacent
 * transitions are already baked into `reduced.clips`.
 */
export function buildFreecutTimelineJson(
  reduced: TimelineState,
  opts: SerializeOpts,
): FreecutTimeline {
  const {
    musicAssetUrl,
    narrationAssetUrl,
    fadeOutDurationSec = DEFAULT_FADE_OUT_SEC,
    generatedAt,
    pipelineId,
  } = opts

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

  // Build the audio track (single music clip across the whole timeline).
  // `reduced.timelineDurationSec` already accounts for transition overlaps.
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

  // Narration is a SEPARATE audio track (not pre-mixed with music here; the
  // MP4 path's amix filter handles ducking, but FreeCut exports keep tracks
  // separate so the NLE can re-mix).
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

  return {
    version: "1.0",
    format: "freecut-v1",
    duration_seconds: timelineDuration,
    tracks,
    metadata: {
      pipeline_id: pipelineId ?? null,
      generated_at: generatedAt,
      note: FORMAT_NOTE,
    },
  }
}

/* ─────────────────────────── FCPXML serializer ─────────────────────────── */

/**
 * Pure FCPXML 1.10 builder — moved verbatim from `generateFcpxmlExport`.
 * Walks the shared timeline reduction once and emits the document as a string.
 *
 * `fadeOutDurationSec` is accepted for parity with the JSON path but, as in the
 * original, has no effect on the FCPXML output (fade is a downstream-NLE
 * concern; FCPXML at this level has no fade primitive). `generatedAt` /
 * `pipelineId` / `source` are likewise unused by the XML body — the document
 * carries no timestamp and the project name uses `pipelineId` only when set.
 */
export function buildFcpxml(reduced: TimelineState, opts: SerializeOpts): string {
  const { musicAssetUrl, fadeOutDurationSec } = opts
  const narrationAssetUrl = opts.narrationAssetUrl ?? ""
  const pipelineId = opts.pipelineId ?? ""

  // Reuse the same fadeOutDurationSec parameter as JSON FreeCut so toggling the
  // export format is a no-op on every other knob. The actual fade-out behavior
  // on import is up to the consuming NLE. Tracked here for parity / future use.
  void fadeOutDurationSec

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

  // Audio overlays: music on lane -1, narration on lane -2. Both span the full
  // timeline. The fade-out behavior is a downstream-NLE concern.
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

/* ──────────────────────────────── dispatch ────────────────────────────── */

export interface SerializedFreecut {
  content: string
  mimeType: "application/json" | "application/xml"
  fileExtension: "json" | "fcpxml"
  formatTag: string
}

/**
 * Dispatcher: render the reduced timeline into the requested format.
 *
 *   - `json`   → `JSON.stringify(buildFreecutTimelineJson(...), null, 2)`,
 *                `application/json`, `.json`, formatTag `freecut-v1`.
 *   - `fcpxml` → `buildFcpxml(...)`, `application/xml`, `.fcpxml`,
 *                formatTag `fcpxml`.
 *
 * NOTE on `formatTag` for fcpxml: this returns the generic `"fcpxml"` tag (used
 * by the Studio route's `assets.metadata.format`). The PIPELINE wrappers do NOT
 * consume this value — they keep persisting their historical `"fcpxml-v1.10"`
 * tag so the pipeline's `assets.metadata.format` + `generateFcpxmlExport`'s
 * typed return stay byte-identical to before. (JSON's `freecut-v1` already
 * matches the historical pipeline tag, so the JSON wrapper can use either.)
 */
export function serializeFreecut(
  reduced: TimelineState,
  format: "json" | "fcpxml",
  opts: SerializeOpts,
): SerializedFreecut {
  if (format === "fcpxml") {
    return {
      content: buildFcpxml(reduced, opts),
      mimeType: "application/xml",
      fileExtension: "fcpxml",
      formatTag: "fcpxml",
    }
  }
  return {
    content: JSON.stringify(buildFreecutTimelineJson(reduced, opts), null, 2),
    mimeType: "application/json",
    fileExtension: "json",
    formatTag: "freecut-v1",
  }
}
