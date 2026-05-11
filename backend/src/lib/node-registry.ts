import type { OutputType } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../ee/billing/credits.js"
import {
  IMAGE_GEN_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
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
    type: "ai-writer",
    label: "AI Agent",
    category: "ai-text",
    description: "LLM-powered text generation. Stream-capable.",
    outputType: "text",
    creditCost: 5,
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

  { type: "combine-videos", label: "Combine Videos", category: "processing", description: "Concatenate multiple videos.", outputType: "video" },
  { type: "merge-video-audio", label: "Merge Video + Audio", category: "processing", description: "Mux a video and an audio track.", outputType: "video" },
  { type: "trim-video", label: "Trim Video", category: "processing", description: "Trim a video by start/end seconds.", outputType: "video" },
  { type: "resize-video", label: "Resize Video", category: "processing", description: "Resize a video.", outputType: "video" },
  { type: "extract-frame", label: "Extract Frame", category: "processing", description: "Extract a single frame as an image.", outputType: "image" },
  { type: "add-captions", label: "Add Captions", category: "processing", description: "Burn captions into a video. Static (subtitle) is FFmpeg/free; kinetic styles (word-highlight, karaoke, tiktok-words, word-pop, bouncy) render via Remotion at 5 credits.", outputType: "video", creditCost: "0-5" },

  { type: "render-video", label: "Render Video", category: "composition", description: "Render a Remotion composition to MP4.", outputType: "video", creditCost: 15 },
  { type: "after-effects", label: "After Effects", category: "composition", description: "AI-generated post-processing layer.", outputType: "video", creditCost: 2 },
  { type: "motion-graphics", label: "Motion Graphics", category: "composition", description: "AI-generated 2D motion graphics.", outputType: "video", creditCost: 2 },
  { type: "3d-title", label: "3D Title", category: "composition", description: "AI-generated 3D animated text.", outputType: "video", creditCost: 15 },

  { type: "webhook-trigger", label: "Webhook Trigger", category: "trigger", description: "Trigger the workflow via HTTP POST.", outputType: "data" },
  { type: "schedule-trigger", label: "Schedule Trigger", category: "trigger", description: "Trigger the workflow on a cron/interval.", outputType: "data" },

  { type: "save-to-storage", label: "Save to Storage", category: "output", description: "Persist a node output to user storage.", outputType: "none" },
  { type: "webhook-output", label: "Webhook Output", category: "output", description: "POST a node output to a URL.", outputType: "none" },

  { type: "list", label: "List", category: "control", description: "Static list of items for fan-out.", outputType: "data" },
  { type: "loop", label: "Loop", category: "control", description: "Multi-column loop / table.", outputType: "data" },
  { type: "combine-text", label: "Combine Text", category: "control", description: "Concatenate text inputs.", outputType: "text" },
  { type: "split-text", label: "Split Text", category: "control", description: "Split text by delimiter.", outputType: "text" },

  { type: "character", label: "Character", category: "entity", description: "Reusable character definition with reference image.", outputType: "data" },
  { type: "face", label: "Face", category: "entity", description: "Reusable face reference.", outputType: "data" },
  { type: "object", label: "Object", category: "entity", description: "Reusable object reference.", outputType: "data" },
  { type: "location", label: "Location", category: "entity", description: "Reusable location reference.", outputType: "data" },

  { type: "music-genre",     label: "Music Genre",     category: "parameter", description: "Pick a music genre (single or up to 3 for fusion) with optional subgenre and era. Emits a prompt-hint for Suno/MiniMax/Text-to-Audio.", outputType: "text" },
  { type: "music-mood",      label: "Music Mood",      category: "parameter", description: "Pick energy + emotion + vibe for music generation.", outputType: "text" },
  { type: "instrumentation", label: "Instrumentation", category: "parameter", description: "Pick instruments (up to 5) + production style + vocal presence (up to 3) + singing style (up to 3). 'instrumental' vocal-presence flips MiniMax instrumental flag.", outputType: "text" },
  { type: "voice-character", label: "Voice Character", category: "parameter", description: "Pick age + gender + language (up to 3 for multilingual) + accent + timbre for ElevenLabs Voice Design.", outputType: "text" },
  { type: "voice-delivery",  label: "Voice Delivery",  category: "parameter", description: "Pick pace + emotion + archetype for ElevenLabs Voice Design.", outputType: "text" },
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
