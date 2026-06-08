import type { OutputType } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../ee/billing/credits.js"
import {
  IMAGE_GEN_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_GEN_PROVIDERS,
} from "@nodaro/shared"

export type NodeCategory =
  | "input"
  | "parameter"
  | "ai-image"
  | "ai-video"
  | "ai-audio"
  | "ai-text"
  | "processing"
  | "composition"
  | "trigger"
  | "output"
  | "control"
  | "entity"
  | "utility"

export interface NodeDescriptor {
  type: string
  label: string
  category: NodeCategory
  description: string
  outputType: OutputType | "none"
  /** Credit cost; undefined if free. May be a range like "1-8" if model-dependent. */
  creditCost?: number | string
  /** Input fields the node exposes for user override (subset of full config). */
  inputSchema?: { fields: Array<{ key: string; type: string; required?: boolean; options?: string[] }> }
  /** For AI nodes: list of provider IDs supported. */
  providers?: string[]
  /** Capabilities flags (e.g. "supports-reference-image", "supports-end-frame"). */
  capabilities?: string[]
}

/**
 * Hand-curated registry. Source of truth for `GET /v1/nodes`.
 * Add new entries when adding a new node type — see CLAUDE.md "New Node Registration".
 */
export const NODE_REGISTRY: NodeDescriptor[] = [
  {
    type: "text-prompt",
    label: "Text Prompt",
    category: "input",
    description: "User-supplied text prompt. Connect to AI nodes' prompt input.",
    outputType: "text",
    inputSchema: { fields: [{ key: "text", type: "text", required: true }] },
  },
  {
    type: "upload-image",
    label: "Upload Image",
    category: "input",
    description: "Upload an image asset. Output is the image URL.",
    outputType: "image",
    inputSchema: { fields: [{ key: "url", type: "image-url", required: true }] },
  },
  {
    type: "upload-video",
    label: "Upload Video",
    category: "input",
    description: "Upload a video asset.",
    outputType: "video",
    inputSchema: { fields: [{ key: "url", type: "video-url", required: true }] },
  },
  {
    type: "upload-audio",
    label: "Upload Audio",
    category: "input",
    description: "Upload an audio asset.",
    outputType: "audio",
    inputSchema: { fields: [{ key: "url", type: "audio-url", required: true }] },
  },
  {
    type: "youtube-video",
    label: "Video URL",
    category: "input",
    // outputType: video — input-resolver isVideoSourceType() treats youtube-video as a video source.
    description: "Download video or audio from YouTube, TikTok, Instagram, Facebook, or X.",
    outputType: "video",
    inputSchema: { fields: [{ key: "url", type: "text", required: true }] },
  },
  {
    type: "reference-audio",
    label: "Reference Audio",
    category: "input",
    // outputType: audio — source node (SOURCE_NODE_TYPES) that emits an audio URL.
    description: "Extract audio from YouTube videos or provide audio via upload/URL.",
    outputType: "audio",
  },
  {
    type: "rss-feed",
    label: "RSS Feed",
    category: "input",
    // outputType: data — source node that emits the selected RSS/Atom item (title/description/link).
    description: "Pull content from RSS/Atom feeds for automated content pipelines.",
    outputType: "data",
  },
  {
    type: "web-scrape",
    label: "Web Scrape",
    category: "input",
    // outputType: data — emits a structured JSON array via the `json` handle (creditCost auto-filled from STATIC_CREDIT_COSTS = 2).
    description: "Fetch data from web pages, Google Search, Instagram, TikTok, or RSS feeds and emit structured JSON.",
    outputType: "data",
  },

  {
    type: "generate-image",
    label: "Generate Image",
    category: "ai-image",
    description: "Generate an image from a text prompt using an AI provider.",
    outputType: "image",
    creditCost: "1-8",
    providers: [...IMAGE_GEN_PROVIDERS],
    capabilities: ["supports-reference-image", "supports-aspect-ratio"],
    inputSchema: {
      fields: [
        { key: "prompt", type: "text", required: true },
        { key: "provider", type: "select", options: [...IMAGE_GEN_PROVIDERS] },
        { key: "aspectRatio", type: "select" },
      ],
    },
  },
  {
    type: "image-to-video",
    label: "Image to Video",
    category: "ai-video",
    description: "Animate a still image into a video.",
    outputType: "video",
    creditCost: "10-125",
    providers: [...IMAGE_TO_VIDEO_PROVIDERS],
    capabilities: ["supports-end-frame", "supports-duration"],
    inputSchema: {
      fields: [
        { key: "imageUrl", type: "image-url", required: true },
        { key: "prompt", type: "text" },
        { key: "provider", type: "select", options: [...IMAGE_TO_VIDEO_PROVIDERS] },
        { key: "duration", type: "number" },
      ],
    },
  },
  {
    type: "text-to-video",
    label: "Text to Video",
    category: "ai-video",
    description: "Generate video from a text prompt.",
    outputType: "video",
    creditCost: "10-125",
    providers: [...TEXT_TO_VIDEO_PROVIDERS],
    inputSchema: {
      fields: [
        { key: "prompt", type: "text", required: true },
        { key: "provider", type: "select", options: [...TEXT_TO_VIDEO_PROVIDERS] },
      ],
    },
  },
  {
    type: "generate-video",
    label: "Generate Video",
    category: "ai-video",
    description:
      "Unified video generation node — dispatches dynamically to image-to-video when a start frame is wired, otherwise text-to-video. One node, both modes, full VIDEO_GEN_PROVIDERS catalog.",
    outputType: "video",
    // Inherits the i2v/t2v range — payload-builder routes to the same worker
    // handlers and STATIC_CREDIT_COSTS entries based on mode.
    creditCost: "10-125",
    providers: [...VIDEO_GEN_PROVIDERS],
    capabilities: ["supports-end-frame", "supports-duration", "supports-reference-image", "supports-reference-video", "supports-reference-audio"],
    inputSchema: {
      fields: [
        { key: "prompt", type: "text" },
        { key: "negativePrompt", type: "text" },
        { key: "startFrame", type: "image-url" },
        { key: "endFrame", type: "image-url" },
        { key: "imageReferences", type: "image-url-array" },
        { key: "videoReferences", type: "video-url-array" },
        { key: "audio", type: "audio-url" },
        { key: "audioReferences", type: "audio-url-array" },
        { key: "provider", type: "select", options: [...VIDEO_GEN_PROVIDERS] },
        { key: "duration", type: "number" },
      ],
    },
  },
  {
    type: "video-sfx",
    label: "Video SFX",
    category: "ai-video",
    description:
      "Generate synchronized SFX / foley / ambient audio for a video clip using Replicate's mmaudio. Credit cost scales with input clip duration (1cr ≤15s → 11cr ≤300s, pre-markup).",
    outputType: "video",
    // Duration-bucketed pricing — see `STATIC_CREDIT_COSTS["replicate-mmaudio:*"]`
    // in `ee/billing/credits.ts` and `bucketBaseCreditsFor` in `routes/video-sfx.ts`.
    // Range is pre-markup; user-visible cost is bucket × (1 + cost_markup_percent/100) × versions.
    creditCost: "1-11",
    providers: ["replicate-mmaudio"],
    capabilities: ["sound-effect"],
    inputSchema: {
      fields: [
        { key: "videoUrl", type: "video-url", required: true },
        { key: "prompt", type: "text" },
        { key: "negativePrompt", type: "text" },
      ],
    },
  },
  {
    type: "reference-sheet",
    label: "Reference Sheet",
    category: "ai-image",
    description:
      "Composite a reference sheet (turnaround / expression board / variation board / detail) from a connected character, object, or location. Compose-only — uses panels the entity already has; emits the sheet image plus a clean panel set for downstream multi-image consistency.",
    outputType: "image",
    creditCost: 4,
    capabilities: ["reference-sheet"],
    inputSchema: { fields: [{ key: "entityRef", type: "image-url", required: true }] },
  },
  {
    type: "text-to-speech",
    label: "Text to Speech",
    category: "ai-audio",
    description: "Synthesize speech from text using ElevenLabs.",
    outputType: "audio",
    creditCost: 4,
    providers: ["eleven_v3", "eleven_turbo_v2_5", "eleven_multilingual_v2"],
    inputSchema: {
      fields: [
        { key: "text", type: "text", required: true },
        { key: "voiceId", type: "text" },
        { key: "model", type: "select", options: ["eleven_v3", "eleven_turbo_v2_5", "eleven_multilingual_v2"] },
      ],
    },
  },
  {
    type: "generate-music",
    label: "Generate Music",
    category: "ai-audio",
    description: "Generate music with Suno.",
    outputType: "audio",
    creditCost: "7-13",
    providers: ["suno-v4", "suno-v5"],
  },
  {
    type: "suno-voice",
    label: "Suno Voice Persona",
    category: "ai-audio",
    description:
      "Create a custom Suno voice persona from a short recording. Configured once via a setup modal that runs the 2-step KIE voice/validate + voice/generate flow; emits a voiceId for use as personaId in suno-generate / suno-cover / suno-extend.",
    outputType: "none",
    creditCost: 20,
  },
  // ---- Additional ai-audio nodes (outputType: AUDIO_OUTPUT_NODE_TYPES in input-resolver.ts; creditCost auto-filled from STATIC_CREDIT_COSTS) ----
  { type: "text-to-audio", label: "Text to Audio", category: "ai-audio", description: "Generate sound effects and ambient audio from a text description using ElevenLabs SFX.", outputType: "audio" },
  { type: "text-to-dialogue", label: "Text to Dialogue", category: "ai-audio", description: "Generate multi-speaker dialogue audio where each line is spoken by a different voice.", outputType: "audio" },
  { type: "audio-isolation", label: "Audio Isolation", category: "ai-audio", description: "Isolate and clean up vocal audio by removing background noise and non-speech elements.", outputType: "audio" },
  {
    type: "voice-changer",
    label: "Voice Changer",
    category: "ai-audio",
    description: "Replace the voice in an audio recording — or in an entire talking video — with a different voice, preserving the original emotion, cadence, and timing. Audio in → audio out; video in → revoiced video out (plus the new audio track). Video wins when both inputs are wired.",
    outputType: "audio",
    creditCost: 4,
    capabilities: ["audio-to-audio", "video-revoice", "dual-output-handles"],
    inputSchema: {
      fields: [
        { key: "audioUrl", type: "audio-url" },
        { key: "videoUrl", type: "video-url" },
        { key: "voiceId", type: "string", required: true },
        { key: "removeBackgroundNoise", type: "boolean" },
      ],
    },
  },
  { type: "dubbing", label: "Dubbing", category: "ai-audio", description: "Translate spoken audio into another language while preserving the original speaker's voice and identity.", outputType: "audio" },
  { type: "voice-remix", label: "Voice Remix", category: "ai-audio", description: "Generate a voice from a natural language description and hear it speak preview text.", outputType: "audio" },
  { type: "voice-design", label: "Voice Design", category: "ai-audio", description: "Create a custom voice with full parameter controls and receive both an audio preview and a reusable voice ID.", outputType: "audio" },
  // Suno audio-track nodes (output audio) — suno-music-video is ai-video (above), suno-lyrics / suno-style-boost are ai-text (below).
  { type: "suno-generate", label: "Suno Generate", category: "ai-audio", description: "Full song generation using Suno AI with extensive creative controls.", outputType: "audio" },
  { type: "suno-cover", label: "Suno Cover", category: "ai-audio", description: "Create a cover version of an existing audio track using Suno AI.", outputType: "audio" },
  { type: "suno-extend", label: "Suno Extend", category: "ai-audio", description: "Extend an existing Suno-generated track by continuing from a specified timestamp.", outputType: "audio" },
  { type: "suno-separate", label: "Suno Separate Stems", category: "ai-audio", description: "Separate vocals from instrumentals, or split a track into individual stems.", outputType: "audio" },
  { type: "suno-mashup", label: "Suno Mashup", category: "ai-audio", description: "Blend two audio tracks into a single mashup using Suno AI.", outputType: "audio" },
  { type: "suno-replace-section", label: "Suno Replace Section", category: "ai-audio", description: "Replace a specific time range within a Suno-generated track with new content.", outputType: "audio" },
  { type: "suno-add-instrumental", label: "Suno Add Instrumental", category: "ai-audio", description: "Add an AI-generated instrumental backing track to an existing vocal track.", outputType: "audio" },
  { type: "suno-add-vocals", label: "Suno Add Vocals", category: "ai-audio", description: "Add AI-generated vocals to an existing instrumental track.", outputType: "audio" },
  { type: "suno-convert-wav", label: "Suno Convert WAV", category: "ai-audio", description: "Convert a Suno-generated MP3 audio track to lossless WAV format.", outputType: "audio" },
  { type: "suno-upload-extend", label: "Suno Upload & Extend", category: "ai-audio", description: "Extend any audio file (not limited to Suno-generated tracks) using Suno AI.", outputType: "audio" },
  // Suno text nodes (output text) — input-resolver TEXT_SOURCE_NODE_TYPES.
  { type: "suno-lyrics", label: "Suno Lyrics", category: "ai-text", description: "Generate song lyrics from a text prompt using Suno AI.", outputType: "text" },
  { type: "suno-style-boost", label: "Suno Style Boost", category: "ai-text", description: "Enhance and refine the style of lyrics or text content using Suno AI.", outputType: "text" },
  {
    type: "llm-chat",
    label: "Generate Text",
    category: "ai-text",
    description: "LLM text generation from a prompt (+ optional image/video/audio refs). Stream-capable. Two outputs: full text and a fan-out item list split on ===NEXT===.",
    outputType: "text",
    creditCost: "3-15",
  },
  {
    type: "generate-script",
    label: "Generate Script",
    category: "ai-text",
    // outputType: structured GeneratedScript (docs) — execution-graph TEXT_SOURCE_TYPES.
    description: "AI-powered multi-scene script generation with cinematography details, character actions, and structured scene breakdowns.",
    outputType: "text",
    // Variable per LLM tier: economy 1, standard 2, premium 3 (generate-script:* in STATIC_CREDIT_COSTS).
    creditCost: "1-3",
  },
  {
    type: "image-to-text",
    label: "Describe Image",
    category: "ai-text",
    // outputType: text (docs: "output is text, not an image") — input-resolver TEXT_SOURCE_NODE_TYPES.
    description: "Extract a text description from an image using Claude Sonnet vision, with configurable detail levels.",
    outputType: "text",
    // Flat 1cr across LLM tiers (image-to-text / :economy / :premium all = 1) — auto-filled from STATIC_CREDIT_COSTS.
  },
  {
    type: "transcribe",
    label: "Transcribe",
    category: "ai-text",
    // outputType: text — input-resolver TEXT_SOURCE_NODE_TYPES.
    description: "Convert spoken audio to text with optional speaker diarization and audio event tagging.",
    outputType: "text",
  },
  {
    type: "qa-check",
    label: "QA Check",
    category: "ai-text",
    description: "LLM quality gate — scores upstream text 0.0-1.0 against a check type (content / quality / consistency / safety) and returns score + approved + reason. Flat 1cr across LLM tiers (qa-check / :economy / :premium all = 1).",
    outputType: "text",
  },
  {
    type: "forced-alignment",
    label: "Forced Alignment",
    category: "ai-audio",
    // outputType: data — node is in input-resolver TEXT_SOURCE_NODE_TYPES, but its output is
    // JSON word-level timestamps (docs: "data-producing node — it outputs timing information,
    // not audio"). Overridden to "data" per the image-critic precedent (also in
    // TEXT_SOURCE_NODE_TYPES, registry classifies as data).
    description: "Generate word-level timestamps by aligning a transcript to its corresponding audio.",
    outputType: "data",
  },

  {
    type: "face-swap",
    label: "Face Swap",
    category: "ai-video",
    description: "Replace the face in a video with a face from a reference image.",
    outputType: "video",
    creditCost: 16,
    providers: ["roop"],
    inputSchema: {
      fields: [
        { key: "faceImageUrl", type: "image-url", required: true },
        { key: "videoUrl", type: "video-url", required: true },
      ],
    },
  },
  {
    type: "video-retake",
    label: "Retake Video",
    category: "ai-video",
    description:
      "Replace a portion of an existing video — audio only, video only, or both — using Lightricks LTX 2.3 Pro's `retake` task. Billed per second of replaced material.",
    outputType: "video",
    // Dynamic: `ltx-2.3-pro-retake:per-second × retakeDuration`. The route
    // computes the final reservation; this range covers 2s (minimum) to
    // ~10s of replacement at the seeded per-second rate.
    creditCost: "100-500",
    providers: ["ltx-2.3-pro"],
    capabilities: ["partial-replace", "audio-only", "video-only", "audio-and-video"],
    inputSchema: {
      fields: [
        { key: "videoUrl", type: "video-url", required: true },
        { key: "prompt", type: "text" },
        { key: "retakeStartTime", type: "number", required: true },
        { key: "retakeDuration", type: "number", required: true },
        { key: "retakeMode", type: "select", required: true, options: ["replace_audio", "replace_video", "replace_audio_and_video"] },
        { key: "aspectRatio", type: "select", options: ["16:9", "9:16"] },
        { key: "fps", type: "select", options: ["24", "25", "48", "50"] },
        { key: "generateAudio", type: "boolean" },
      ],
    },
  },
  // ---- Additional ai-video nodes (outputType: VIDEO_OUTPUT_NODE_TYPES in input-resolver.ts) ----
  {
    type: "video-to-video",
    label: "Video to Video",
    category: "ai-video",
    description: "Transform existing video using AI with a text prompt.",
    outputType: "video",
    inputSchema: {
      fields: [
        { key: "videoUrl", type: "video-url", required: true },
        { key: "prompt", type: "text" },
      ],
    },
  },
  {
    type: "lip-sync",
    label: "Lip Sync",
    category: "ai-video",
    description: "Sync audio to a character's face to create a talking head video.",
    outputType: "video",
    inputSchema: {
      fields: [
        { key: "imageUrl", type: "image-url" },
        { key: "videoUrl", type: "video-url" },
        { key: "audioUrl", type: "audio-url", required: true },
      ],
    },
  },
  {
    type: "speech-to-video",
    label: "Speech to Video",
    category: "ai-video",
    description: "Generate video driven by speech audio input using Wan 2.2.",
    outputType: "video",
    // Resolution-tiered: 480p 3, 580p 5, 720p 6 (speech-to-video:* in STATIC_CREDIT_COSTS).
    creditCost: "3-6",
    inputSchema: {
      fields: [
        { key: "imageUrl", type: "image-url" },
        { key: "audioUrl", type: "audio-url", required: true },
        { key: "prompt", type: "text" },
      ],
    },
  },
  {
    type: "ai-avatar",
    label: "AI Avatar",
    category: "ai-video",
    description: "Generate a talking-avatar video from a HeyGen avatar + voice + script, or wired audio.",
    outputType: "video",
    // Duration-bucketed (heygen-<engine>:<resolution>:<bucket>s in STATIC_CREDIT_COSTS).
    // 2 engines × 3 resolutions × 7 buckets (30–900s); range shown is for avatar-iv 720p.
    creditCost: "135-4050",
    providers: ["heygen"],
    capabilities: ["text-to-speech", "audio-input", "captions"],
    inputSchema: {
      fields: [
        // avatarSource determines which of the two source paths is active.
        // When avatarSource="image", avatarId is omitted and imageUrl is used.
        { key: "avatarSource", type: "select", options: ["avatar", "image"] },
        { key: "avatarId", type: "text", required: false },
        { key: "imageUrl", type: "image-url" },
        { key: "speechMode", type: "select", required: true, options: ["text", "audio"] },
        { key: "script", type: "text" },
        { key: "voiceId", type: "text" },
        { key: "audioUrl", type: "audio-url" },
        { key: "engine", type: "select", options: ["avatar-iv", "avatar-v"] },
        { key: "resolution", type: "select", options: ["720p", "1080p", "4k"] },
        { key: "aspectRatio", type: "select", options: ["16:9", "9:16"] },
      ],
    },
  },
  {
    type: "cinematic-avatar",
    label: "Cinematic Avatar",
    category: "ai-video",
    description:
      "Generate a cinematic, prompt-driven avatar clip from 1-3 HeyGen avatar looks (generative Seedance pipeline). No script/voice — the prompt IS the direction.",
    outputType: "video",
    // Duration × resolution tiered (cinematic-avatar:<resolution>:<durationSec>s in
    // STATIC_CREDIT_COSTS). 2 resolutions × 12 durations (4-15s); range is the
    // 720p:4s reserve ceiling → 1080p:15s reserve ceiling.
    creditCost: "45-248",
    providers: ["heygen"],
    capabilities: ["prompt-driven", "multi-avatar-look"],
    inputSchema: {
      fields: [
        { key: "prompt", type: "text", required: true },
        // 1-3 catalog avatar look ids (string array; same /v3/avatars/looks picker).
        { key: "avatarLooks", type: "text", required: true },
        { key: "duration", type: "number" },
        { key: "aspectRatio", type: "select", options: ["16:9", "9:16", "1:1"] },
        { key: "resolution", type: "select", options: ["720p", "1080p"] },
        { key: "enhancePrompt", type: "boolean" },
      ],
    },
  },
  {
    type: "motion-transfer",
    label: "Motion Transfer",
    category: "ai-video",
    description: "Apply motion from a reference video to a static character image.",
    outputType: "video",
    // Duration × resolution tiered (motion-transfer:5s 8 → motion-transfer:1080p:30s 68).
    creditCost: "8-68",
  },
  {
    type: "video-upscale",
    label: "Upscale Video",
    category: "ai-video",
    description: "Upscale video resolution using Topaz or VEO AI.",
    outputType: "video",
  },
  {
    type: "extend-video",
    label: "Extend Video",
    category: "ai-video",
    description: "Continue a generated video with a new prompt direction.",
    outputType: "video",
  },
  {
    type: "suno-music-video",
    label: "Suno Music Video",
    category: "ai-video",
    description: "Generate a music video for a Suno-generated track.",
    outputType: "video",
  },

  {
    type: "generate-mask",
    label: "Generate Mask",
    category: "ai-image",
    description: "Produce a binary segmentation mask for a subject described by a text prompt (Grounded SAM).",
    outputType: "image",
    creditCost: 2,
    providers: ["grounded-sam"],
    capabilities: ["segmentation", "inpainting-prep"],
    inputSchema: {
      fields: [
        { key: "imageUrl", type: "image-url", required: true },
        { key: "prompt", type: "text", required: true },
      ],
    },
  },
  // ---- Additional ai-image nodes (creditCost auto-filled from STATIC_CREDIT_COSTS; per-provider variable pricing) ----
  { type: "modify-image", label: "Modify Image", category: "ai-image", description: "Transform an existing image with a text prompt across 20+ image-to-image / editing providers (Flux, GPT Image, Ideogram, Nano Banana, Qwen, Seedream, + Nano Banana Edit). Migrated successor of edit-image.", outputType: "image", creditCost: "1-18" },
  { type: "upscale-image", label: "Upscale Image", category: "ai-image", description: "Increase image resolution with Recraft Upscale or Topaz Upscale (2K/4K/8K). No prompt — pure enhancement utility.", outputType: "image", creditCost: "1-10" },
  { type: "remove-background", label: "Remove Background", category: "ai-image", description: "Remove the background from an image and output a transparent PNG (Recraft).", outputType: "image" },

  {
    type: "image-critic",
    label: "Image Critic",
    category: "processing",
    description: "Score an image on realism / character consistency / prompt adherence / anatomy / aesthetic / style match via VLM. Two output handles (approved/rejected) for self-correction loops.",
    outputType: "data",
    creditCost: "3-15",
    inputSchema: {
      fields: [
        { key: "imageUrl", type: "image-url", required: true },
        { key: "mode", type: "select", required: true, options: ["character-consistency", "realism", "prompt-adherence", "anatomy", "aesthetic", "style-match", "all"] },
        { key: "threshold", type: "number" },
        { key: "prompt", type: "text" },
        { key: "referenceImageUrl", type: "image-url" },
      ],
    },
    capabilities: ["dual-output-handles", "vlm-based"],
  },

  { type: "combine-videos", label: "Combine Videos", category: "processing", description: "Concatenate multiple videos.", outputType: "video" },
  { type: "merge-video-audio", label: "Merge Video + Audio", category: "processing", description: "Mux a video and an audio track.", outputType: "video" },
  { type: "trim-video", label: "Trim Video", category: "processing", description: "Trim a video by start/end seconds.", outputType: "video" },
  { type: "resize-video", label: "Resize Video", category: "processing", description: "Resize a video.", outputType: "video" },
  { type: "extract-frame", label: "Extract Frame", category: "processing", description: "Extract a single frame as an image.", outputType: "image" },
  { type: "add-captions", label: "Add Captions", category: "processing", description: "Burn captions into a video. Static (subtitle) is FFmpeg/free; kinetic styles (word-highlight, karaoke, tiktok-words, word-pop, bouncy) render via Remotion at 5 credits.", outputType: "video", creditCost: "0-5" },
  { type: "speed-ramp", label: "Adjust Speed", category: "processing", description: "Change playback speed (0.05x to 100x), reverse, choose audio treatment (pitch-preserve / pitch-shift / drop), opt into motion-compensated frame interpolation (smooth slow-mo), or define a piecewise speed ramp via segments. FFmpeg only.", outputType: "video", creditCost: "2-5" },
  { type: "split-media", label: "Split into Chunks", category: "processing", description: "Split a video or audio file into equal-duration chunks for batch processing — emits a video clip and an audio file per chunk. (creditCost auto-filled from STATIC_CREDIT_COSTS = 2)", outputType: "video" },
  // ---- Additional processing nodes (video → VIDEO_OUTPUT_NODE_TYPES, audio → AUDIO_OUTPUT_NODE_TYPES in input-resolver.ts; creditCost auto-filled from STATIC_CREDIT_COSTS) ----
  { type: "loop-video", label: "Loop Video", category: "processing", description: "Repeat video to reach a target duration or count, with optional smart-loop-cut for seamless seams.", outputType: "video" },
  { type: "fade-video", label: "Fade Video", category: "processing", description: "Add fade transitions to the beginning and end of video.", outputType: "video" },
  { type: "transcode-video", label: "Transcode Video", category: "processing", description: "Convert video codec, quality, and resolution.", outputType: "video" },
  { type: "social-media-format", label: "Social Media Format", category: "processing", description: "Auto-format video for specific platform specifications.", outputType: "video" },
  { type: "manual-edit", label: "Manual Edit", category: "processing", description: "Open video in a browser-based web editor for manual adjustments.", outputType: "video" },
  { type: "remove-audio", label: "Remove Audio", category: "processing", description: "Strip the audio track from a video, leaving a silent clip (stream-copied, lossless).", outputType: "video" },
  { type: "trim-audio", label: "Trim Audio", category: "processing", description: "Extract a section of audio or extract audio from video.", outputType: "audio" },
  { type: "mix-audio", label: "Mix Audio", category: "processing", description: "Blend multiple audio tracks with individual volume control.", outputType: "audio" },
  { type: "combine-audio", label: "Combine Audio", category: "processing", description: "Concatenate audio tracks end-to-end in order, with optional per-segment trim. (Mix Audio layers tracks; this joins them sequentially.)", outputType: "audio" },
  { type: "extract-audio", label: "Extract Audio", category: "processing", description: "Demux the audio track from a video to a standalone MP3.", outputType: "audio" },
  { type: "adjust-volume", label: "Adjust Volume", category: "processing", description: "Change audio volume with optional normalize and fade-in / fade-out transitions (FFmpeg). (creditCost auto-filled from STATIC_CREDIT_COSTS = 1)", outputType: "audio" },

  { type: "render-video", label: "Render Video", category: "composition", description: "Render a Remotion composition to MP4.", outputType: "video", creditCost: 15 },
  { type: "after-effects", label: "After Effects", category: "composition", description: "AI-generated post-processing layer.", outputType: "video", creditCost: 2 },
  { type: "motion-graphics", label: "Motion Graphics", category: "composition", description: "AI-generated 2D motion graphics.", outputType: "video", creditCost: 2 },
  { type: "3d-title", label: "3D Title", category: "composition", description: "AI-generated 3D animated text.", outputType: "video", creditCost: 15 },
  // composition siblings of after-effects / motion-graphics / 3d-title (rendered video output).
  { type: "video-composer", label: "Video Composer", category: "composition", description: "AI-powered scene-graph video composition from natural language prompts.", outputType: "video", creditCost: "1-4" },
  { type: "lottie-overlay", label: "Lottie Overlay", category: "composition", description: "AI-placed timed Lottie animations overlaid on video.", outputType: "video", creditCost: "1-2" },
  { type: "composite", label: "Composite", category: "composition", description: "Multi-layer video compositor (up to 4 layers) with per-layer positioning, scale, blending, and opacity. Client-side plan, no AI — deterministic and free.", outputType: "video", creditCost: 0 },

  { type: "webhook-trigger", label: "Webhook Trigger", category: "trigger", description: "Trigger the workflow via HTTP POST.", outputType: "data" },
  { type: "schedule-trigger", label: "Schedule Trigger", category: "trigger", description: "Trigger the workflow on a cron/interval.", outputType: "data" },
  { type: "telegram-trigger", label: "Telegram Trigger", category: "trigger", description: "Trigger the workflow when a connected Telegram bot receives a message. Emits text + chatId + messageId + messageType (+ imageUrl/videoUrl/audioUrl for media). Free — downstream nodes incur their own costs.", outputType: "data" },

  { type: "save-to-storage", label: "Save to Storage", category: "output", description: "Persist a node output to user storage.", outputType: "none" },
  { type: "webhook-output", label: "Webhook Output", category: "output", description: "POST a node output to a URL.", outputType: "none" },
  // ---- Social-post nodes (SOCIAL_POST_NODE_TYPES in @nodaro/shared; outputType: none — terminal publish, matches sibling output nodes; creditCost auto-filled from STATIC_CREDIT_COSTS) ----
  { type: "instagram-post", label: "Instagram Post", category: "output", description: "Publish images, reels, stories, and carousels directly to Instagram.", outputType: "none" },
  { type: "tiktok-post", label: "TikTok Post", category: "output", description: "Publish video content directly to TikTok.", outputType: "none" },
  { type: "youtube-upload", label: "YouTube Upload", category: "output", description: "Upload videos and Shorts to YouTube with full metadata control.", outputType: "none" },
  { type: "linkedin-post", label: "LinkedIn Post", category: "output", description: "Post text, images, and video to LinkedIn.", outputType: "none" },
  { type: "x-post", label: "X Post", category: "output", description: "Post text, images, and video to X (Twitter).", outputType: "none" },
  { type: "facebook-post", label: "Facebook Post", category: "output", description: "Post text, images, video, and stories to Facebook.", outputType: "none" },
  { type: "telegram-post", label: "Telegram Post", category: "output", description: "Send a message, photo, or video to a Telegram chat, channel, or group via a connected bot (send type auto-detected from connected media).", outputType: "none" },

  { type: "list", label: "List", category: "control", description: "Static list of items for fan-out.", outputType: "data" },
  { type: "group", label: "Group", category: "utility", description: "Visual container that groups child nodes via React Flow parentId — emits members as a structured list to downstream consumers (Loop, Merge Lists, sub-workflow).", outputType: "data" },
  { type: "collect", label: "Collect", category: "utility", description: "Explicit list-builder — multiple inputs converge on a single 'in' handle in connection order and emit as a structured list downstream.", outputType: "data" },
  { type: "teleport-send", label: "Teleport Send", category: "utility", description: "Broadcast its upstream value on a named channel (A-F) without a visible wire — every Teleport Receive tuned to the same channel gets the value.", outputType: "data", creditCost: 0 },
  { type: "teleport-receive", label: "Teleport Receive", category: "utility", description: "Receive a value from a Teleport Send node on the same channel (A-F), without a visible wire. Multiple receivers can listen on one channel.", outputType: "data", creditCost: 0 },
  // ---- List / JSON utility nodes (inline-executor; outputType data; free — STATIC_CREDIT_COSTS = 0) ----
  { type: "filter-list", label: "Filter List", category: "utility", description: "Keep only the upstream list items matching one or more field conditions (AND/OR), with 12 operators (equals, contains, regex, in-list, ...).", outputType: "data", creditCost: 0 },
  { type: "sort-list", label: "Sort List", category: "utility", description: "Sort an upstream list by value or by a dot-path field, with Auto/Text/Number/Date comparison and asc/desc direction (missing values sort last).", outputType: "data", creditCost: 0 },
  { type: "deduplicate", label: "Deduplicate", category: "utility", description: "Remove duplicate items from an upstream list, keeping the first occurrence. Compares whole items or a dot-path field.", outputType: "data", creditCost: 0 },
  { type: "merge-lists", label: "Merge Lists", category: "utility", description: "Combine multiple upstream lists into one — concatenate (append in edge order) or zip (element-wise merge with modulo-wrap), with optional dedupe.", outputType: "data", creditCost: 0 },
  { type: "json-process", label: "JSON Process", category: "utility", description: "Transform upstream JSON — input-path drill, filter conditions, and field projection via a visual builder, or a raw transformation expression in Advanced mode.", outputType: "data", creditCost: 0 },
  { type: "extract-field", label: "Extract Field", category: "utility", description: "Pull a specific field or dot-notation path from upstream JSON — output can be a single string, a list for fan-out, or a raw JSON value.", outputType: "data", creditCost: 0 },
  { type: "router", label: "Router", category: "utility", description: "Conditionally split workflow execution into one or more named routes (radio / checkbox / conditional modes). Passes the upstream value through to each active route.", outputType: "data", creditCost: 0 },
  { type: "preview", label: "Preview", category: "utility", description: "Display any upstream result (text, image, video, or audio) inline on the canvas for inspection. Display-only sink — no downstream output.", outputType: "none", creditCost: 0 },
  { type: "sticky-note", label: "Sticky Note", category: "utility", description: "Place annotated notes on the workflow canvas for documentation and organization.", outputType: "none" },
  { type: "selector", label: "Selector", category: "utility", description: "Pick item(s) from a list — supports item/range/list/random/modulo/predicate/named-key modes. Two outputs: picked + rest.", outputType: "text", creditCost: 0 },
  { type: "combine-text", label: "Combine Text", category: "control", description: "Concatenate text inputs.", outputType: "text" },
  { type: "split-text", label: "Split Text", category: "control", description: "Split text by delimiter.", outputType: "text" },
  { type: "sub-workflow", label: "Sub-Workflow", category: "control", description: "Embed another workflow as a node. Selects a route (matched input+output pair) on the referenced workflow; ports become handles on the parent canvas. Expand opens the child for editing with a breadcrumb back to the parent.", outputType: "data", creditCost: 0 },
  { type: "sub-workflow-input", label: "Sub-Workflow Input", category: "control", description: "Entry boundary of a callable sub-workflow route. Declares per-port handles consumed by nodes inside the sub-workflow.", outputType: "data", creditCost: 0 },
  { type: "sub-workflow-output", label: "Sub-Workflow Output", category: "control", description: "Exit boundary of a callable sub-workflow route. Declares per-port handles collected from inner nodes and returned to the caller.", outputType: "none", creditCost: 0 },
  // category: utility per NODE_DEFINITIONS; placed near the sub-workflow nodes as a workflow-embedding construct.
  { type: "component", label: "Component", category: "utility", description: "Embed a published Nodaro Component (a curated, versioned sub-workflow from the marketplace or your own apps) as a black-box node — its exposed inputs/settings/outputs surface in the config panel.", outputType: "data", creditCost: 0 },
  {
    type: "reduce",
    label: "Reduce",
    category: "control",
    description: "Fan-in node — collapses N upstream values into one using a chosen strategy (pick-best-llm, concat, first-non-empty, count, vote, merge-json). Credit cost varies per strategy via the `reduce:<strategyId>` composite key.",
    outputType: "text",
    creditCost: "0-3",
    inputSchema: {
      fields: [
        { key: "strategyId", type: "select", required: true, options: ["pick-best-llm", "concat", "first-non-empty", "count", "vote", "merge-json"] },
        { key: "strategyConfig", type: "object" },
      ],
    },
    capabilities: ["fan-in"],
  },

  { type: "character", label: "Character", category: "entity", description: "Reusable character — portrait, expressions, poses, motion clips, voice & personality, edited in the full-screen Character Studio.", outputType: "data" },
  { type: "face", label: "Face", category: "entity", description: "Reusable face reference.", outputType: "data" },
  { type: "object", label: "Object/Props", category: "entity", description: "Reusable object / prop reference.", outputType: "data" },
  { type: "creature", label: "Animal/Creature", category: "entity", description: "Reusable animal / creature reference — species, angles, poses, variations, motion clips, edited in the full-screen Creature Studio.", outputType: "data" },
  { type: "location", label: "Location", category: "entity", description: "Reusable location reference.", outputType: "data" },

  {
    type: "generative-pipeline",
    label: "Story → Video",
    category: "composition",
    description: "Conversational pipeline: prompt + duration + format → editable film graph. Runs in the pipeline orchestrator, not the workflow DAG.",
    outputType: "video",
    creditCost: 30,
    inputSchema: {
      fields: [
        { key: "story_prompt", type: "text", required: true },
        { key: "target_duration_seconds", type: "number", required: true },
        { key: "format", type: "select", required: true, options: ["trailer", "short_film", "music_video", "reel", "commercial"] },
        { key: "output_resolution", type: "select", options: ["480p", "720p", "1080p", "4K"] },
        { key: "mode", type: "select", options: ["manual", "auto"] },
      ],
    },
    capabilities: ["runs-in-pipeline-engine", "requires-edition-cloud"],
  },

  {
    type: "scene",
    label: "Scene",
    category: "composition",
    description: "Structured scene container with shot list, camera, motion. Pipeline-managed — populated by the Scene Director LLM and animated by the pipeline orchestrator (Phase 1C). Outputs: composite_video / last_frame / audio_track. Not directly user-editable in 1B.2; users approve/reject scenes via the pipeline panel.",
    outputType: "video",
    creditCost: 0,
    inputSchema: { fields: [] },
    capabilities: ["runs-in-pipeline-engine", "requires-edition-cloud"],
  },

  { type: "music-genre",     label: "Music Genre",     category: "parameter", description: "Pick a music genre (single or up to 3 for fusion) with optional subgenre and era. Emits a prompt-hint for Suno/MiniMax/Text-to-Audio.", outputType: "text" },
  { type: "music-mood",      label: "Music Mood",      category: "parameter", description: "Pick energy + emotion + vibe for music generation.", outputType: "text" },
  { type: "instrumentation", label: "Instrumentation", category: "parameter", description: "Pick instruments (up to 5) + production style + vocal presence (up to 3) + singing style (up to 3). 'instrumental' vocal-presence flips MiniMax instrumental flag.", outputType: "text" },
  { type: "voice-character", label: "Voice Character", category: "parameter", description: "Pick age + gender + language (up to 3 for multilingual) + accent + timbre for ElevenLabs Voice Design.", outputType: "text" },
  { type: "voice-delivery",  label: "Voice Delivery",  category: "parameter", description: "Pick pace + emotion + archetype for ElevenLabs Voice Design.", outputType: "text" },

  // ---- Text / value parameter pickers (PARAMETER_NODE_TYPES in @nodaro/shared → outputType text) ----
  { type: "provider",     label: "Provider",     category: "parameter", description: "Select an AI provider and model (image / video / voice / script) to override the default provider on connected generation nodes.", outputType: "text", creditCost: 0 },
  { type: "tone",         label: "Tone",         category: "parameter", description: "Define a tone or style modifier text (e.g., \"cinematic\", \"cheerful\") to influence connected AI nodes.", outputType: "text" },
  { type: "style-guide",  label: "Style Guide",  category: "parameter", description: "Define visual style reference text for consistent aesthetics across AI generation nodes in a workflow.", outputType: "text" },
  { type: "motion",       label: "Motion",       category: "parameter", description: "Define the motion intensity level for connected video generation nodes.", outputType: "text" },
  { type: "scene-count",  label: "Scene Count",  category: "parameter", description: "Specify the number of scenes for script generation nodes.", outputType: "text" },
  { type: "duration",     label: "Duration",     category: "parameter", description: "Set a target duration in seconds for connected video or audio generation nodes.", outputType: "text" },
  { type: "aspect-ratio", label: "Aspect Ratio", category: "parameter", description: "Set the target aspect ratio for connected image and video generation nodes.", outputType: "text" },

  // ---- Look family (15) — visual style, look, mood, atmosphere ----
  { type: "setting",              label: "Setting",              category: "parameter", description: "Pick a setting from 63 entries across 4 categories (indoor, urban, nature, fantastical). Emits a setting-description prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "atmosphere",           label: "Atmosphere",           category: "parameter", description: "Pick an atmospheric condition from 40 entries (clear, fog, dust, rain, snow, smoke, ...). Emits an atmosphere prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "style",                label: "Style",                category: "parameter", description: "Pick a style preset from 48 entries (cinematic, anime, oil-painting, photoreal, ...). Emits a style-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "color-look",           label: "Color / Look",         category: "parameter", description: "Pick a color-grading look from 41 entries (warm, teal-orange, bleached, vintage, ...). Emits a color-grading prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "mood",                 label: "Mood",                 category: "parameter", description: "Pick a mood from 50 entries (calm, tense, melancholic, joyful, ominous, ...). Emits a mood/emotion prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "photographer",         label: "Photographer / Artist",category: "parameter", description: "Pick from 67 photographers, artists, directors, illustrators, or painters (Tim Walker, Deakins, Lubezki, Ghibli, Rutkowski, ...). Emits a 'style of X' prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "aesthetic",            label: "Aesthetic / Microtrend",category:"parameter", description: "Pick a microtrend aesthetic from 46 entries (y2k, cottagecore, vaporwave, dark-academia, ...). Emits an aesthetic-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "era",                  label: "Era / Period",         category: "parameter", description: "Pick a historical era from 32 entries (1950s, 1990s-mall, ancient-rome, victorian, ...). Emits a period prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "photo-genre",          label: "Photo Genre",          category: "parameter", description: "Pick a photography genre from 46 entries (fashion-editorial, street, macro, documentary, ...). Emits a genre/composition prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "backdrop",             label: "Backdrop",             category: "parameter", description: "Pick a studio backdrop from 40 entries (white-seamless, cyc-wall, gradient, painted, ...). Emits a backdrop prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "render-quality",       label: "Render Quality",       category: "parameter", description: "Pick a render-pipeline preset from 24 entries (raytracing, octane, unreal, blender, ...). Emits a render-quality prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "composition-effects",  label: "Composition Effect",   category: "parameter", description: "Pick a composition effect from 19 entries (bursting-through-frame, depth-of-field, rule-of-thirds, ...). Emits a composition prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "post-process-effects", label: "Post-Process Effect",  category: "parameter", description: "Pick a post-processing effect from 18 entries (vignette-soft, film-grain, light-leak, chromatic-aberration, ...). Emits a post-process prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "action-fx",            label: "Action FX",            category: "parameter", description: "Pick environmental effects (multi-pick) from the action-fx catalog (earthquake, lightning, explosion, falling-objects, ...). Emits a scene-event prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "loop-subject",         label: "Loop Subject",         category: "parameter", description: "Pick a loop subject from 35 entries across 2 categories. Emits a subject descriptor for seamlessly looped video content.", outputType: "text" },

  // ---- Camera family (5) — lens, format, motion, transition, character FX ----
  { type: "camera-motion",        label: "Camera Motion",        category: "parameter", description: "Pick a camera motion from 71 entries across categories (static/pan/tilt/dolly/zoom/track). Graph-aware: walks startState/endState input handles. Emits a 'beginning with X, ending with Y' prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "lens",                 label: "Lens",                 category: "parameter", description: "Pick a lens from 16 entries (wide-angle, normal-50mm, telephoto, fisheye, anamorphic, ...). Emits a lens-characteristic prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "camera-format",        label: "Camera / Film Stock",  category: "parameter", description: "Pick a camera or film format from 31 entries (35mm-film, IMAX, super-8, polaroid, vhs, ...). Emits a camera-medium prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "transition",           label: "Transition",           category: "parameter", description: "Pick a cinematic transition (76 entries, 8 categories) with position/duration/intensity timing fields. Multi-pick supported. Graph-aware startState/endState handles. Emits a transition prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "character-fx",         label: "Character FX",         category: "parameter", description: "Pick character-driven effects (57 entries, 5 categories — transformation, power, body-mod, face FX, aura) with position/duration/intensity timing. Multi-pick supported. Target ref-name substitution via the `target` input handle. Emits a subject-bound prompt fragment via the cinematography handle.", outputType: "text" },

  // ---- Subject / Object family (6) — pose, material, animal, vehicle, weapon, prop ----
  { type: "pose",                 label: "Pose",                 category: "parameter", description: "Pick a pose from 81 entries across categories (standing, sitting, action, dynamic). Emits a pose-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "material",             label: "Material",             category: "parameter", description: "Pick a material from 66 entries (silk, leather, metal, glass, marble, ...). Emits a material-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "animal",               label: "Animal",               category: "parameter", description: "Pick an animal from 126 entries across subcategories (mammal, bird, reptile, sea, insect, etc.). Emits 'featuring a X' prompt fragment with description via the cinematography handle.", outputType: "text" },
  { type: "vehicle",              label: "Vehicle",              category: "parameter", description: "Pick a vehicle from 107 entries across subcategories (car, truck, motorcycle, boat, aircraft, spaceship, etc.). Emits 'featuring a X' prompt fragment with description via the cinematography handle.", outputType: "text" },
  { type: "weapon",               label: "Weapon",               category: "parameter", description: "Pick a weapon from 85 entries across subcategories (blade, ranged, firearm, fantasy, sci-fi, etc.). Emits 'with a X' prompt fragment with description via the cinematography handle.", outputType: "text" },
  { type: "held-prop",            label: "Held Prop",            category: "parameter", description: "Pick a held prop from 59 entries (smartphone, umbrella, bouquet, briefcase, ...). Emits a held-prop prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "furniture",            label: "Furniture",            category: "parameter", description: "Pick a furniture piece from 78 entries across 9 categories (seating, tables, beds, storage, lighting, kitchen-dining, outdoor, decorative, bath). Emits an 'including a X' prompt fragment with description via the cinematography handle.", outputType: "text" },

  // ---- Multi-dim family (6) — composed pickers with multiple fields ----
  { type: "framing",              label: "Framing",              category: "parameter", description: "Multi-dim picker for shot-size + angle + coverage + composition + vantage (72 catalog options across 5 fields). Emits a framing-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "lighting",             label: "Lighting",             category: "parameter", description: "Multi-dim picker for time-of-day + lighting-style + lighting-direction (72 catalog options across 3 fields). Emits a lighting-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "person",               label: "Person",               category: "parameter", description: "Multi-dim picker for person attributes — type, age, ethnicity, build, body proportions, face shape, jawline, eyes, nose, lips, hair, eyebrows, skin, facial hair, distinctive features (547 options across 20 fields). Emits a detailed person-description prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "styling",              label: "Styling",              category: "parameter", description: "Multi-dim picker for makeup + eyewear + headwear + hair cut/treatment + jewelry + nails + face-paint + fabric (262 catalog options across 9 fields). Emits a styling-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "temporal",             label: "Temporal",             category: "parameter", description: "Multi-dim picker for temporal-speed + freeze + direction + shutter (18 catalog options across 4 fields). Emits a temporal-effect prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "exposure-settings",    label: "Exposure Settings",    category: "parameter", description: "Multi-dim picker for aperture + shutter-speed + ISO (20 catalog options across 3 fields). Emits a camera-exposure prompt fragment via the cinematography handle.", outputType: "text" },
]

/** Enrich descriptors with live credit costs from STATIC_CREDIT_COSTS. */
export function getEnrichedRegistry(): NodeDescriptor[] {
  return NODE_REGISTRY.map((desc) => {
    if (desc.creditCost !== undefined) return desc
    const cost = STATIC_CREDIT_COSTS[desc.type]
    return typeof cost === "number" ? { ...desc, creditCost: cost } : desc
  })
}

export function findNode(type: string): NodeDescriptor | undefined {
  return getEnrichedRegistry().find((n) => n.type === type)
}
