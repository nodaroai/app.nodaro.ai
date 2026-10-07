/**
 * Which node types get the config panel's Generate button, its Run button, and
 * its results gallery. Dependency-light (no React, no store) so tests import the
 * real sets instead of copies — the results-gallery census
 * (config-panels/__tests__/results-gallery-medium-census.test.ts) walks
 * RESULT_PRODUCING_TYPES and fails for a type the gallery cannot type.
 */

export const GENERATE_BUTTON_TYPES = new Set([
  "generate-script", "generate-image", "modify-image", "upscale-image", "remove-background", "generate-mask", "reference-sheet", "reference-board",
  "image-to-video", "video-to-video", "switchx", "text-to-video", "generate-video", "text-to-speech",
  "text-to-audio", "audio-isolation", "audio-separation", "text-to-dialogue", "voice-changer", "dubbing", "voice-remix", "voice-design", "forced-alignment", "generate-music", "motion-transfer", "lip-sync", "speech-to-video",
  "video-upscale", "extend-video", "video-retake", "face-swap", "video-sfx", "ai-avatar", "cinematic-avatar", "suno-generate", "suno-cover", "suno-extend",
  "suno-lyrics", "suno-separate", "suno-music-video",
  "suno-mashup", "suno-replace-section", "suno-style-boost", "suno-add-instrumental", "suno-add-vocals", "suno-convert-wav", "suno-upload-extend",
  "llm-chat", "web-scrape", "meta-ads-scrape", "instagram-scrape", "social-search", "video-analysis", "video-audit",
  "content-recipe", "content-ideas",
  "video-composer", "after-effects", "lottie-overlay", "3d-title", "motion-graphics",
  "generate-3d-scene", "edit-3d-scene", "pro-3d-render",
  "image-to-text", "qa-check", "transcribe", "describe-to-picker",
  "render-video",
  "instagram-post", "tiktok-post", "youtube-upload", "linkedin-post", "x-post", "facebook-post", "telegram-post", "publish-social",
  "component",
  // FFmpeg processing (tiered credits)
  "merge-video-audio", "still-to-video", "slideshow", "combine-videos", "apply-edl", "edit-plan", "camera-switch", "speaker-view", "assemble-narrated-video", "image-collage", "image-overlay", "video-overlay", "trim-audio", "split-media", "extract-audio", "silence-detect", "audio-sync", "remove-audio", "trim-video", "extract-frame",
  "speed-ramp", "loop-video", "gif-to-video", "fade-video", "transcode-video", "resize-video", "social-media-format", "adjust-volume", "audio-fx",
  "add-captions", "mix-audio", "combine-audio",
])

export const RUN_BUTTON_TYPES = new Set([
  "manual-edit", "composite",
  "sub-workflow", "router", "reduce",
  // The handoff's "Test node": a Webhook Output is the one node you most want
  // to fire once on its own before trusting a whole run to it. It costs no
  // credits, so it belongs on this list rather than with the generate buttons.
  "webhook-output",
  // Same reasoning for the two collection nodes: free, and worth one try on
  // their own before a schedule relies on them.
  "collection-write", "collection-read",
  // And for the two post readers: free reads of what the account holds.
  "inspiration-read", "competitor-read",
])

// Node types that produce media results (excludes text-only nodes like combine-text, split-text, extract-field, sub-workflow, social posts)
export const RESULT_PRODUCING_TYPES: ReadonlySet<string> = new Set([
  ...GENERATE_BUTTON_TYPES,
  ...RUN_BUTTON_TYPES,
].filter(t =>
  t !== "combine-text" && t !== "split-text" && t !== "extract-field" && t !== "json-process" &&
  t !== "filter-list" && t !== "deduplicate" && t !== "merge-lists" && t !== "sort-list" &&
  t !== "preview" && t !== "sub-workflow" &&
  t !== "instagram-post" && t !== "tiktok-post" && t !== "youtube-upload" &&
  t !== "linkedin-post" && t !== "x-post" && t !== "facebook-post" && t !== "telegram-post" && t !== "publish-social" &&
  t !== "image-to-text" && t !== "qa-check" && t !== "transcribe" && t !== "llm-chat" &&
  t !== "describe-to-picker" &&
  // A webhook delivery produces a status code, not media — it has a Run
  // button but nothing for a results gallery to show.
  t !== "webhook-output" &&
  // A collection write/read produces records (json + text), not media.
  t !== "collection-write" && t !== "collection-read" &&
  // A post reader produces posts (json + text), not media.
  t !== "inspiration-read" && t !== "competitor-read"
))
