/**
 * Extract output from completed node execution or source node data.
 * Backend equivalent of frontend extractNodeOutput().
 *
 * In the backend, outputs come from two sources:
 * 1. Job `output_data` (for executed nodes) — stored in nodeStates[nodeId].output
 * 2. Node `data` fields (for source nodes like text-prompt, upload-*)
 */

import type { SimpleNode, NodeOutput } from "./types.js"
import {
  IMAGE_SOURCE_TYPES,
  VIDEO_SOURCE_TYPES,
  AUDIO_SOURCE_TYPES,
  TEXT_SOURCE_TYPES,
} from "./execution-graph.js"

// Node types that output a plan (not a media URL)
const PLAN_NODE_TYPES = new Set([
  "after-effects",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "composite",
  "video-composer",
])

// All NodeOutput keys that map 1:1 from job output_data
const DIRECT_OUTPUT_KEYS: Array<keyof NodeOutput> = [
  "imageUrl",
  "videoUrl",
  "audioUrl",
  "text",
  "thumbnailUrl",
  "sunoTrackId",
  "sunoTaskId",
  "generatedVoiceId",
  "alignment",
  "script",
  "vocalUrl",
  "instrumentalUrl",
  "splitResults",
  "combinedText",
  "kieTaskId",
]

// Job output_data keys that all map to NodeOutput.plan
const PLAN_OUTPUT_KEYS = [
  "effectPlan",
  "overlayPlan",
  "titlePlan",
  "motionPlan",
  "compositePlan",
  "plan",
]

/**
 * Extract output from a source node's static data (no execution needed).
 */
export function extractSourceNodeOutput(
  node: SimpleNode,
  triggerData?: Record<string, unknown>,
): NodeOutput | undefined {
  const data = node.data
  const type = node.type

  switch (type) {
    case "text-prompt": {
      const text = (data.text as string | undefined)?.trim()
      return text ? { text } : undefined
    }

    case "upload-image": {
      const url = (data.url as string | undefined)?.trim()
      return url ? { imageUrl: url } : undefined
    }

    case "upload-video": {
      const url = (data.url as string | undefined)?.trim()
      return url ? { videoUrl: url } : undefined
    }

    case "upload-audio": {
      const url =
        (data.r2Url as string | undefined)?.trim() ||
        (data.url as string | undefined)?.trim()
      return url ? { audioUrl: url } : undefined
    }

    case "youtube-video": {
      const url =
        (data.downloadedVideoUrl as string | undefined)?.trim() ||
        (data.youtubeUrl as string | undefined)?.trim()
      return url ? { videoUrl: url } : undefined
    }

    case "reference-audio": {
      const url = (data.extractedAudioUrl as string | undefined)?.trim()
      return url ? { audioUrl: url } : undefined
    }

    case "list": {
      const items = (data.items as string | undefined) || ""
      const firstLine = items
        .split("\n")
        .find((l) => l.trim().length > 0)
        ?.trim()
      return firstLine ? { text: firstLine } : undefined
    }

    case "loop": {
      const rows = data.rows as string[][] | undefined
      const firstVal = rows?.[0]?.[0]?.trim()
      return firstVal ? { text: firstVal } : undefined
    }

    case "webhook-trigger": {
      if (!triggerData) return undefined
      const output: NodeOutput = {}
      if (triggerData.prompt) output.text = triggerData.prompt as string
      if (triggerData.imageUrl) output.imageUrl = triggerData.imageUrl as string
      if (triggerData.videoUrl) output.videoUrl = triggerData.videoUrl as string
      if (triggerData.audioUrl) output.audioUrl = triggerData.audioUrl as string
      return Object.keys(output).length > 0 ? output : { text: JSON.stringify(triggerData) }
    }

    case "schedule-trigger": {
      // Only produce timestamp output for actual scheduled triggers, not manual runs
      if (!triggerData) return undefined
      return { text: (triggerData.timestamp as string) ?? new Date().toISOString() }
    }

    default:
      return undefined
  }
}

/**
 * Get the primary media URL or text from a NodeOutput, given the source node type.
 * Uses the media type sets from execution-graph.ts for consistency.
 */
