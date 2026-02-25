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

    case "schedule-trigger":
      return { text: new Date().toISOString() }

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
