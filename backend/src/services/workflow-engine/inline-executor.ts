/**
 * Inline executors for nodes that don't need a BullMQ job.
 * These run synchronously in the orchestrator process.
 */

import { ASPECT_RATIO_DIMENSIONS } from "../../../../packages/shared/src/model-constants.js"
import { resolveSeparator } from "../../../../packages/shared/src/text-separators.js"
import { evaluateJsonPath, stringifyPathResults } from "../../../../packages/shared/src/json-path.js"
import { evaluateJsonExpression, buildExpressionFromVisual, jsonResultToList, type JsonFilter } from "../../../../packages/shared/src/json-evaluator.js"
import {
  tryParseJson,
  evaluateCondition,
  evaluateConditionGroup,
  resolveConditionValue,
  type FilterListCondition,
  type RouterConditionGroup,
} from "../../../../packages/shared/src/filter-condition.js"
import { sortListItems, type SortType, type SortDirection } from "../../../../packages/shared/src/list-sort.js"
import { spreadJsonArrayIfSingleton } from "../../../../packages/shared/src/generated-results.js"
import { zipMergeLists } from "../../../../packages/shared/src/list-merge.js"
import { resolveSourceThroughConnectedList } from "../../../../packages/shared/src/list-source-resolver.js"
import { buildConditionVariables, VARIABLES_HANDLE_ID } from "../../../../packages/shared/src/condition-variables.js"