export function getPrimaryOutput(
  output: NodeOutput,
  sourceType: string,
  sourceHandle?: string | null,
): string | undefined {
  // Sub-workflow output routing by handle
  if (sourceType === "sub-workflow" && sourceHandle) {
    return output.text || output.imageUrl || output.videoUrl || output.audioUrl
  }

  // Plan nodes return a marker
  if (PLAN_NODE_TYPES.has(sourceType)) {
    return output.plan ? "plan-ready" : undefined
  }

  // Adjust-volume can output either audio or video
  if (sourceType === "adjust-volume") {
    return output.videoUrl || output.audioUrl
  }

  if (IMAGE_SOURCE_TYPES.has(sourceType)) return output.imageUrl
  if (VIDEO_SOURCE_TYPES.has(sourceType)) return output.videoUrl
  if (AUDIO_SOURCE_TYPES.has(sourceType)) return output.audioUrl
  if (TEXT_SOURCE_TYPES.has(sourceType)) return output.text

  // Fallback: return first available URL/text
  return output.imageUrl || output.videoUrl || output.audioUrl || output.text
}

// ---------------------------------------------------------------------------
// Helper to read generatedResults from node data (common pattern)
// ---------------------------------------------------------------------------

interface GeneratedResult {
  url?: string
  text?: string
  [key: string]: unknown
}

function getActiveResultUrl(data: Record<string, unknown>): string | undefined {
  const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
  const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
  return results[activeIndex]?.url
}

function getActiveResultText(data: Record<string, unknown>): string | undefined {
  const results = (data.generatedResults as Array<{ text?: string }> | undefined) ?? []
  const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
  return results[activeIndex]?.text
}

// ---------------------------------------------------------------------------
// Extract saved output from node data (for previously-executed nodes)
// ---------------------------------------------------------------------------

/** Image-generating node types that store results in generatedImageUrl / generatedResults */
const IMAGE_RESULT_TYPES = new Set([
  "generate-image",
  "edit-image",
  "image-to-image",
])

/** Video-generating node types that store results in generatedVideoUrl / generatedResults */
const VIDEO_RESULT_TYPES = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "lip-sync",
  "motion-transfer",
  "video-upscale",
  "suno-music-video",
  "render-video",
  "combine-videos",
  "merge-video-audio",
  "add-captions",
  "resize-video",
  "trim-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "transcode-video",
  "manual-edit",
])

/** Audio-generating node types that store results in generatedAudioUrl / generatedResults */
const AUDIO_RESULT_TYPES = new Set([
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-separate",
  "text-to-dialogue",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "voice-design",
  "extract-audio",
  "mix-audio",
])

/** Entity node types that store sourceImageUrl / generatedResults */
const ENTITY_RESULT_TYPES = new Set([
  "character",
  "face",
  "object",
  "location",
])

/**
 * Extract saved output from a node's data fields (for previously-executed nodes).
 * Backend port of frontend extractNodeOutput().
 * Used by the orchestrator to pre-populate out-of-subset nodes for "run from here".
 */
