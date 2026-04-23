/**
 * Presentation / API utilities — pure logic, no React deps.
 * Shared between frontend (presentation mode) and backend (API schema generation).
 */

import type { GenericNode, GenericEdge } from "./types.js"
import type { PresentationItem } from "./presentation-types.js"

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
  "framing",
  "lens",
  "camera-format",
  "lighting",
  "color-look",
  "atmosphere",
  "temporal",
  "reference-audio",
])

const TRIGGER_NODE_TYPES = new Set([
  "webhook-trigger",
  "schedule-trigger",
])

const ALWAYS_EXCLUDED_TYPES = new Set([
  "sticky-note",
  "webhook-trigger",
  "schedule-trigger",
  "sub-workflow-input",
  "sub-workflow-output",
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
  "framing",
  "lens",
  "camera-format",
  "lighting",
  "color-look",
  "atmosphere",
  "temporal",
  "sticky-note",
  "sub-workflow-input",
  "sub-workflow-output",
  "webhook-trigger",
  "schedule-trigger",
  "combine-text",
  "split-text",
  "save-to-storage",
  "webhook-output",
  "component",
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
  "social-media-format",
])

const AUDIO_OUTPUT_TYPES = new Set([
  "text-to-speech", "generate-music", "text-to-audio",
  "text-to-dialogue", "voice-changer", "dubbing", "voice-remix",
  "voice-design", "mix-audio", "adjust-volume", "trim-audio",
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
    if (!n.type || ALWAYS_EXCLUDED_TYPES.has(n.type)) return false
    if (n.hidden) return false
    if (curatedOnly) {
      // New explicit flag
      if (n.data.presentationInput === true) return true
      // Backwards compat: old flag on input-type nodes
      if (n.data.presentationVisible === true && INPUT_NODE_TYPES.has(n.type)) return true
      return false
    }
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
    if (!n.type || ALWAYS_EXCLUDED_TYPES.has(n.type)) return false
    if (n.hidden) return false
    if (curatedOnly) {
      // New explicit flag
      if (n.data.presentationOutput === true) return true
      // Backwards compat: old flag on output-eligible nodes
      if (n.data.presentationVisible === true) {
        if (NON_OUTPUT_TYPES.has(n.type)) return false
        return !nodesWithOutgoing.has(n.id) || MEDIA_PRODUCING_TYPES.has(n.type)
      }
      return false
    }
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
  // Preview node: extract first visible item from previewItems
  const previewItems = nodeData.previewItems as
    | Array<{ type: string; value: string; visible?: boolean }>
    | undefined
  if (previewItems && previewItems.length > 0) {
    const first = previewItems.find((item) => item.visible !== false) ?? previewItems[0]
    if (first) {
      if (first.type === "image" || first.type === "video" || first.type === "audio") {
        return { url: first.value }
      }
      return { text: first.value }
    }
  }

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

export const INPUT_FIELD_MAP: Record<string, InputFieldSchema> = {
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
  // Multi-category framing/lighting nodes don't have a single value field.
  // For presentation-mode override purposes we pick the first per-category
  // field as a representative key (shotSize for framing, timeOfDay for
  // lighting). Future: add per-category override schema entries.
  "framing": { key: "shotSize", type: "select" },
  "lens": { key: "lens", type: "select" },
  "camera-format": { key: "cameraFormat", type: "select" },
  "lighting": { key: "timeOfDay", type: "select" },
  "color-look": { key: "colorLook", type: "select" },
  "atmosphere": { key: "atmosphere", type: "select" },
  "temporal": { key: "temporalSpeed", type: "select" },
  "reference-audio": { key: "extractedAudioUrl", type: "audio-url" },
}

/** Get the overridable field schema for an input node type. */
export function getInputFieldSchema(nodeType: string): InputFieldSchema | undefined {
  return INPUT_FIELD_MAP[nodeType]
}

// ---------------------------------------------------------------------------
// Migration & validation helpers (PresentationItem)
// ---------------------------------------------------------------------------

/** Migrate a legacy string[] order to PresentationItem[]. */
export function migrateToItems(order: string[] | undefined): PresentationItem[] | undefined {
  if (!order) return undefined
  return order.map((nodeId) => ({ type: "node" as const, nodeId }))
}

/** Strip nested groups — groups may only contain non-group items. */
export function validateNoNestedGroups(items: PresentationItem[]): PresentationItem[] {
  return items.map((item) => {
    if (item.type === "group") {
      return { ...item, items: item.items.filter((child) => child.type !== "group") }
    }
    return item
  })
}

/** Recursively flatten all items, unwrapping groups. */
export function flattenItems(items: PresentationItem[]): PresentationItem[] {
  const result: PresentationItem[] = []
  for (const item of items) {
    if (item.type === "group") {
      result.push(...flattenItems(item.items))
    } else {
      result.push(item)
    }
  }
  return result
}

/** Get the sortable/unique ID for a PresentationItem. */
export function getItemSortId(item: PresentationItem): string {
  return item.type === "node" ? item.nodeId : item.id
}

/** Remove items whose nodeId no longer exists in the workflow. */
export function cleanOrphanedItems(
  items: PresentationItem[],
  nodeIds: Set<string>
): PresentationItem[] {
  return items
    .filter((item) => {
      if (item.type === "node" || item.type === "field" || item.type === "output") return nodeIds.has(item.nodeId)
      return true
    })
    .map((item) => {
      if (item.type === "group") {
        return { ...item, items: cleanOrphanedItems(item.items, nodeIds) }
      }
      return item
    })
}
