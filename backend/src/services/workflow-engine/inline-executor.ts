/**
 * Inline executors for nodes that don't need a BullMQ job.
 * These run synchronously in the orchestrator process.
 */

import { ASPECT_RATIO_DIMENSIONS } from "../../../../packages/shared/src/model-constants.js"
import { resolveSeparator } from "../../../../packages/shared/src/text-separators.js"
import { evaluateJsonPath, stringifyPathResults } from "../../../../packages/shared/src/json-path.js"
import { evaluateJsonExpression, buildExpressionFromVisual, jsonResultToList, type JsonFilter } from "../../../../packages/shared/src/json-evaluator.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeOutput, NodeExecutionState, OrchestratorContext } from "./types.js"
import { getPrimaryOutput, extractSourceNodeOutput } from "./output-extractor.js"
import { isSourceNode, IMAGE_SOURCE_TYPES, VIDEO_SOURCE_TYPES, AUDIO_SOURCE_TYPES } from "./execution-graph.js"
import { supabase } from "../../lib/supabase.js"

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
  const separator = resolveSeparator(
    node.data.separator as string | undefined,
    node.data.customSeparator as string | undefined,
    { combineSpacing: true },
  )

  const texts = collectUpstreamTexts(node.id, edges, allNodes, nodeStates, true)
  // Trim each text part before combining (matches frontend logic)
  const trimmedTexts = texts.map((t) => t.trim()).filter((t) => t.length > 0)
  const combined = trimmedTexts.join(separator)
  return { text: combined, combinedText: combined }
}

/**
 * Execute split-text node: splits text by delimiter.
 * Default delimiter is "newline"; trimWhitespace and removeEmpty flags are respected.
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

  const text = inputText || resolvedInputs.prompt || (node.data.text as string) || ""
  const delimiter = resolveSeparator(
    (node.data.separator as string | undefined) ?? (node.data.delimiter as string | undefined),
    node.data.customSeparator as string | undefined,
  )
  const trimWhitespace = (node.data.trimWhitespace as boolean) !== false
  const removeEmpty = (node.data.removeEmpty as boolean) !== false

  let splitResults = delimiter ? text.split(delimiter) : [text]

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
 * Execute extract-field node: parse JSON from upstream, apply dot-path,
 * emit newline-joined list of values.
 *
 * Input source semantics:
 *   - `json` source: read state.output.json directly (no parse).
 *   - `text` source: JSON.parse; throw on invalid JSON.
 *
 * Values:
 *   - null/undefined → skipped
 *   - string → as-is
 *   - number/boolean → String(value)
 *   - object/array at leaf → JSON.stringify
 */
export function executeExtractField(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const path = ((node.data.field as string) ?? "").trim()

  const incoming = edges.find((e) => e.target === node.id)
  if (!incoming) {
    return { extractedText: "", text: "", listResults: [] }
  }
  const src = allNodes.find((n) => n.id === incoming.source)
  if (!src) {
    return { extractedText: "", text: "", listResults: [] }
  }
  const state = nodeStates[src.id]

  let value: unknown
  if (state?.output?.json !== undefined) {
    value = state.output.json
  } else {
    const text = state?.output?.text ?? extractSavedTextFallback(src)
    if (typeof text !== "string" || text.length === 0) {
      return { extractedText: "", text: "", listResults: [] }
    }
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error("Input is not valid JSON")
    }
  }

  const raw = evaluateJsonPath(value, path)
  const strings = stringifyPathResults(raw)
  const joined = strings.join("\n")
  const outputType = (node.data.outputType as string | undefined) ?? "text"
  return {
    extractedText: joined,
    text: joined,
    listResults: outputType === "list" ? strings : undefined,
    json: outputType === "json" ? raw : undefined,
  }
}

export function executeJsonProcess(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const data = node.data as Record<string, unknown>
  const mode = (data.mode as string) ?? "visual"

  const expression = mode === "advanced"
    ? ((data.expression as string) ?? ".")
    : buildExpressionFromVisual({
        inputPath: (data.inputPath as string) ?? "",
        filters: (data.filters as JsonFilter[]) ?? [],
        projections: (data.projections as string[]) ?? [],
      })

  const incoming = edges.find((e) => e.target === node.id)
  if (!incoming) return { text: "", processedResult: null, listResults: [] }

  const src = allNodes.find((n) => n.id === incoming.source)
  if (!src) return { text: "", processedResult: null, listResults: [] }

  const state = nodeStates[src.id]
  let input: unknown

  if (state?.output?.json !== undefined) {
    input = state.output.json
  } else {
    const text = state?.output?.text ?? extractSavedTextFallback(src)
    if (typeof text !== "string" || text.length === 0) {
      return { text: "", processedResult: null, listResults: [] }
    }
    try {
      input = JSON.parse(text)
    } catch {
      input = text
    }
  }

  const result = evaluateJsonExpression(input, expression)
  if (!result.ok) throw new Error(result.error)

  const processedResult = result.value
  const listResults = jsonResultToList(processedResult)

  return { text: listResults[0] ?? "", processedResult, listResults }
}

