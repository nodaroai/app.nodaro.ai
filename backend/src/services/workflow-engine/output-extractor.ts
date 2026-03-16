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
  "listResults",
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
      const lines = items
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      if (lines.length === 0) return undefined
      // Always return first item; per-edge output mode routing is in input-resolver
      return { text: lines[0] }
    }

    case "loop": {
      const rows = data.rows as string[][] | undefined
      const firstVal = rows?.[0]?.[0]?.trim()
      return firstVal ? { text: firstVal } : undefined
    }

    case "webhook-trigger": {
      if (!triggerData) return undefined

      // Dynamic params: output keyed by param.id with values from triggerData[param.name]
      const params = data.params as Array<{ id: string; name: string; type: string }> | undefined
      if (params && params.length > 0) {
        const output: NodeOutput = {}
        const paramOutputs: Record<string, string> = {}
        for (const p of params) {
          const val = triggerData[p.name]
          if (val == null) continue
          const strVal = String(val)
          paramOutputs[p.id] = strVal
          // Also set top-level fields for getPrimaryOutput compatibility
          if (p.type === "text") output.text = strVal
          else if (p.type === "imageUrl") output.imageUrl = strVal
          else if (p.type === "videoUrl") output.videoUrl = strVal
          else if (p.type === "audioUrl") output.audioUrl = strVal
        }
        output.paramOutputs = paramOutputs
        return Object.keys(paramOutputs).length > 0 ? output : { text: JSON.stringify(triggerData) }
      }

      // Legacy fallback: hardcoded field extraction
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
 * Extract the full list of items from a list-producing source node.
 * Returns string[] if the node produces multiple items, undefined otherwise.
 * Used by the orchestrator to detect fan-out scenarios.
 */
export function extractSourceNodeOutputAsList(
  node: SimpleNode,
  triggerData?: Record<string, unknown>,
): string[] | undefined {
  const data = node.data
  const type = node.type

  switch (type) {
    case "list": {
      const items = (data.items as string | undefined) || ""
      const lines = items
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      return lines.length > 1 ? lines : undefined
    }

    case "loop": {
      // Loop node without upstream "in" connection: extract from manual rows
      const rows = data.rows as string[][] | undefined
      if (rows && rows.length > 1) {
        // Default to first column; column routing is handled by getListInputForNode
        const items = rows.map((row) => row[0]?.trim()).filter(Boolean)
        return items.length > 1 ? items : undefined
      }
      return undefined
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
  // Sub-workflow output routing by handle (matches frontend)
  if (sourceType === "sub-workflow") {
    const outputResults = output._outputResults
    if (sourceHandle && outputResults) {
      const portId = sourceHandle.replace(/^out_/, "")
      if (outputResults[portId]) return outputResults[portId]
    }
    return output.text || output.imageUrl || output.videoUrl || output.audioUrl
  }

  // Sub-workflow-input handle routing
  if (sourceType === "sub-workflow-input" && sourceHandle) {
    return output.text
  }

  // Plan nodes return a marker
  if (PLAN_NODE_TYPES.has(sourceType)) {
    return output.plan ? "plan-ready" : undefined
  }

  // Suno-separate: support stem routing via sourceHandle
  if (sourceType === "suno-separate" && sourceHandle) {
    if (sourceHandle === "vocal") return output.vocalUrl || output.audioUrl
    if (sourceHandle === "instrumental") return output.instrumentalUrl || output.audioUrl
  }

  // Voice-design: support voiceId routing via sourceHandle
  if (sourceType === "voice-design" && sourceHandle === "voiceId") {
    return output.generatedVoiceId
  }

  // Adjust-volume can output either audio or video
  if (sourceType === "adjust-volume") {
    return output.videoUrl || output.audioUrl
  }

  // Forced-alignment outputs alignment data, not text — serialize to match frontend
  if (sourceType === "forced-alignment") {
    if (output.alignment) return JSON.stringify(output.alignment)
    return output.text
  }

  // Generate-script: prefer text (first scene imagePrompt), fall back to script existence
  if (sourceType === "generate-script") {
    return output.text
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

interface ScriptScene {
  imagePrompt?: string
  [key: string]: unknown
}

interface ScriptData {
  scenes: ScriptScene[]
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

/** Extract the first scene's imagePrompt from script data (matches frontend extractNodeOutput). */
function getFirstSceneImagePrompt(data: Record<string, unknown>): { text?: string; script?: ScriptData } | undefined {
  const scriptResults = (data.generatedResults as Array<{ script?: ScriptData }> | undefined) ?? []
  const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
  const activeScript =
    scriptResults[activeIndex]?.script ??
    (data.generatedScript as ScriptData | undefined)
  if (!activeScript || !activeScript.scenes?.length) return undefined
  const text = activeScript.scenes[0].imagePrompt
  return text ? { text, script: activeScript } : { script: activeScript }
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
  "speech-to-video",
  "sora-storyboard",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  "suno-music-video",
  "render-video",
  "combine-videos",
  "merge-video-audio",
  "add-captions",
  "resize-video",
  "social-media-format",
  "trim-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "transcode-video",
  "manual-edit",
])

/** Audio-generating node types that store results in generatedAudioUrl / generatedResults.
 *  NOTE: suno-separate and voice-design are handled separately (they have extra output fields). */
const AUDIO_RESULT_TYPES = new Set([
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-convert-wav",
  "suno-upload-extend",
  "text-to-dialogue",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "audio-isolation",
  "trim-audio",
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

  // Scene → imageUrl from generatedResults or generatedImageUrl, with text fallback
  if (type === "scene") {
    const url =
      getActiveResultUrl(data) ??
      (data.generatedImageUrl as string | undefined)
    if (url) return { imageUrl: url }
    // Fall back to scene prompt text if no generated image (matches frontend buildScenePrompt)
    const sceneText = (data.description as string | undefined)?.trim() ||
      (data.prompt as string | undefined)?.trim()
    return sceneText ? { text: sceneText } : undefined
  }

  // Suno-separate → audioUrl + stem URLs (vocalUrl, instrumentalUrl)
  if (type === "suno-separate") {
    const url =
      getActiveResultUrl(data) ??
      (data.generatedAudioUrl as string | undefined)
    const output: NodeOutput = {}
    if (url) output.audioUrl = url
    const vocalUrl = data.vocalUrl as string | undefined
    const instrumentalUrl = data.instrumentalUrl as string | undefined
    if (vocalUrl) output.vocalUrl = vocalUrl
    if (instrumentalUrl) output.instrumentalUrl = instrumentalUrl
    return Object.keys(output).length > 0 ? output : undefined
  }

  // Voice-design → audioUrl + generatedVoiceId (dual output)
  if (type === "voice-design") {
    const url =
      getActiveResultUrl(data) ??
      (data.generatedAudioUrl as string | undefined)
    const voiceId = data.generatedVoiceId as string | undefined
    const output: NodeOutput = {}
    if (url) output.audioUrl = url
    if (voiceId) output.generatedVoiceId = voiceId
    return Object.keys(output).length > 0 ? output : undefined
  }

  // Generate-script → extract first scene imagePrompt as text (matches frontend)
  if (type === "generate-script") {
    const result = getFirstSceneImagePrompt(data)
    return result ? { text: result.text, script: result.script } : undefined
  }

  // Text-generating nodes
  if (type === "ai-writer" || type === "suno-lyrics" || type === "suno-style-boost") {
    const text = data.generatedText as string | undefined
    return text ? { text } : undefined
  }

  if (type === "combine-text") {
    const text = data.combinedText as string | undefined
    return text ? { text } : undefined
  }

  if (type === "preview") {
    // Preview node output is set by inline executor (passthrough)
    return undefined
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

  // Sub-workflow — support handle-based routing (matches frontend)
  if (type === "sub-workflow") {
    const outputResults = data.outputResults as Record<string, string> | undefined
    if (!outputResults) return undefined
    // Return all port values so getPrimaryOutput can route by handle
    const output: NodeOutput = {}
    const firstValue = Object.values(outputResults)[0]
    if (firstValue) output.text = firstValue
    // Store full outputResults for handle-based routing in getPrimaryOutput
    output._outputResults = outputResults
    return output
  }

  // Sub-workflow-input — return injected port values (matches frontend)
  if (type === "sub-workflow-input") {
    const injected = data.__injectedPortValues as Record<string, string> | undefined
    if (!injected) return undefined
    const firstValue = Object.values(injected)[0]
    return firstValue ? { text: firstValue } : undefined
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

  // Normalize generatedText -> text (image-to-text, ai-writer store output as generatedText)
  if (!output.text && outputData.generatedText) {
    output.text = outputData.generatedText as string
  }

  // Normalize suno-lyrics: worker stores { lyrics: [{text, title}, ...] }
  if (!output.text && outputData.lyrics) {
    const lyrics = outputData.lyrics
    if (Array.isArray(lyrics)) {
      const first = lyrics[0] as { text?: string } | undefined
      if (first?.text) output.text = first.text
    } else if (typeof lyrics === "string") {
      output.text = lyrics
    }
  }

  // Normalize generate-script: extract first scene imagePrompt as text (matches frontend)
  if (!output.text && output.script) {
    const scriptData = output.script as ScriptData
    if (scriptData.scenes?.[0]?.imagePrompt) {
      output.text = scriptData.scenes[0].imagePrompt
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
