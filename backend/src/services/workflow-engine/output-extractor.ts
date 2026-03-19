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
import { COMPOSER_PLAN_MAP } from "../../../../packages/shared/src/model-constants.js"
import { buildScenePrompt } from "../../../../packages/shared/src/prompt-builder.js"
import type { SceneData } from "../../../../packages/shared/src/types.js"

// Node types that output a plan (not a media URL) — derived from COMPOSER_PLAN_MAP
const PLAN_NODE_TYPES = new Set(Object.keys(COMPOSER_PLAN_MAP))

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
  "approved",
  "reason",
  "score",
  "characterId",
]

// Job output_data keys that all map to NodeOutput.plan — derived from COMPOSER_PLAN_MAP + generic "plan"
const PLAN_OUTPUT_KEYS = [
  ...new Set(Object.values(COMPOSER_PLAN_MAP).map((m) => m.planField)),
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
      // Prefer user-configured text (matches frontend), fall back to trigger timestamp
      const scheduleText = (data.text as string | undefined)?.trim()
      if (scheduleText) return { text: scheduleText }
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
 * Extract all output values from a node's accumulated generatedResults.
 * Returns undefined if fewer than 2 results (no fan-out benefit).
 * Mirrors frontend extractAllGeneratedResults().
 */
export function extractAllGeneratedResults(
  data: Record<string, unknown>,
): string[] | undefined {
  const results = data.generatedResults as
    | Array<{ url?: string; text?: string }>
    | undefined
  if (!results || results.length <= 1) return undefined
  const outputs = results
    .map((r) => r.url || r.text || "")
    .filter((v) => v.length > 0)
  return outputs.length > 1 ? outputs : undefined
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
    // Fall back to visible output port (matches frontend routeSnapshot.visibleOutputPortId)
    if (outputResults) {
      const visiblePortId = output._visibleOutputPortId
      if (visiblePortId && outputResults[visiblePortId]) return outputResults[visiblePortId]
      // Fall back to first result value
      const firstValue = Object.values(outputResults)[0]
      if (firstValue) return firstValue
    }
    return output.text || output.imageUrl || output.videoUrl || output.audioUrl
  }

  // Sub-workflow-input handle routing (matches frontend: look up specific port value)
  if (sourceType === "sub-workflow-input") {
    if (sourceHandle && output._injectedPortValues) {
      const val = output._injectedPortValues[sourceHandle]
      if (val) return val
    }
    // Fall back to first value
    if (output._injectedPortValues) {
      const firstValue = Object.values(output._injectedPortValues)[0]
      if (firstValue) return firstValue
    }
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

  // QA-check: route by approved/rejected handle
  if (sourceType === "qa-check" && sourceHandle) {
    if (sourceHandle === "approved" && output.approved) return output.reason
    if (sourceHandle === "rejected" && !output.approved) return output.reason
    return undefined
  }

  // Adjust-volume can output either audio or video — respect lastInputType (matches frontend)
  if (sourceType === "adjust-volume") {
    if (output._lastInputType === "video") return output.videoUrl || output.audioUrl
    return output.audioUrl || output.videoUrl
  }

  // Social-media-format: prefer video, fall back to image (matches frontend)
  if (sourceType === "social-media-format") {
    return output.videoUrl || output.imageUrl
  }

  // Preview node: route by the actual media type of the first item (matches frontend)
  if (sourceType === "preview") {
    return output.imageUrl || output.videoUrl || output.audioUrl || output.text
  }

  // Forced-alignment outputs alignment data, not text — serialize to match frontend
  if (sourceType === "forced-alignment") {
    if (output.alignment) return JSON.stringify(output.alignment)
    return output.text
  }

  // Sora-character outputs a characterId string (data, not media)
  if (sourceType === "sora-character") {
    return output.characterId || output.text
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
    if (url) return { videoUrl: url }
    // social-media-format can also produce images (matches frontend fallback)
    if (type === "social-media-format") {
      const imageUrl = data.generatedImageUrl as string | undefined
      if (imageUrl) return { imageUrl }
    }
    return undefined
  }

  // Audio-generating nodes → audioUrl from generatedResults or generatedAudioUrl
  if (AUDIO_RESULT_TYPES.has(type)) {
    const url =
      getActiveResultUrl(data) ??
      (data.generatedAudioUrl as string | undefined)
    return url ? { audioUrl: url } : undefined
  }

  // Adjust-volume → could be audio or video; carry _lastInputType for getPrimaryOutput routing
  if (type === "adjust-volume") {
    const lastInputType = (data.lastInputType as string | undefined) ?? "audio"
    const url =
      getActiveResultUrl(data) ??
      (lastInputType === "video"
        ? (data.generatedVideoUrl as string | undefined)
        : (data.generatedAudioUrl as string | undefined))
    if (lastInputType === "video") {
      return url ? { videoUrl: url, _lastInputType: "video" } : undefined
    }
    return url ? { audioUrl: url, _lastInputType: "audio" } : undefined
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
    // Fall back to buildScenePrompt (shared with frontend) — without character
    // definitions the character names will default to "a figure", but all other
    // scene fields (shot type, camera angle, locations, mood, etc.) are preserved.
    try {
      const sceneText = buildScenePrompt(data as unknown as SceneData, [])
      return sceneText ? { text: sceneText } : undefined
    } catch {
      // If data doesn't match SceneData shape, fall back to raw fields
      const summary = (data.summary as string | undefined)?.trim()
      const prompt = (data.prompt as string | undefined)?.trim()
      return (summary || prompt) ? { text: (summary ?? prompt)! } : undefined
    }
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

  // Sora-character → characterId from savedCharacterId node data field
  if (type === "sora-character") {
    const characterId = data.savedCharacterId as string | undefined
    return characterId ? { characterId } : undefined
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
    // Check previewItems for saved output (matches frontend: first visible item's value)
    const items = (data.previewItems as Array<{ type: string; value: string; visible: boolean }> | undefined) ?? []
    const first = items.find((item) => item.visible !== false)
    if (first?.value) {
      // Route by media type so downstream nodes receive correctly-typed output
      if (first.type === "image") return { imageUrl: first.value }
      if (first.type === "video") return { videoUrl: first.value }
      if (first.type === "audio") return { audioUrl: first.value }
      return { text: first.value }
    }
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

  // Plan nodes — use COMPOSER_PLAN_MAP to find the correct data field
  const composerMapping = COMPOSER_PLAN_MAP[type]
  if (composerMapping) {
    let plan = data[composerMapping.planField] as Record<string, unknown> | undefined
    // video-composer: frontend stores in data.plan, legacy in data.sceneGraph
    if (!plan && type === "video-composer") {
      plan = (data.plan as Record<string, unknown> | undefined) ??
        (data.sceneGraph as Record<string, unknown> | undefined)
    }
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
    // Store visibleOutputPortId for fallback routing (matches frontend routeSnapshot)
    const routeSnapshot = data.routeSnapshot as Record<string, unknown> | undefined
    const visiblePortId = routeSnapshot?.visibleOutputPortId as string | undefined
    if (visiblePortId) output._visibleOutputPortId = visiblePortId
    return output
  }

  // Sub-workflow-input — return all injected port values for handle-based routing (matches frontend)
  if (type === "sub-workflow-input") {
    const injected = data.__injectedPortValues as Record<string, string> | undefined
    if (!injected) return undefined
    const output: NodeOutput = {}
    const firstValue = Object.values(injected)[0]
    if (firstValue) output.text = firstValue
    // Store full injected values so getPrimaryOutput can route by sourceHandle
    output._injectedPortValues = injected
    return output
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
