/**
 * `@nodaro/shared/video` — Video node contracts: overlays, durations, links, analysis, output canvases and frame fit, UI defaults, character refs.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export {
  VIDEO_CHARACTER_REFS_WIRE_MAX,
  VIDEO_CHARACTER_DESCRIPTION_MAX,
  VIDEO_CHARACTER_NAME_MAX,
  videoCharacterRefCap,
  videoCharacterRefProviders,
  videoCharacterRefUnits,
  videoCharacterRefProblem,
  videoCharacterVoiceCap,
  videoCharacterVoiceKey,
  videoCharacterDistinctVoices,
  videoCharacterVoiceProblem,
  VIDEO_CHARACTER_VOICE_DESCRIPTION_MAX,
  VIDEO_CHARACTER_VOICE_EXAMPLE_MAX,
} from "../video-character-refs.js"
export type { VideoCharacterReference, VideoCharacterVoice, VideoCharacterRefProblem } from "../video-character-refs.js"
export { extractVideoDurationFromNode, editPlanSourceDurationSec } from "../video-duration.js"
// --- Video URL node + social-video import (host allowlist, node output rule) ---
export {
  SOCIAL_VIDEO_HOSTS,
  YOUTUBE_HOSTS,
  INSTAGRAM_HOSTS,
  VIDEO_LINK_TOLERANT_CONSUMER_TYPES,
  VIDEO_LINK_AUDIO_CONSUMER_TYPES,
  videoLinkNeedOf,
  videoLinkRunNeeds,
  AUTO_DOWNLOAD_MAX_SEC,
  YOUTUBE_MAX_HEIGHT,
  hostnameMatchesAllowlist,
  hasUrlParserHazard,
  isSocialVideoUrl,
  detectVideoLinkPlatform,
  videoLinkDownloadedFile,
  resolveVideoLinkOutput,
  videoLinkPageUrl,
  videoLinkNeedsDownload,
  DIRECT_VIDEO_EXTENSIONS,
  MAX_VIDEO_LINK_INPUT_CHARS,
  VIDEO_LINK_DERIVED_FIELDS,
  isDirectVideoFileUrl,
  videoLinkInputProblem,
  dropStaleVideoLinkFields,
} from "../video-link.js"
export type { VideoLinkPlatform, VideoLinkNodeFields, VideoLinkInputProblem, VideoLinkNeed, VideoLinkGraphNode, VideoLinkGraphEdge } from "../video-link.js"
export * from "../video-overlay.js"
// --- Video-analysis node (window/result schemas + slot-token + aspect helpers) ---
export * from "../video-analysis.js"
// --- Unified video node UI-default fills (panel snap == strip == DAG payload) ---
export * from "../video-ui-defaults.js"
// --- Start/end frame fit: measured output canvases + the pure fit math ---
export * from "../video-output-canvas.js"
export * from "../video-frame-fit.js"
