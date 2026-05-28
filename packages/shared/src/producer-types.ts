/**
 * Producer-type sets — single source of truth for the node types whose
 * primary output is a video URL, audio URL, etc.
 *
 * Consumed by:
 *   - backend/src/services/workflow-engine/execution-graph.ts (orchestrator
 *     dispatch + asset-type tagging in payload-builder, output-extractor,
 *     inline-executor — re-exported there as VIDEO_SOURCE_TYPES /
 *     AUDIO_SOURCE_TYPES for backwards compatibility).
 *   - frontend/src/lib/generate-video-handles.ts (handle connection
 *     validation on the Generate Video node).
 *
 * Lifting these here ensures the frontend handle validator can never reject
 * a connection from a node type that the backend would happily route at
 * execution time (the prior drift bug, see issue 1 of the Task 4.1 review).
 */

/**
 * Source node types whose primary output is a video URL.
 * Mirrors the backend execution-graph VIDEO_SOURCE_TYPES verbatim.
 */
export const VIDEO_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  // Unified video node — emits videoUrl identically to i2v/t2v (its payload-builder
  // case dispatches dynamically to "image-to-video" or "text-to-video" jobName based
  // on whether a start frame is wired). Without this, getPrimaryOutput would fall
  // through to the imageUrl/videoUrl/audioUrl/text default and downstream consumers
  // could silently misroute the output.
  "generate-video",
  "upload-video",
  "youtube-video",
  "combine-videos",
  "lip-sync",
  "speech-to-video",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  // face-swap output is video (writes generatedVideoUrl, per-result `url`).
  // Frontend execution-graph already includes it in VIDEO_SOURCE_TYPES; this
  // entry brings the shared set in line so canvas typed-handle validation
  // doesn't reject face-swap → video-consumer edges that the orchestrator
  // would happily route at runtime.
  "face-swap",
  "video-retake",
  "suno-music-video",
  "merge-video-audio",
  "add-captions",
  "resize-video",
  "social-media-format",
  "trim-video",
  "render-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "transcode-video",
  "manual-edit",
])

/**
 * Source node types whose output media-type cannot be classified
 * statically — iterators, dynamic dispatchers, sub-workflow wrappers.
 * The orchestrator decides their actual output type at execution time
 * based on what's wired upstream (loop iterates upstream column type;
 * sub-workflow emits its leaf node's type; adjust-volume passes through
 * video or audio based on its `lastInputType` runtime field).
 *
 * Typed-handle validators (frontend/src/lib/{generate-image,generate-
 * video,ffmpeg}-handles.ts) must include these as acceptors on EVERY
 * media-typed input handle — otherwise the canvas validator hard-
 * rejects edges that the orchestrator would happily route at runtime.
 *
 * Lifted here from `frontend/src/lib/ffmpeg-handles.ts` (where the
 * escape hatch was first added) so the same set drives ALL handle
 * validators uniformly. Adding a new dynamic-output node type means
 * one edit here instead of N across sibling validator files.
 *
 * Intentionally OMITTED:
 *  - `webhook-trigger` / `schedule-trigger` — their outputs are
 *    user-defined JSON shapes, not media URLs. Accepting them as
 *    media producers creates false-positive drops at the canvas
 *    that fail at execution. Users wanting trigger → media flows
 *    should wire through an upload node.
 */
export const DYNAMIC_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "loop",
  "list",
  "sub-workflow",
  "adjust-volume",
  "reduce",
])

/**
 * Source node types whose primary output is an audio URL.
 * Mirrors the backend execution-graph AUDIO_SOURCE_TYPES verbatim.
 */
export const AUDIO_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "text-to-speech",
  "text-to-audio",
  "generate-music",
  "upload-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-separate",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-convert-wav",
  "suno-upload-extend",
  "trim-audio",
  "mix-audio",
  "combine-audio",
  "adjust-volume",
  "reference-audio",
  "audio-isolation",
  "text-to-dialogue",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "voice-design",
])
