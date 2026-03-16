/**
 * Inline executors for nodes that don't need a BullMQ job.
 * These run synchronously in the orchestrator process.
 */

import { ASPECT_RATIO_DIMENSIONS } from "../../../../packages/shared/src/model-constants.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeOutput, NodeExecutionState } from "./types.js"
import { getPrimaryOutput, extractSourceNodeOutput } from "./output-extractor.js"
import { isSourceNode, IMAGE_SOURCE_TYPES, VIDEO_SOURCE_TYPES, AUDIO_SOURCE_TYPES } from "./execution-graph.js"

/**
 * Map separator enum values to actual separator strings (matches frontend logic).
 */
const SEPARATOR_MAP: Record<string, string> = {
  newline: "\n",
  "double-newline": "\n\n",
  comma: ", ",
  space: " ",
}

/**
 * Collect text outputs from all upstream nodes connected to a target node.
 * Shared by executeCombineText and executeSplitText.
 *
 * @param includeListResults If true, expand listResults from fan-out nodes into individual items.
 */
function collectUpstreamTexts(
  nodeId: string,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  includeListResults: boolean,
): string[] {
  const incomingEdges = edges.filter((e) => e.target === nodeId)
  const texts: string[] = []

  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const state = nodeStates[srcNode.id]
    if (state?.output) {
      if (includeListResults) {
        const listResults = state.output.listResults
        if (listResults && listResults.length > 0) {
          for (const item of listResults) {
            if (item?.trim()) texts.push(item.trim())
          }
          continue
        }
      }
      const text = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
      if (text) texts.push(text)
    } else if (isSourceNode(srcNode.type)) {
      const srcOutput = extractSourceNodeOutput(srcNode)
      if (srcOutput) {
        const text = getPrimaryOutput(srcOutput, srcNode.type, edge.sourceHandle)
        if (text) texts.push(text)
      }
    }
  }

  return texts
}

/**
 * Execute combine-text node: joins upstream text outputs with a separator.
 */
export function executeCombineText(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const rawSeparator = (node.data.separator as string) ?? "newline"
  // Map enum values to actual strings; if "custom", use customSeparator; otherwise
  // check if it's a known enum or already a literal separator string
  let separator: string
  if (rawSeparator === "custom") {
    separator = (node.data.customSeparator as string) ?? ""
  } else if (rawSeparator in SEPARATOR_MAP) {
    separator = SEPARATOR_MAP[rawSeparator]
  } else {
    separator = rawSeparator
  }

  // Use includeListResults: true to match frontend behavior — frontend combine-text
  // expands __listResults from fan-out nodes into individual text parts before joining
  const texts = collectUpstreamTexts(node.id, edges, allNodes, nodeStates, true)
  // Trim each text part before combining (matches frontend logic)
  const trimmedTexts = texts.map((t) => t.trim()).filter((t) => t.length > 0)
  const combined = trimmedTexts.join(separator)
  return { text: combined, combinedText: combined }
}

/**
 * Execute split-text node: splits text by delimiter.
 * Matches frontend defaults: delimiter defaults to "===NEXT===",
 * trimWhitespace and removeEmpty flags are respected.
 */
export function executeSplitText(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const upstreamTexts = collectUpstreamTexts(node.id, edges, allNodes, nodeStates, false)
  const inputText = upstreamTexts.join("")

  // Fall back to resolved prompt or node data
  const text = inputText || resolvedInputs.prompt || (node.data.text as string) || ""
  const delimiter = (node.data.separator as string) || (node.data.delimiter as string) || "===NEXT==="
  const trimWhitespace = (node.data.trimWhitespace as boolean) !== false
  const removeEmpty = (node.data.removeEmpty as boolean) !== false

  let splitResults = text.split(delimiter)

  if (trimWhitespace) {
    splitResults = splitResults.map((s) => s.trim())
  }
  if (removeEmpty) {
    splitResults = splitResults.filter((s) => s.length > 0)
  }

  return {
    text: splitResults[0] || "",
    splitResults,
    listResults: splitResults,
  }
}

