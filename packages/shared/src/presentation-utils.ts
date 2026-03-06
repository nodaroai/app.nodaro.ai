/**
 * Presentation / API utilities — pure logic, no React deps.
 * Shared between frontend (presentation mode) and backend (API schema generation).
 */

import type { GenericNode, GenericEdge } from "./types.js"

// ---------------------------------------------------------------------------
// Node type sets
// ---------------------------------------------------------------------------

export const INPUT_NODE_TYPES = new Set([
  "text-prompt",
  "upload-image",
  "upload-video",
  "upload-audio",
  "tone",
  "style-guide",
  "provider",
  "scene-count",
  "duration",
  "aspect-ratio",
  "motion",
  "camera-motion",
  "reference-audio",
])

const TRIGGER_NODE_TYPES = new Set([
  "webhook-trigger",
  "schedule-trigger",
])

const NON_OUTPUT_TYPES = new Set([
  "text-prompt",
  "list",
  "loop",
  "upload-image",
  "upload-video",
  "upload-audio",
  "reference-audio",
  "rss-feed",
  "youtube-video",
  "tone",
  "style-guide",
  "provider",
  "scene-count",
  "duration",
  "aspect-ratio",
  "motion",
  "camera-motion",
  "sticky-note",
  "sub-workflow-input",
  "sub-workflow-output",
  "webhook-trigger",
  "schedule-trigger",
  "combine-text",
  "split-text",
  "save-to-storage",
  "webhook-output",
])

const MEDIA_PRODUCING_TYPES = new Set([
  "generate-image",
  "edit-image",
  "image-to-image",
  "image-to-video",
  "text-to-video",
  "video-to-video",
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "generate-script",
  "ai-writer",
  "render-video",
  "video-composer",
  "after-effects",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "composite",
  "text-to-dialogue",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "voice-design",
  "extend-video",
  "lip-sync",
  "motion-transfer",
  "video-upscale",
])

// Output type categorizations
const IMAGE_OUTPUT_TYPES = new Set([
  "generate-image", "edit-image", "image-to-image",
  "upload-image",
])

const VIDEO_OUTPUT_TYPES = new Set([
  "image-to-video", "text-to-video", "video-to-video", "extend-video",
  "render-video", "video-composer", "after-effects", "lottie-overlay",
  "3d-title", "motion-graphics", "composite",
  "combine-videos", "merge-video-audio", "resize-video", "trim-video",
  "speed-ramp", "loop-video", "fade-video", "transcode-video",
  "upload-video",
  "lip-sync", "motion-transfer", "video-upscale", "add-captions",
])

const AUDIO_OUTPUT_TYPES = new Set([
  "text-to-speech", "generate-music", "text-to-audio",
  "text-to-dialogue", "voice-changer", "dubbing", "voice-remix",
  "voice-design", "mix-audio", "adjust-volume", "extract-audio",
  "audio-isolation",
  "upload-audio",
])

const TEXT_OUTPUT_TYPES = new Set([
  "generate-script", "ai-writer", "transcribe", "image-to-text", "qa-check",
  "text-prompt",
])

// ---------------------------------------------------------------------------
// Output type enum
// ---------------------------------------------------------------------------

export type OutputType = "image" | "video" | "audio" | "text" | "data"

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/** Get nodes that act as user inputs (text prompts, uploads, parameters). */
export function getInputNodes<T extends GenericNode>(nodes: T[], curatedOnly = true): T[] {
  return nodes.filter((n) => {
    if (!n.type || !INPUT_NODE_TYPES.has(n.type)) return false
    if (n.hidden) return false
    if (TRIGGER_NODE_TYPES.has(n.type)) return false
    if (curatedOnly) return n.data.presentationVisible === true
    return true
  })
}

/** Get leaf/media-producing nodes that represent workflow outputs. */
export function getOutputNodes<T extends GenericNode>(
  nodes: T[],
  edges: GenericEdge[],
  curatedOnly = true,
): T[] {
  const nodesWithOutgoing = new Set(edges.map((e) => e.source))

  return nodes.filter((n) => {
    if (!n.type) return false
    if (n.hidden) return false
    if (NON_OUTPUT_TYPES.has(n.type)) return false

    // A node is an output if it either produces media or has no outgoing edges
    const isOutput = !nodesWithOutgoing.has(n.id) || MEDIA_PRODUCING_TYPES.has(n.type)
    if (!isOutput) return false

    if (curatedOnly) return n.data.presentationVisible === true
    return true
  })
}

/** Map node type to its output media type. */
export function getOutputType(nodeType: string | undefined): OutputType {
  if (!nodeType) return "data"
  if (IMAGE_OUTPUT_TYPES.has(nodeType)) return "image"
  if (VIDEO_OUTPUT_TYPES.has(nodeType)) return "video"
  if (AUDIO_OUTPUT_TYPES.has(nodeType)) return "audio"
  if (TEXT_OUTPUT_TYPES.has(nodeType)) return "text"
  return "data"
}

/** Extract the result URL or text from a node's data. */
export function getNodeResult(
  nodeData: Record<string, unknown>,
): { url?: string; text?: string } {
  const results = nodeData.generatedResults as
    | Array<Record<string, unknown>>
    | undefined

  if (results && results.length > 0) {
    const idx = (nodeData.activeResultIndex as number) ?? 0
    const active = results[idx] ?? results[0]
    const url = (active?.url ?? active?.imageUrl ?? active?.videoUrl ?? active?.audioUrl) as
      | string
      | undefined
    const text = (active?.text ?? active?.script) as string | undefined
    return { url, text }
  }

  // Fallback to individual generated fields
  const url = (nodeData.generatedImageUrl ??
    nodeData.generatedVideoUrl ??
    nodeData.generatedAudioUrl) as string | undefined
  const text = (nodeData.generatedScript ?? nodeData.generatedText) as
    | string
    | undefined

  return { url, text }
}

/** Human-readable label for a node. */
export function getNodeLabel(node: GenericNode): string {
  return (
    (node.data.label as string) ||
    node.type?.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
    "Node"
  )
}

// ---------------------------------------------------------------------------
// Input field schema (for API schema generation)
// ---------------------------------------------------------------------------

export interface InputFieldSchema {
  key: string
  type: "text" | "image-url" | "video-url" | "audio-url" | "select" | "number"
  options?: string[]
}

const INPUT_FIELD_MAP: Record<string, InputFieldSchema> = {
  "text-prompt": { key: "text", type: "text" },
  "upload-image": { key: "url", type: "image-url" },
  "upload-video": { key: "url", type: "video-url" },
  "upload-audio": { key: "url", type: "audio-url" },
  "tone": { key: "tone", type: "select" },
  "style-guide": { key: "styleGuide", type: "text" },
  "provider": { key: "provider", type: "select" },
  "aspect-ratio": { key: "aspectRatio", type: "select" },
  "duration": { key: "duration", type: "number" },
  "scene-count": { key: "count", type: "number" },
  "motion": { key: "motion", type: "select" },
  "camera-motion": { key: "cameraMotion", type: "select" },
  "reference-audio": { key: "extractedAudioUrl", type: "audio-url" },
}

/** Get the overridable field schema for an input node type. */
export function getInputFieldSchema(nodeType: string): InputFieldSchema | undefined {
  return INPUT_FIELD_MAP[nodeType]
}