/** Cheap fallback for source nodes that stash text on data. */
function extractSavedTextFallback(src: SimpleNode): string | undefined {
  const data = src.data as Record<string, unknown>
  const candidates = [data.text, data.generatedText, data.combinedText]
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c
  }
  return undefined
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
export const IMAGE_URL_RE = /^https?:\/\/.*\.(png|jpe?g|gif|webp|svg|bmp)/i
export const VIDEO_URL_RE = /^https?:\/\/.*\.(mp4|mov|webm|avi|mkv)/i
export const AUDIO_URL_RE = /^https?:\/\/.*\.(mp3|wav|ogg|aac|flac|m4a)/i

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
 * Execute teleport-send or teleport-receive node: pass through the upstream value unchanged.
 * The teleporter acts as a transparent wire — it forwards whatever media type it receives.
 */
export function executeTeleporterPassthrough(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
): NodeOutput {
  const value = resolvedInputs.prompt || resolvedInputs.imageUrl || resolvedInputs.videoUrl || resolvedInputs.audioUrl || ""
  return { text: value }
}

/**
 * Execute router node: route upstream data to active output handles.
 * Radio mode: exactly one active. Checkbox mode: any combination.
 */
export function executeRouter(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const routes = (node.data.routes as Array<{ id: string; name: string; active: boolean }>) ?? []

  // Resolve upstream input (passthrough)
  const incomingEdges = edges.filter((e) => e.target === node.id)
  let inputValue: string | undefined
  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const state = nodeStates[srcNode.id]
    if (state?.output) {
      const val = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
      if (val) { inputValue = val; break }
    } else if (isSourceNode(srcNode.type)) {
      const srcOutput = extractSourceNodeOutput(srcNode)
      if (srcOutput) {
        const val = getPrimaryOutput(srcOutput, srcNode.type, edge.sourceHandle)
        if (val) { inputValue = val; break }
      }
    }
  }

  const activeRoutes = routes.filter((r) => r.active).map((r) => r.id)
  const routeOutputs: Record<string, string | undefined> = {}
  for (const route of routes) {
    routeOutputs[route.id] = route.active ? (inputValue ?? "gate") : undefined
  }

  return {
    text: activeRoutes.length > 0 ? "routed" : undefined,
    activeRoutes,
    routeOutputs,
  }
}

/**
 * Execute webhook-output node: collect upstream outputs and POST to configured URL.
 *
 * Creates a `jobs` row with `status: completed|failed` and captures
 * statusCode + responseBody in `output_data`, matching the single-node route
 * (`/v1/webhook-output/send`). Without this, orchestrated runs left no audit
 * trail for webhook deliveries.
 */
export async function executeWebhookOutput(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  ctx?: OrchestratorContext,
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

  // Create audit job row upfront when we have ctx (orchestrator run); direct
  // unit-test callers may omit ctx and skip the DB round-trip.
  let jobId: string | undefined
  if (ctx?.userId) {
    const { data: job } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        workflow_execution_id: ctx.executionId,
        user_id: ctx.userId,
        status: "pending",
        provider: "webhook-output",
        input_data: { url, payload, type: "webhook-output" },
      })
      .select("id")
      .single()
    jobId = job?.id
    if (jobId) ctx.onJobCreated?.(node.id, jobId)
  }

  let statusCode = 0
  let responseBody = ""
  let success = false
  let errorMessage: string | undefined

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    statusCode = response.status
    responseBody = (await response.text().catch(() => "")).slice(0, 2000)
    success = response.ok
    if (!response.ok) {
      errorMessage = `Webhook POST failed (${statusCode}): ${responseBody.slice(0, 200)}`
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Webhook POST failed"
  }

  if (jobId) {
    await supabase
      .from("jobs")
      .update({
        status: success ? "completed" : "failed",
        error_message: success ? null : errorMessage,
        output_data: { success, statusCode, responseBody },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
  }

  if (!success) {
    // Throw so the orchestrator marks the node as failed and short-circuits.
    throw new Error(errorMessage ?? `Webhook POST failed (${statusCode})`)
  }

  return {
    text: "sent",
    webhookSuccess: true,
    webhookStatusCode: statusCode,
    webhookResponseBody: responseBody,
  }
}