/**
 * Execute composite node: build composite plan from layer config + upstream video URLs.
 * The composite plan is sent to the render queue by the render-video node downstream.
 *
 * Matches frontend logic: layers are matched by inputHandle (targetHandle on edge),
 * not by array index. This ensures consistent layer ordering between frontend DAG
 * and backend orchestrator execution.
 */
export function executeComposite(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const data = node.data
  const layout = (data.layout as string) ?? "custom"
  const fps = (data.fps as number) ?? 30

  const aspectRatio = data.aspectRatio as string | undefined
  const dims = aspectRatio ? ASPECT_RATIO_DIMENSIONS[aspectRatio] : undefined
  const width = dims?.width ?? (data.width as number) ?? 1920
  const height = dims?.height ?? (data.height as number) ?? 1080

  // Collect incoming video URLs keyed by targetHandle (matches frontend logic)
  const incomingEdges = edges.filter((e) => e.target === node.id)
  const handleVideoMap = new Map<string, string>()

  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const state = nodeStates[srcNode.id]
    if (!state?.output) continue
    const url = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
    if (!url) continue
    // Skip "plan-ready" sentinel values (matches frontend logic)
    if (url === "plan-ready") continue
    const handle = edge.targetHandle ?? `video${handleVideoMap.size + 1}`
    handleVideoMap.set(handle, url)
  }

  // Build layer config map keyed by inputHandle (same as frontend)
  const layerConfigs = (data.layers as Array<Record<string, unknown>>) ?? []
  const existingLayerMap = new Map(
    layerConfigs.map((l, i) => [(l.inputHandle as string) || `__unkeyed_${i}`, l]),
  )

  const layers: Array<Record<string, unknown>> = []

  for (const [handle, videoUrl] of handleVideoMap) {
    const existing = existingLayerMap.get(handle)
    if (existing) {
      layers.push({
        id: existing.id ?? `layer-${handle}`,
        sourceVideo: videoUrl,
        position: existing.position ?? "fullscreen",
        x: (existing.x as number) ?? 0,
        y: (existing.y as number) ?? 0,
        width: (existing.width as number) ?? 100,
        height: (existing.height as number) ?? 100,
        startFrame: (existing.startFrame as number) ?? 0,
        durationInFrames: existing.durationInFrames,
        opacity: (existing.opacity as number) ?? 1,
        blendMode: existing.blendMode ?? "normal",
        zIndex: (existing.zIndex as number) ?? layers.length,
      })
    } else {
      layers.push({
        id: `layer-${handle}`,
        sourceVideo: videoUrl,
        position: "fullscreen",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        startFrame: 0,
        opacity: 1,
        blendMode: "normal",
        zIndex: layers.length,
      })
    }
  }

  // Sort layers by zIndex (matches frontend logic)
  layers.sort((a, b) => ((a.zIndex as number) ?? 0) - ((b.zIndex as number) ?? 0))

  // Compute durationInFrames: prefer explicit durationSeconds (matches frontend logic)
  const durationSeconds = data.durationSeconds as number | undefined
  let maxDurationInFrames = durationSeconds ? Math.round(durationSeconds * fps) : 0

  // Fallback: infer from longest layer
  if (maxDurationInFrames === 0) {
    for (const layer of layers) {
      const layerDur = (layer.durationInFrames as number) ?? 0
      const layerStart = (layer.startFrame as number) ?? 0
      if (layerDur > 0) {
        maxDurationInFrames = Math.max(maxDurationInFrames, layerStart + layerDur)
      }
    }
  }
  // Final fallback: 10 seconds at configured fps
  if (maxDurationInFrames === 0) {
    maxDurationInFrames = fps * 10
  }

  const compositePlan = {
    planType: "composite",
    layout,
    width,
    height,
    fps,
    durationInFrames: maxDurationInFrames,
    backgroundColor: (data.backgroundColor as string) ?? "#000000",
    layers,
  }

  return { plan: compositePlan }
}

