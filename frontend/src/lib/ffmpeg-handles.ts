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
 * Color + icon conventions (matched to Generate Image / Generate Video):
 *   - video     → cyan  (#22D3EE), Film icon
 *   - audio     → amber (#f59e0b), AudioLines icon
 *   - image-out → cyan  (#22D3EE), ImageIcon (extract-frame only)
 *   - media     → steel (#64748b), neutral fallback for handles that
 *                 accept BOTH video AND audio (merge-video-audio's input,
 *                 adjust-volume's input)
 */
import { VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES } from "@nodaro/shared"

/**
 * Source types whose output media type can't be classified statically —
 * iterators, dynamic dispatchers, sub-workflow wrappers. Pre-PR the
 * validator returned `return true` for these because the type rules
 * fell through; ACCEPTS_VIDEO / ACCEPTS_AUDIO / ACCEPTS_MEDIA include
 * them explicitly so the prior permissiveness survives the strict
 * dispatch.
 *
 * Includes:
 *  - `loop` / `list` — per-row iteration; column type is dynamic at runtime.
 *  - `sub-workflow` — wrapped workflow's output type is its leaf type.
 *  - `adjust-volume` — emits video OR audio based on its `lastInputType`.
 *    Sits in AUDIO_PRODUCER_TYPES only (its default output is audio), but
 *    when wired downstream of a video source it legitimately produces
 *    video. Without this, the strict validator would reject every
 *    adjust-volume → video-ffmpeg edge after the user runs it on video.
 *  - `reduce` — reduces a list to a single value; type-dynamic.
 *
 * Intentionally OMITTED:
 *  - `webhook-trigger` / `schedule-trigger` — their outputs are user-
 *    defined JSON shapes, not media URLs. Allowing them as media
 *    producers at the canvas surfaces false-positive drops (the edge
 *    creates, but the orchestrator's resolver finds no videoUrl/audioUrl
 *    field and the worker fails with a cryptic shape mismatch). Users
 *    who want trigger → media flows should wire through an upload node
 *    that re-emits typed media output.
 */
const DYNAMIC_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "loop",
  "list",
  "sub-workflow",
  "adjust-volume",
  "reduce",
])

/** Accepts any node whose output is a video stream (URL pointing at .mp4
 *  / .mov / etc.). Used by trim-video, combine-videos, extract-frame,
 *  loop-video, resize-video, add-captions, and merge-video-audio's video
 *  input. Also accepts dynamic-output types whose runtime output can be
 *  video (loop, list, sub-workflow, adjust-volume in video mode, etc.). */
export const ACCEPTS_VIDEO = (sourceType: string): boolean =>
  VIDEO_PRODUCER_TYPES.has(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)

/** Accepts any node whose output is an audio stream. Used by trim-audio,
 *  combine-audio, mix-audio, and merge-video-audio's audio input. Also
 *  accepts dynamic-output types (loop, list, sub-workflow, etc.). */
export const ACCEPTS_AUDIO = (sourceType: string): boolean =>
  AUDIO_PRODUCER_TYPES.has(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)

/** Accepts either video OR audio sources. Used by handles whose semantic
 *  is "any media stream" — adjust-volume (works on either) and
 *  merge-video-audio's single combined input (kept single-handle to avoid
 *  migrating existing saved workflows; the backend already classifies
 *  edges by source-node type). Dynamic producers also pass through. */
export const ACCEPTS_MEDIA = (sourceType: string): boolean =>
  VIDEO_PRODUCER_TYPES.has(sourceType)
    || AUDIO_PRODUCER_TYPES.has(sourceType)
    || DYNAMIC_PRODUCER_TYPES.has(sourceType)

/** Brand colors for typed pips. Centralized so every ffmpeg node uses the
 *  exact same hex — diff'ing across the family is what makes the type
 *  system *visible* to the user. `image` is currently the same hex as
 *  `video` (extract-frame's output mirrors generate-image's `image` pip
 *  color), but kept as a distinct key so a future split doesn't silently
 *  re-color the image output. */
export const FFMPEG_COLORS = {
  video: "#22D3EE",
  audio: "#f59e0b",
  media: "#64748b",
  image: "#22D3EE",
} as const

/** Node types that this module covers — the canvas connection validator
 *  uses this Set to short-circuit the per-type switch into a single
 *  dispatch call. Order doesn't matter; presence is what's load-bearing. */
export const FFMPEG_NODE_TYPES: ReadonlySet<string> = new Set([
  "trim-video",
  "combine-videos",
  "merge-video-audio",
  "extract-frame",
  "loop-video",
  "resize-video",
  "add-captions",
  "trim-audio",
  "adjust-volume",
  "combine-audio",
  "mix-audio",
])

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
    // resize-video / add-captions / combine-videos. All accept any
    // video-producer source on their single `in` handle.
    case "trim-video":
    case "extract-frame":
    case "loop-video":
    case "resize-video":
    case "add-captions":
    case "combine-videos":
      return targetHandle === "in" && ACCEPTS_VIDEO(sourceType)

    // Pure audio-input nodes: trim-audio / combine-audio / mix-audio.
    case "trim-audio":
    case "combine-audio":
    case "mix-audio":
      return targetHandle === "in" && ACCEPTS_AUDIO(sourceType)

    // Mixed-media inputs: merge-video-audio + adjust-volume both take
    // EITHER a video OR an audio source on a single `in` handle. The
    // backend classifies incoming edges by source-node type at execution
    // time — see backend/src/routes/merge-video-audio.ts and the
    // adjust-volume route.
    case "merge-video-audio":
    case "adjust-volume":
      return targetHandle === "in" && ACCEPTS_MEDIA(sourceType)

    default:
      return false
  }
}
