/**
 * Shared handle metadata + accepts predicates for the 11 ffmpeg / pure-
 * processing nodes (trim-video, combine-videos, merge-video-audio,
 * extract-frame, loop-video, resize-video, add-captions, trim-audio,
 * adjust-volume, combine-audio, mix-audio).
 *
 * These nodes share the same handle taxonomy — every input accepts either
 * VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES, or both (the "media" predicate
 * for merge-video-audio + adjust-volume). Outputs are video / audio / image
 * depending on what the node produces.
 *
 * Colors derive from the canonical HANDLE_COLORS map (single source of truth)
 * so ffmpeg handles match the same-typed pips everywhere else:
 *   - video → HANDLE_COLORS.video (violet), Film icon
 *   - audio → HANDLE_COLORS.audio (amber), AudioLines icon
 *   - image → HANDLE_COLORS.image (cyan), ImageIcon (extract-frame only)
 *   - media → HANDLE_COLORS.control (slate), neutral fallback for handles that
 *             accept BOTH video AND audio (merge-video-audio / adjust-volume)
 */
import { VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared/nodes"
import { HANDLE_COLORS } from "./handle-colors"
import { ACCEPTS_JSON } from "./data-handles"
import { ugcMayFeedPlanInput } from "./ugc-plan-inputs"
import { UNIT_NODE_DEFINITIONS } from "./unit-definitions"
import { composeSet, unitsWith } from "./unit-compose"
import type { UnitHandleKind, UnitInputHandle } from "@/nodes/kit"
// @registry-enumerates FFMPEG_NODE_TYPES and isValidFfmpegConnection cover every node unit with the "ffmpeg-media" capability

/** Accepts any node whose output is a video stream (URL pointing at .mp4
 *  / .mov / etc.). Used by trim-video, combine-videos, extract-frame,
 *  loop-video, resize-video, add-captions, and merge-video-audio's video
 *  input. Also accepts dynamic-output types whose runtime output can be
 *  video (loop, list, sub-workflow, adjust-volume in video mode, etc.). */
export const ACCEPTS_VIDEO = (sourceType: string): boolean =>
  VIDEO_PRODUCER_TYPES.has(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)

/** Accepts any node whose output is an audio stream. Used by trim-audio,
 *  combine-audio, and merge-video-audio's audio input. Also
 *  accepts dynamic-output types (loop, list, sub-workflow, etc.). */
export const ACCEPTS_AUDIO = (sourceType: string): boolean =>
  AUDIO_PRODUCER_TYPES.has(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)

/** Accepts either video OR audio sources. Used by handles whose semantic
 *  is "any media stream" — adjust-volume (works on either), mix-audio (a
 *  video contributes its sound) and
 *  merge-video-audio's single combined input (kept single-handle to avoid
 *  migrating existing saved workflows; the backend already classifies
 *  edges by source-node type). Dynamic producers also pass through. */
export const ACCEPTS_MEDIA = (sourceType: string): boolean =>
  VIDEO_PRODUCER_TYPES.has(sourceType)
    || AUDIO_PRODUCER_TYPES.has(sourceType)
    || DYNAMIC_PRODUCER_TYPES.has(sourceType)

/** Add Captions' `captionPlan`: any JSON producer — of the UGC nodes, only
 *  UGC Cards, whose caption plan is made for it (ugc-plan-inputs.ts). One
 *  predicate for the node's pip, the drop validator and the popover registry. */
export const ACCEPTS_CAPTION_PLAN = (sourceType: string): boolean =>
  ACCEPTS_JSON(sourceType) && ugcMayFeedPlanInput("add-captions", "captionPlan", sourceType)

/** Brand colors for typed pips. Centralized so every ffmpeg node uses the
 *  exact same hex — diff'ing across the family is what makes the type
 *  system *visible* to the user. `image` is currently the same hex as
 *  `video` (extract-frame's output mirrors generate-image's `image` pip
 *  color), but kept as a distinct key so a future split doesn't silently
 *  re-color the image output. */
export const FFMPEG_COLORS = {
  video: HANDLE_COLORS.video,
  audio: HANDLE_COLORS.audio,
  media: HANDLE_COLORS.control,
  image: HANDLE_COLORS.image,
} as const

/**
 * The connection rule of a node-unit input, from the kinds it accepts
 * (unit.json handles.inputs[].accepts): video and audio together take any
 * media stream, as merge-video-audio's input does. The kinds a unit input may
 * accept are tools/units/vocabulary.mjs ACCEPTS_KINDS — the validator refuses
 * any other, so this never meets one it cannot answer.
 */
export function unitInputAccepts(kinds: ReadonlyArray<UnitHandleKind>): (sourceType: string) => boolean {
  const video = kinds.includes("video")
  const audio = kinds.includes("audio")
  if (video && audio) return ACCEPTS_MEDIA
  if (video) return ACCEPTS_VIDEO
  if (audio) return ACCEPTS_AUDIO
  throw new Error(`a node-unit input accepting ${kinds.join(", ")} has no connection rule — see tools/units/vocabulary.mjs ACCEPTS_KINDS`)
}

const unitInputs = (type: string): ReadonlyArray<UnitInputHandle> | undefined => UNIT_NODE_DEFINITIONS.find((u) => u.type === type)?.handles.inputs

/** Node types that this module covers — the canvas connection validator
 *  uses this Set to short-circuit the per-type switch into a single
 *  dispatch call. Order doesn't matter; presence is what's load-bearing.
 *  Legacy types ∪ every node unit with the "ffmpeg-media" capability. */
export const FFMPEG_NODE_TYPES: ReadonlySet<string> = composeSet("FFMPEG_NODE_TYPES", new Set([
  "trim-video",
  "combine-videos",
  "merge-video-audio",
  "extract-frame",
  "loop-video",
  "resize-video",
  "add-captions",
  "trim-audio",
  "adjust-volume",
  "pitch-tempo",
  "audio-fx",
  "combine-audio",
  "mix-audio",
  "extract-audio",
  "remove-audio",
  "silence-detect",
]), unitsWith(UNIT_NODE_DEFINITIONS, "ffmpeg-media"))

/**
 * Single-entry connection validator for every ffmpeg target handle. Mirrors
 * the per-node switch case in `connection-validation.ts` so the canvas
 * validator and the per-pip `accepts` predicate cannot disagree (they share
 * the same source of truth).
 *
 * Returns false for unknown (nodeType, handleId) pairs — safer than
 * defaulting to true, which would silently allow malformed connections to
 * pass through.
 */
export function isValidFfmpegConnection(
  targetNodeType: string,
  targetHandle: string,
  sourceType: string,
): boolean {
  switch (targetNodeType) {
    // Pure video-input nodes: trim-video / extract-frame / loop-video /
    // resize-video / combine-videos. All accept any video-producer source on
    // their single `in` handle.
    case "trim-video":
    case "extract-frame":
    case "loop-video":
    case "resize-video":
    case "combine-videos":
    // Extract Audio (video → audio) and Remove Audio (video → silent video)
    // both take a single video input on their `in` handle.
    case "extract-audio":
    case "remove-audio":
      return targetHandle === "in" && ACCEPTS_VIDEO(sourceType)

    // Add Captions: a video on `in`, plus an optional Transcript (json) on
    // `transcript` — the word-timed caption source (transcribe / apply-edl
    // json), burned in as timed captions; or a caption plan on `captionPlan`
    // (json) — the opening line in Hook Plate, the rest in this node's style.
    case "add-captions":
      if (targetHandle === "in") return ACCEPTS_VIDEO(sourceType)
      if (targetHandle === "transcript") return ACCEPTS_JSON(sourceType)
      if (targetHandle === "captionPlan") return ACCEPTS_CAPTION_PLAN(sourceType)
      return false

    // Pure audio-input nodes: trim-audio / combine-audio / audio-fx.
    case "trim-audio":
    case "combine-audio":
    case "audio-fx":
      return targetHandle === "in" && ACCEPTS_AUDIO(sourceType)

    // Mix Audio: a video wired in is a track too — its sound is mixed (a
    // silent video is silence), on both engines (decided 2026-10-13).
    case "mix-audio":
      return targetHandle === "in" && ACCEPTS_MEDIA(sourceType)

    // Mixed-media inputs: merge-video-audio + adjust-volume both take
    // EITHER a video OR an audio source on a single `in` handle. The
    // backend classifies incoming edges by source-node type at execution
    // time — see backend/src/routes/merge-video-audio.ts and the
    // adjust-volume route.
    case "merge-video-audio":
    case "adjust-volume":
    case "pitch-tempo":
    // Silence Detect takes EITHER an audio OR a video source on its single
    // `in` handle — the worker reads the shared audio proxy either way.
    case "silence-detect":
      return targetHandle === "in" && ACCEPTS_MEDIA(sourceType)

    default: {
      // A node unit: its declared inputs (unit.json handles.inputs[].accepts).
      const input = FFMPEG_NODE_TYPES.has(targetNodeType) ? unitInputs(targetNodeType)?.find((h) => h.id === targetHandle) : undefined
      return input ? unitInputAccepts(input.accepts)(sourceType) : false
    }
  }
}