export function extractSavedNodeOutput(node: SimpleNode): NodeOutput | undefined {
  const data = node.data
  const type = node.type

  // Image-generating nodes → imageUrl from generatedResults or generatedImageUrl
  if (IMAGE_RESULT_TYPES.has(type)) {
    const url =
      getActiveResultUrl(data) ??
      (data.generatedImageUrl as string | undefined) ??
      (data.url as string | undefined)
    return url ? { imageUrl: url } : undefined
  }

  // Video-generating nodes → videoUrl from generatedResults or generatedVideoUrl
  if (VIDEO_RESULT_TYPES.has(type)) {
    const url =
      getActiveResultUrl(data) ??
      (data.generatedVideoUrl as string | undefined)
    return url ? { videoUrl: url } : undefined
  }

  // Audio-generating nodes → audioUrl from generatedResults or generatedAudioUrl
  if (AUDIO_RESULT_TYPES.has(type)) {
    const url =
      getActiveResultUrl(data) ??
      (data.generatedAudioUrl as string | undefined)
    return url ? { audioUrl: url } : undefined
  }

  // Adjust-volume → could be audio or video
  if (type === "adjust-volume") {
    const lastInputType = (data.lastInputType as string | undefined) ?? "audio"
    const url =
      getActiveResultUrl(data) ??
      (lastInputType === "video"
        ? (data.generatedVideoUrl as string | undefined)
        : (data.generatedAudioUrl as string | undefined))
    if (lastInputType === "video") {
      return url ? { videoUrl: url } : undefined
    }
    return url ? { audioUrl: url } : undefined
  }

  // Entity nodes → imageUrl from generatedResults or sourceImageUrl
  if (ENTITY_RESULT_TYPES.has(type)) {
    const url =
      getActiveResultUrl(data) ??
      (data.sourceImageUrl as string | undefined)
    return url ? { imageUrl: url } : undefined
  }

  // Scene → imageUrl from generatedResults or generatedImageUrl
  if (type === "scene") {
    const url =
      getActiveResultUrl(data) ??
      (data.generatedImageUrl as string | undefined)
    return url ? { imageUrl: url } : undefined
  }

  // Text-generating nodes
  if (type === "ai-writer" || type === "suno-lyrics") {
    const text = data.generatedText as string | undefined
    return text ? { text } : undefined
  }

  if (type === "combine-text") {
    const text = data.combinedText as string | undefined
    return text ? { text } : undefined
  }

  if (type === "split-text") {
    const results = (data.splitResults as string[] | undefined) ?? []
    return results.length > 0 ? { text: results[0], splitResults: results } : undefined
  }

  if (type === "transcribe" || type === "image-to-text") {
    const text =
      getActiveResultText(data) ??
      (data.generatedText as string | undefined)
    return text ? { text } : undefined
  }

  if (type === "forced-alignment") {
    const alignment = data.alignmentResults as unknown
    return alignment ? { alignment } : undefined
  }

  // Plan nodes
  if (type === "after-effects") {
    const plan = data.effectPlan as Record<string, unknown> | undefined
    return plan ? { plan } : undefined
  }
  if (type === "lottie-overlay") {
    const plan = data.overlayPlan as Record<string, unknown> | undefined
    return plan ? { plan } : undefined
  }
  if (type === "3d-title") {
    const plan = data.titlePlan as Record<string, unknown> | undefined
    return plan ? { plan } : undefined
  }
  if (type === "motion-graphics") {
    const plan = data.motionPlan as Record<string, unknown> | undefined
    return plan ? { plan } : undefined
  }
  if (type === "composite") {
    const plan = data.compositePlan as Record<string, unknown> | undefined
    return plan ? { plan } : undefined
  }
  if (type === "video-composer") {
    const plan = data.plan as Record<string, unknown> | undefined
    return plan ? { plan } : undefined
  }

  // Sub-workflow
  if (type === "sub-workflow") {
    const outputResults = data.outputResults as Record<string, string> | undefined
    if (!outputResults) return undefined
    const firstValue = Object.values(outputResults)[0]
    return firstValue ? { text: firstValue } : undefined
  }

  // Audio isolation → vocalUrl + instrumentalUrl
  if (type === "audio-isolation") {
    const vocalUrl = data.vocalUrl as string | undefined
    const instrumentalUrl = data.instrumentalUrl as string | undefined
    if (vocalUrl || instrumentalUrl) {
      return { vocalUrl, instrumentalUrl, audioUrl: vocalUrl }
    }
    return undefined
  }

  return undefined
}

/**
 * Build a NodeOutput from a completed job's output_data from the jobs table.
 */
export function buildNodeOutputFromJobData(
  outputData: Record<string, unknown>,
  _nodeType: string,
): NodeOutput {
  const output: NodeOutput = {}

  // Copy direct 1:1 fields
  for (const key of DIRECT_OUTPUT_KEYS) {
    if (outputData[key] != null) {
      ;(output as Record<string, unknown>)[key] = outputData[key]
    }
  }

  // Plan nodes store their plan under various keys
  for (const key of PLAN_OUTPUT_KEYS) {
    if (outputData[key]) {
      output.plan = outputData[key] as Record<string, unknown>
      break
    }
  }

  return output
}
