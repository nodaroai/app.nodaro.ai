// frontend/src/lib/preview-node-types.ts — what a node TYPE alone says its
// output is: the image / video / audio source sets and the data emitters.
// Both preview classifiers decide by it — detectPreviewItemType
// (workflow-editor/execution-graph.ts) and the store's classifyPreviewValue
// (hooks/use-workflow-store.ts), which fills a Preview wired to a source that
// already has results — so the two cannot drift (decided 2026-10-19). It is a
// leaf the store can import: execution-graph imports the store, so the store
// cannot import execution-graph back.
import { UNIT_NODE_DEFINITIONS } from "@/lib/unit-definitions";
import { composeSet, unitProducers } from "@/lib/unit-compose";
// @registry-enumerates VIDEO_SOURCE_TYPES_FOR_RENDER carries every node unit whose contract.producer is "video"

export const IMAGE_SOURCE_TYPES = new Set([
  "generate-image",
  "reference-board",
  "upload-image",
  "edit-image",
  "image-to-image",
  "modify-image",
  "upscale-image",
  "remove-background",
  "extract-frame",
  "image-collage",
  "image-overlay",
  "character",
  "face",
  "object",
  "creature",
  "location",
  "scene",
]);
/** The node types whose output a render / composition node collects as a
 *  video (collectMediaAssets) and the preview types as one
 *  (detectPreviewItemType). Legacy rows ∪ every node unit whose
 *  `contract.producer` is "video" (unit-definitions.ts), so a migrated node is
 *  never named here; a "dynamic" unit is not a member. */
export const VIDEO_SOURCE_TYPES_FOR_RENDER: ReadonlySet<string> = composeSet("VIDEO_SOURCE_TYPES_FOR_RENDER", new Set<string>([
  "image-to-video",
  "video-to-video",
  "switchx",
  "text-to-video",
  // Generate Video — unified video node (Task 6.1). Mirrors backend
  // execution-graph's VIDEO_SOURCE_TYPES so detectPreviewItemType /
  // collectMediaAssets treat its output as video.
  "generate-video",
  // Generate Video Pro — Seedance-2-family multi-segment stitch (Task 13).
  // Mirrors the "generate-video" entry above (same output field shape).
  "generate-video-pro",
  // Edit Video Pro — span-replace sibling of generate-video-pro (Task 14).
  "edit-video-pro",
  "upload-video",
  "youtube-video",
  "combine-videos",
  "assemble-narrated-video",
  "lip-sync",
  "speech-to-video",
  "ai-avatar",
  "cinematic-avatar",
  "motion-transfer",
  "video-upscale",
  "video-depth",
  "extend-video",
  "video-retake",
  "face-swap",
  "suno-music-video",
  "merge-video-audio",
  "still-to-video",
  "slideshow",
  "add-captions",
  "resize-video",
  "social-media-format",
  "trim-video",
  "render-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "video-overlay",
  "transcode-video",
  "manual-edit",
  "video-sfx",
  // UGC Clip: one rendered clip — a video wherever the server sorts media too
  // (its preview typing reads the shared video producers).
  "ugc-clip",
  "video-mask",
  "mask-composite",
]), unitProducers(UNIT_NODE_DEFINITIONS, "video"));
export const AUDIO_SOURCE_TYPES = new Set([
  "text-to-speech",
  "text-to-audio",
  "generate-music",
  "upload-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-separate",
  "audio-separation",
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
  "audio-fx",
  "pitch-tempo",
  "reference-audio",
  "voice-changer",
  "voice-changer-pro",
  "dubbing",
  "voice-remix",
  "voice-design",
  "audio-isolation",
  // In the shared AUDIO_PRODUCER_TYPES already (the server's AUDIO_SOURCE_TYPES);
  // this hand list was missing it (decided 2026-10-19).
  "extract-audio",
]);

/**
 * The preview type a node's TYPE decides, or undefined when the type does not
 * decide it (the caller then reads the value). Image, video and audio sources
 * first, in that order, then the nodes that emit JSON, never a media URL.
 * Handle-specific rules (a node whose pips differ) stay with each caller.
 */
export function previewTypeOfNodeType(nodeType: string): "image" | "video" | "audio" | "data" | undefined {
  if (IMAGE_SOURCE_TYPES.has(nodeType)) return "image"
  if (VIDEO_SOURCE_TYPES_FOR_RENDER.has(nodeType)) return "video"
  if (AUDIO_SOURCE_TYPES.has(nodeType)) return "audio"
  if (nodeType === "forced-alignment") return "data"
  // Both analysis emitters: a JSON scene breakdown, never a media URL. Must
  // stay paired — video-audit's type string contains "video", so a name-based
  // guess would classify an audited analysis as a video.
  if (nodeType === "video-analysis" || nodeType === "video-audit") return "data"
  // Silence-detect emits a { version, ranges, durationMs } JSON object.
  if (nodeType === "silence-detect") return "data"
  // audio-sync emits its offsets as JSON.
  if (nodeType === "audio-sync") return "data"
  // edit-plan emits an EDL plan (json).
  if (nodeType === "edit-plan") return "data"
  // camera-switch emits the switched edit + the renamed transcript, both json.
  if (nodeType === "camera-switch") return "data"
  // speaker-frames emits the stored face-track file's descriptor (json).
  if (nodeType === "speaker-frames") return "data"
  return undefined
}