// URL-based media type detection (matches frontend regex patterns)
const IMAGE_URL_RE = /^https?:\/\/.*\.(png|jpe?g|gif|webp|svg|bmp)/i
const VIDEO_URL_RE = /^https?:\/\/.*\.(mp4|mov|webm|avi|mkv)/i
const AUDIO_URL_RE = /^https?:\/\/.*\.(mp3|wav|ogg|aac|flac|m4a)/i

/**
 * Detect preview item type from source node type and value (matches frontend detectPreviewItemType).
 */
function detectPreviewItemType(
  nodeType: string,
  value?: string,
): "image" | "video" | "audio" | "data" | "text" {
  if (IMAGE_SOURCE_TYPES.has(nodeType)) return "image"
  if (VIDEO_SOURCE_TYPES.has(nodeType)) return "video"
  if (AUDIO_SOURCE_TYPES.has(nodeType)) return "audio"
  if (nodeType === "forced-alignment") return "data"
  if (value) {
    if (IMAGE_URL_RE.test(value)) return "image"
    if (VIDEO_URL_RE.test(value)) return "video"
    if (AUDIO_URL_RE.test(value)) return "audio"
  }
  return "text"
}

/**
 * Execute preview node: collect ALL upstream outputs with types (matches frontend rich preview).
 */
export function executePreview(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const incomingEdges = edges.filter((e) => e.target === node.id)
  const previewItems: Array<{
    type: "image" | "video" | "audio" | "data" | "text"
    value: string
    sourceNodeId: string
    sourceNodeLabel: string
  }> = []

  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const state = nodeStates[srcNode.id]
    if (!state?.output) continue
    const value = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
    const trimmed = value?.trim()
    if (!trimmed) continue

    const srcType = srcNode.type ?? ""
    const srcLabel = (srcNode.data.label as string) || srcType
    const itemType = detectPreviewItemType(srcType, trimmed)

    previewItems.push({
      type: itemType,
      value: trimmed,
      sourceNodeId: srcNode.id,
      sourceNodeLabel: srcLabel,
    })
  }

  // Also set text to first value for backwards compatibility
  const firstValue = previewItems.length > 0 ? previewItems[0].value : undefined
  return { text: firstValue, previewItems }
}

/**
 * Execute webhook-output node: collect upstream outputs and POST to configured URL.
 */
export async function executeWebhookOutput(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): Promise<NodeOutput> {
  const url = (node.data.url as string)?.trim()
  if (!url) {
    throw new Error("No webhook URL configured")
  }

  const params = (node.data.params as Array<{ id: string; name: string; type: string }>) ?? []
  const incomingEdges = edges.filter((e) => e.target === node.id)

  const payload: Record<string, unknown> = {}

  if (params.length > 0) {
    // Param-based: match each param to its connected edge by targetHandle
    for (const param of params) {
      const edge = incomingEdges.find((e) => e.targetHandle === param.id)
      if (!edge) continue
      const srcNode = allNodes.find((n) => n.id === edge.source)
      if (!srcNode) continue

      let value: string | undefined
      const state = nodeStates[srcNode.id]
      if (state?.output) {
        value = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
      } else if (isSourceNode(srcNode.type)) {
        const srcOutput = extractSourceNodeOutput(srcNode)
        if (srcOutput) value = getPrimaryOutput(srcOutput, srcNode.type, edge.sourceHandle)
      }
      if (value) payload[param.name] = value
    }
  } else {
    // No params — collect all upstream data
    for (const edge of incomingEdges) {
      const srcNode = allNodes.find((n) => n.id === edge.source)
      if (!srcNode) continue
      const state = nodeStates[srcNode.id]
      if (!state?.output) continue
      const value = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
      if (value) payload[srcNode.type] = value
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Webhook POST failed (${response.status}): ${body.slice(0, 200)}`)
  }

  return { text: "sent" }
}