// Re-export for tests and downstream consumers.
export type { FilterListCondition }
import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeOutput, NodeExecutionState, OrchestratorContext } from "./types.js"
import { getPrimaryOutput, extractSourceNodeOutput } from "./output-extractor.js"
import { getNodeOutput } from "./input-resolver.js"
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
 * Input source precedence:
 *   1. `output.json` — already-structured input (web-scrape). Arrays auto-iterate.
 *   2. `output.listResults` — list-producing upstream (filter-list, deduplicate,
 *      merge-lists, split-text). Every item is parsed individually so the path
 *      evaluates across the WHOLE list, not just `listResults[0]`. Without this
 *      branch Extract Field would silently read only the first item and produce
 *      inconsistent counts whenever upstream order shifted.
 *   3. `output.text` (or saved fallback) — scalar text parsed as JSON.
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

  const rawIncoming = edges.find((e) => e.target === node.id)
  if (!rawIncoming) {
    return { extractedText: "", text: "", listResults: [] }
  }
  const incoming = resolveSourceThroughConnectedList(rawIncoming, allNodes, edges)
  const src = allNodes.find((n) => n.id === incoming.source)
  if (!src) {
    return { extractedText: "", text: "", listResults: [] }
  }
  const state = nodeStates[src.id]

  let value: unknown
  if (state?.output?.json !== undefined) {
    value = state.output.json
  } else if (state?.output?.listResults && state.output.listResults.length > 0) {
    // Treat the list as a structured array input. Parse each item so object
    // paths like "url" or "authorMeta.name" resolve per-element; non-JSON
    // strings pass through as-is (whole-item mode with empty path still works).
    const spread = spreadJsonArrayIfSingleton(state.output.listResults)
    value = spread.map((item) => tryParseJson(item))
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

  const rawIncoming = edges.find((e) => e.target === node.id)
  if (!rawIncoming) return { text: "", processedResult: null, listResults: [] }
  const incoming = resolveSourceThroughConnectedList(rawIncoming, allNodes, edges)

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

// ---------------------------------------------------------------------------
// List-processing inline nodes: filter-list, deduplicate, merge-lists
// ---------------------------------------------------------------------------

/**
 * Collect list items from every upstream edge. For each incoming connection,
 * in priority order:
 *   1. `output.listResults` — include every element (already split by the
 *      producer, e.g. extract-field in "list" mode, split-text).
 *   2. `output.json` — structured JSON. Arrays are spread so each element
 *      becomes its own filter-list item (critical for web-scrape, whose
 *      output is `{ json: [{post}, {post}, …] }`); objects and primitives
 *      are pushed as a single stringified item.
 *   3. `getPrimaryOutput` — fallback to the node's primary text/URL output.
 *
 * Edges pointing at a connected-mode list are transparently re-routed to the
 * list's upstream via `resolveSourceThroughConnectedList`.
 */
function collectItemsForEdge(
  edge: SimpleEdge,
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  allEdges: SimpleEdge[],
): string[] {
  if (edge.targetHandle === VARIABLES_HANDLE_ID) return []
  const resolvedEdge = resolveSourceThroughConnectedList(edge, allNodes, allEdges)
  const srcNode = allNodes.find((n) => n.id === resolvedEdge.source)
  if (!srcNode) return []

  let output = nodeStates[srcNode.id]?.output
  if (!output && isSourceNode(srcNode.type)) {
    output = extractSourceNodeOutput(srcNode)
  }
  if (!output) return []

  const items: string[] = []
  const listResults = output.listResults
  if (listResults && listResults.length > 0) {
    for (const item of listResults) {
      if (item != null) items.push(item)
    }
    return items
  }

  // Structured JSON arrays (web-scrape's `generatedJson`, any future source
  // that emits `{ json: [...] }`) need to be spread so each element becomes
  // its own filter-list item. Otherwise getPrimaryOutput would collapse the
  // whole array into a single stringified blob and per-item conditions
  // couldn't match. Explicit `json: null` means "no items" — we must not
  // fall through or getPrimaryOutput would surface the literal "null".
  if (output.json !== undefined) {
    const json = output.json
    if (json !== null) {
      if (Array.isArray(json)) {
        for (const element of json) {
          if (element === undefined || element === null) continue
          items.push(typeof element === "string" ? element : JSON.stringify(element))
        }
      } else if (typeof json === "object") {
        items.push(JSON.stringify(json))
      } else {
        items.push(String(json))
      }
    }
    return items
  }

  const primary = getPrimaryOutput(output, srcNode.type, resolvedEdge.sourceHandle)
  if (primary != null && primary !== "") items.push(primary)
  return items
}

function collectUpstreamListItems(
  nodeId: string,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): string[] {
  const incomingEdges = edges.filter((e) => e.target === nodeId)
  const items: string[] = []
  for (const edge of incomingEdges) {
    items.push(...collectItemsForEdge(edge, allNodes, nodeStates, edges))
  }
  return spreadJsonArrayIfSingleton(items)
}

/**
 * Per-edge variant: returns one inner list per incoming edge. Used by the
 * merge-lists "zip" mode, which needs to align items across sources rather
 * than flatten them.
 */
function collectUpstreamListsPerEdge(
  nodeId: string,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): string[][] {
  const incomingEdges = edges.filter((e) => e.target === nodeId)
  return incomingEdges.map((edge) =>
    spreadJsonArrayIfSingleton(collectItemsForEdge(edge, allNodes, nodeStates, edges)),
  )
}

function stringifyListKey(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

/**
 * Execute filter-list node: filter an upstream list using AND/OR-joined
 * field/operator/value conditions. Operates on stringified or JSON items;
 * string items are parsed when a field path is supplied.
 */
export function executeFilterList(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  triggerData?: Record<string, unknown>,
): NodeOutput {
  const data = node.data as Record<string, unknown>
  const conditions = (data.conditions as FilterListCondition[] | undefined) ?? []
  const logic = ((data.conditionLogic as string) ?? "AND").toUpperCase() === "OR" ? "OR" : "AND"

  const items = collectUpstreamListItems(node.id, edges, allNodes, nodeStates)

  const effectiveConditions = conditions.filter((c) => c && c.operator)
  const variables = buildConditionVariables(node.id, edges, allNodes, (n) =>
    getNodeOutput(n, undefined, nodeStates),
  )
  // Condition values depend only on the node config + triggerData + variables
  // — all constant across list items. Hoist the substitution so we don't
  // re-run resolveNodeRefs / {{token}} passes N times per execution.
  const resolvedConditions = effectiveConditions.map((c) => ({
    ...c,
    value: resolveConditionValue(c.value ?? "", c.valueType, triggerData, variables),
  }))
  const opts = { caseSensitive: data.caseSensitive as boolean | undefined }
  const filtered = resolvedConditions.length === 0
    ? items
    : items.filter((item) => {
      const parsed = tryParseJson(item)
      const results = resolvedConditions.map((c) => evaluateCondition(parsed, item, c, undefined, opts))
      return logic === "OR" ? results.some(Boolean) : results.every(Boolean)
    })

  return { text: filtered[0] ?? "", listResults: filtered }
}

/**
 * Execute deduplicate node: remove duplicates from an upstream list,
 * keeping the first occurrence. Uniqueness is computed from the item
 * (via the optional dot-path field) stringified.
 */
export function executeDeduplicateList(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const path = ((node.data.field as string | undefined) ?? "").trim()
  const items = collectUpstreamListItems(node.id, edges, allNodes, nodeStates)

  const seen = new Set<string>()
  const deduped: string[] = []

  for (const item of items) {
    let key: string
    if (path === "") {
      key = item
    } else {
      const parsed = tryParseJson(item)
      const matches = evaluateJsonPath(parsed, path)
      key = stringifyListKey(matches.length > 0 ? matches[0] : undefined)
    }
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  return { text: deduped[0] ?? "", listResults: deduped }
}

/**
 * Execute merge-lists node.
 *
 * Concat mode (default): append all upstream items in edge order. Optional
 * deduplicate flag removes duplicate items by stringified value.
 *
 * Zip mode: element-wise merge with modulo-wrap. For two lists of objects
 * the result has `max(len)` items where position i is the object-spread of
 * each source at index `i % srcLen`. A single-item upstream (e.g. one JSON
 * object) is thus injected into every element of a longer list. Deduplicate
 * still applies to the zipped output.
 */
export function executeMergeLists(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const mode = (node.data.mode as string | undefined) === "zip" ? "zip" : "concat"
  const shouldDedupe = node.data.deduplicate === true

  const items = mode === "zip"
    ? zipMergeLists(collectUpstreamListsPerEdge(node.id, edges, allNodes, nodeStates))
    : collectUpstreamListItems(node.id, edges, allNodes, nodeStates)

  if (!shouldDedupe) {
    return { text: items[0] ?? "", listResults: items }
  }

  const seen = new Set<string>()
  const merged: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    merged.push(item)
  }
  return { text: merged[0] ?? "", listResults: merged }
}

/**
 * Execute sort-list node: sort items from the upstream list by an optional
 * dot-path field, with Auto/Text/Number/Date comparison and asc/desc
 * direction. Missing/invalid values always appear last regardless of
 * direction.
 */
export function executeSortList(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const data = node.data as Record<string, unknown>
  const items = collectUpstreamListItems(node.id, edges, allNodes, nodeStates)
  const sorted = sortListItems(items, {
    field: typeof data.field === "string" ? data.field : "",
    sortType: (data.sortType as SortType) ?? "auto",
    direction: (data.direction as SortDirection) ?? "asc",
  })
  return { text: sorted[0] ?? "", listResults: sorted }
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
  sourceHandle?: string,
): "image" | "video" | "audio" | "data" | "text" {
  if (nodeType === "voice-design" && sourceHandle === "voiceId") return "text"
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
    const itemType = detectPreviewItemType(srcType, trimmed, edge.sourceHandle ?? undefined)

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
 * - Radio: exactly one active (user-toggled).
 * - Checkbox: any combination (user-toggled).
 * - Conditional: active set is the deduped union of routeIds from every
 *   condition group whose AND/OR conditions match the upstream input.
 *   `triggerData` (when provided) resolves `trigger.*` tokens inside rules.
 */
export function executeRouter(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  triggerData?: Record<string, unknown>,
): NodeOutput {
  const data = node.data as Record<string, unknown>
  const mode = (data.mode as string) ?? "radio"
  const routes = (data.routes as Array<{ id: string; name: string; active: boolean }>) ?? []

  const inputValue = resolveRouterInputValue(node.id, edges, allNodes, nodeStates)

  let activeRouteIds: string[]
  if (mode === "conditional") {
    const groups = (data.conditionGroups as RouterConditionGroup[] | undefined) ?? []
    if (groups.length === 0) {
      activeRouteIds = []
    } else {
      const parsed = tryParseJson(inputValue ?? "")
      const raw = inputValue ?? ""
      const variables = buildConditionVariables(node.id, edges, allNodes, (n) =>
        getNodeOutput(n, undefined, nodeStates),
      )
      const opts = { variables }
      const union = new Set<string>()
      for (const group of groups) {
        if (!group?.routeIds?.length) continue
        const logic = group.conditionLogic === "OR" ? "OR" : "AND"
        if (evaluateConditionGroup(parsed, raw, group.conditions ?? [], logic, triggerData, opts)) {
          for (const id of group.routeIds) union.add(id)
        }
      }
      activeRouteIds = routes.filter((r) => union.has(r.id)).map((r) => r.id)
    }
  } else {
    activeRouteIds = routes.filter((r) => r.active).map((r) => r.id)
  }

  const routeOutputs: Record<string, string | undefined> = {}
  for (const route of routes) {
    routeOutputs[route.id] = activeRouteIds.includes(route.id) ? (inputValue ?? "gate") : undefined
  }

  return {
    text: activeRouteIds.length > 0 ? "routed" : undefined,
    activeRoutes: activeRouteIds,
    routeOutputs,
  }
}

function resolveRouterInputValue(
  nodeId: string,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): string | undefined {
  const incomingEdges = edges.filter((e) => e.target === nodeId && e.targetHandle !== VARIABLES_HANDLE_ID)
  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const state = nodeStates[srcNode.id]
    if (state?.output) {
      const val = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
      if (val) return val
    } else if (isSourceNode(srcNode.type)) {
      const srcOutput = extractSourceNodeOutput(srcNode)
      if (srcOutput) {
        const val = getPrimaryOutput(srcOutput, srcNode.type, edge.sourceHandle)
        if (val) return val
      }
    }
  }
  return undefined
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
