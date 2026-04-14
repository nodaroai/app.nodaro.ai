/**
 * Input resolver — wires upstream node outputs into downstream node inputs.
 * Backend equivalent of frontend resolveNodeInputs().
 * Stateless function with no React/Zustand dependencies.
 */

import type {
  SimpleNode,
  SimpleEdge,
  NodeExecutionState,
  ResolvedInputs,
} from "./types.js"
import { extractSourceNodeOutput, extractSourceNodeOutputAsList, extractSavedNodeOutput, extractAllGeneratedResults, getPrimaryOutput } from "./output-extractor.js"
import { isSourceNode } from "./execution-graph.js"
import { buildNodeRefMap } from "./payload-builder.js"
import { IMAGE_URL_RE, VIDEO_URL_RE, AUDIO_URL_RE } from "./inline-executor.js"
import { resolveNodeRefs } from "../../../../packages/shared/src/node-refs.js"
import { resolveIndex, selectListItems, type SelectorFields } from "../../../../packages/shared/src/edge-range.js"
import { splitByLoopDelimiter } from "../../../../packages/shared/src/loop-delimiter.js"

/**
 * Resolve a node's primary output from execution state or source node data.
 * Shared helper — deduplicates the check-state-then-source pattern used in
 * resolveNodeInputs, getListInputForNode, and loop column routing.
 */
function getNodeOutput(
  node: SimpleNode,
  sourceHandle: string | null | undefined,
  nodeStates: Record<string, NodeExecutionState>,
  triggerData?: Record<string, unknown>,
): string | undefined {
  const state = nodeStates[node.id]
  if (state?.output) {
    return getPrimaryOutput(state.output, node.type, sourceHandle)
  }
  if (isSourceNode(node.type)) {
    const srcOutput = extractSourceNodeOutput(node, triggerData)
    if (srcOutput) return getPrimaryOutput(srcOutput, node.type, sourceHandle)
  }
  return undefined
}

/**
 * Resolve all inputs for a target node from its upstream connected nodes.
 */
export function resolveNodeInputs(
  targetNode: SimpleNode,
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
  allNodes: SimpleNode[],
  triggerData?: Record<string, unknown>,
  listIterationIndex?: number,
): ResolvedInputs {
  const incomingEdges = edges.filter((e) => e.target === targetNode.id)
  const inputs: ResolvedInputs = {}

  for (const edge of incomingEdges) {
    let sourceNode = allNodes.find((n) => n.id === edge.source)
    if (!sourceNode) continue

    // Teleport transparency: resolve through the chain to the original source
    if (sourceNode.type === "teleport-send" || sourceNode.type === "teleport-receive") {
      let current = sourceNode
      const visited = new Set<string>()
      while ((current.type === "teleport-send" || current.type === "teleport-receive") && !visited.has(current.id)) {
        visited.add(current.id)
        const inEdge = edges.find((e) => e.target === current.id)
        if (!inEdge) break
        const upstream = allNodes.find((n) => n.id === inEdge.source)
        if (!upstream) break
        current = upstream
      }
      sourceNode = current
    }

    // Get output from node state or source node data
    let output: string | undefined
    const state = nodeStates[sourceNode.id]

    const edgeData = edge.data as Record<string, unknown> | undefined
    const edgeOutputMode = edgeData?.outputMode as string | undefined
    const effectiveListResults = state?.output?.listResults
      ?? extractAllGeneratedResults(sourceNode.data as Record<string, unknown>)
    if (edgeOutputMode && effectiveListResults && effectiveListResults.length > 0) {
      if (edgeOutputMode === "item") {
        // Structured item mode: use resolveIndex on itemIndex expression
        const itemIndex = edgeData?.itemIndex as string | undefined
        const idx = resolveIndex(itemIndex ?? "1", effectiveListResults.length)
        output = effectiveListResults[idx] ?? effectiveListResults[0]
      } else if (edgeOutputMode.startsWith("item:")) {
        // Legacy item:N mode (0-based index baked into mode string)
        const idx = parseInt(edgeOutputMode.split(":")[1], 10)
        output = effectiveListResults[idx] ?? effectiveListResults[0]
      } else if (edgeOutputMode === "last") {
        // "last" = "Selected" in the UI — leave output undefined so we fall
        // through to getNodeOutput below, which reads state.output (this run's
        // latest execution) or activeResultIndex (the result the user picked
        // via the carousel on the frontend). This is DIFFERENT from the word
        // "last" inside range/list expressions, where it means the final
        // array index.
      } else if (edgeOutputMode === "all") {
        const filtered = selectListItems(
          effectiveListResults,
          edgeData as SelectorFields | undefined,
        )
        // For array-accumulating targets, route each item individually
        if (ARRAY_ACCUMULATING_TYPES.has(targetNode.type)) {
          for (const item of filtered) {
            if (item) routeOutput(inputs, sourceNode, targetNode, item, edge, edges, allNodes, nodeStates)
          }
          continue
        }
        output = filtered.join(", ")
      } else if (edgeOutputMode === "each" && listIterationIndex !== undefined) {
        const filtered = selectListItems(
          effectiveListResults,
          edgeData as SelectorFields | undefined,
        )
        if (filtered.length > 0) {
          output = filtered[listIterationIndex] ?? filtered[filtered.length - 1]
        }
      }
    }

    // During fan-out: "each" mode edges from list sources should advance per iteration
    if (!output && listIterationIndex != null && effectiveListResults && effectiveListResults.length > 0) {
      const effectiveMode = edgeOutputMode ?? (DEFAULT_EACH_TYPES.has(sourceNode.type) ? "each" : "last")
      if (effectiveMode === "each") {
        const filtered = selectListItems(
          effectiveListResults,
          edgeData as SelectorFields | undefined,
        )
        output = filtered[listIterationIndex]
      }
    }

    if (!output) {
      // Loop node column routing: resolve correct column value by sourceHandle (matches frontend)
      if (sourceNode.type === "loop" && edge.sourceHandle) {
        const columns = sourceNode.data.columns as Array<{ id: string; handleId: string; type?: string; splitDelimiter?: string; connectedSourceId?: string; connectedSourceHandle?: string }> | undefined
        const colIndex = (columns ?? []).findIndex((c) => c.handleId === edge.sourceHandle)
        if (colIndex >= 0) {
          const col = columns![colIndex]

          // Per-column connected source: find edge targeting this column's input handle
          const colInEdge = edges.find(
            (e) => e.target === sourceNode.id && e.targetHandle === `${col.handleId}_in`,
          )
          if (colInEdge) {
            const upstreamNode = allNodes.find((n) => n.id === colInEdge.source)
            if (upstreamNode) {
              const upstreamText = getNodeOutput(upstreamNode, colInEdge.sourceHandle, nodeStates, triggerData)
              if (upstreamText) {
                const lines = splitByLoopDelimiter(upstreamText, columns)
                if (listIterationIndex != null) {
                  const filtered = selectListItems(
                    lines,
                    edgeData as SelectorFields | undefined,
                  )
                  output = filtered[listIterationIndex]
                } else {
                  output = lines[0]
                }
              }
            }
          }

          // Fallback: check global "in" handle (connected mode)
          if (!output) {
            const loopInEdges = edges.filter((e) => e.target === sourceNode.id && e.targetHandle === "in")
            if (loopInEdges.length > 0) {
              const upstreamNode = allNodes.find((n) => n.id === loopInEdges[0].source)
              if (upstreamNode) {
                const upstreamText = getNodeOutput(upstreamNode, loopInEdges[0].sourceHandle, nodeStates, triggerData)
                if (upstreamText) {
                  const lines = splitByLoopDelimiter(upstreamText, columns)
                  if (listIterationIndex != null) {
                    const filtered = selectListItems(
                      lines,
                      edgeData as SelectorFields | undefined,
                    )
                    output = filtered[listIterationIndex]
                  } else {
                    output = lines[0]
                  }
                }
              }
            }
          }

          // Fallback: manual mode — get correct column value for current iteration
          if (!output) {
            const rows = sourceNode.data.rows as string[][] | undefined
            if (listIterationIndex != null) {
              const items = (rows ?? []).map((row) => row[colIndex]?.trim()).filter(Boolean) as string[]
              const filtered = selectListItems(
                items,
                edgeData as SelectorFields | undefined,
              )
              output = filtered[listIterationIndex]
            } else {
              output = rows?.[0]?.[colIndex]?.trim()
            }
          }
        }
      }

      if (!output) {
        output = getNodeOutput(sourceNode, edge.sourceHandle, nodeStates, triggerData)
      }
    }

    if (!output) continue

    // Route the output to the correct input field based on source type + target node type
    routeOutput(inputs, sourceNode, targetNode, output, edge, edges, allNodes, nodeStates)
  }

  // --- Post-processing: selectedNodeId fallbacks (matches frontend) ---
  // The frontend supports dropdown-selected node IDs as a fallback for finding
  // inputs when no edge is wired. Replicate that here so backend execution
  // produces the same results.
  resolveSelectedNodeFallbacks(targetNode, inputs, allNodes, nodeStates, triggerData)

  return inputs
}

// ---------------------------------------------------------------------------
// Selected-node-ID fallback resolution (matches frontend execute-node.ts)
// ---------------------------------------------------------------------------

/** Mapping from selectedNodeId data field → ResolvedInputs field, per node type. */
const SELECTED_NODE_FALLBACKS: Record<string, Array<{ dataField: string; inputField: keyof ResolvedInputs; guard?: (inputs: ResolvedInputs) => boolean }>> = {
  "image-to-video": [
    { dataField: "selectedStartFrameNodeId", inputField: "imageUrl", guard: (i) => !i.startFrameUrl && !i.imageUrl },
    { dataField: "selectedEndFrameNodeId", inputField: "endFrameUrl" },
    { dataField: "selectedAudioNodeId", inputField: "audioUrl" },
  ],
  "lip-sync": [
    { dataField: "selectedImageNodeId", inputField: "imageUrl" },
    { dataField: "selectedVideoNodeId", inputField: "videoUrl" },
    { dataField: "selectedAudioNodeId", inputField: "audioUrl" },
  ],
  "speech-to-video": [
    { dataField: "selectedImageNodeId", inputField: "imageUrl" },
    { dataField: "selectedAudioNodeId", inputField: "audioUrl" },
  ],
}

/**
 * For nodes with dropdown-selected source node IDs, resolve fallbacks when
 * no edge provides the input. Matches frontend execute-node.ts behavior.
 */
function resolveSelectedNodeFallbacks(
  targetNode: SimpleNode,
  inputs: ResolvedInputs,
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  triggerData?: Record<string, unknown>,
): void {
  const mappings = SELECTED_NODE_FALLBACKS[targetNode.type]
  if (!mappings) return

  for (const { dataField, inputField, guard } of mappings) {
    // Skip if the input is already resolved (custom guard or simple truthy check)
    if (guard ? !guard(inputs) : inputs[inputField]) continue
    const selectedId = targetNode.data[dataField] as string | undefined
    if (!selectedId) continue
    const node = allNodes.find((n) => n.id === selectedId)
    if (!node) continue
    // Reuse getNodeOutput, with saved-data fallback for previously-executed nodes
    const url = getNodeOutput(node, undefined, nodeStates, triggerData)
      ?? getSavedNodeOutput(node)
    if (url) (inputs as Record<string, unknown>)[inputField] = url
  }
}

/** Extract primary output from a node's saved data (for non-re-executed nodes). */
function getSavedNodeOutput(node: SimpleNode): string | undefined {
  const saved = extractSavedNodeOutput(node)
  return saved ? getPrimaryOutput(saved, node.type, undefined) : undefined
}

// ---------------------------------------------------------------------------
// Fan-out detection — check if a node has list input from upstream
// ---------------------------------------------------------------------------

/** Node types whose edges default to "each" output mode (fan-out). */
const DEFAULT_EACH_TYPES = new Set(["list", "loop", "split-text"])

/**
 * Check if a node receives list input from any upstream source.
 * Returns the list items (string[]) if a fan-out source is found, undefined otherwise.
 * Mirrors frontend getListInputForNode() logic.
 */
export function getListInputForNode(
  targetNode: SimpleNode,
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
  allNodes: SimpleNode[],
  triggerData?: Record<string, unknown>,
): string[] | undefined {
  const incomingEdges = edges.filter((e) => e.target === targetNode.id)

  for (const edge of incomingEdges) {
    const sourceNode = allNodes.find((n) => n.id === edge.source)
    if (!sourceNode) continue

    // Read range config from the edge
    const edgeData = edge.data as Record<string, unknown> | undefined
    const selectorArg = edgeData as SelectorFields | undefined

    // 1. Loop node — column routing via sourceHandle
    if (sourceNode.type === "loop") {
      const columns = sourceNode.data.columns as
        | Array<{ id: string; handleId: string; type?: string; splitDelimiter?: string; connectedSourceId?: string; connectedSourceHandle?: string }>
        | undefined
      const colIndex = (columns ?? []).findIndex(
        (c) => c.handleId === edge.sourceHandle,
      )

      // Per-column connected source: find edge targeting this column's input handle
      if (colIndex >= 0) {
        const col = columns![colIndex]
        const colInEdge = edges.find(
          (e) => e.target === sourceNode.id && e.targetHandle === `${col.handleId}_in`,
        )
        if (colInEdge) {
          const upstreamNode = allNodes.find((n) => n.id === colInEdge.source)
          if (upstreamNode) {
            const upstreamText = getNodeOutput(upstreamNode, colInEdge.sourceHandle, nodeStates, triggerData)
            if (upstreamText) {
              const items = splitByLoopDelimiter(upstreamText, columns)
              const filtered = selectListItems(items, selectorArg)
              if (filtered.length > 1) return filtered
            }
          }
        }
      }

      // Fallback: check global "in" handle (connected mode)
      const loopInEdges = edges.filter(
        (e) => e.target === sourceNode.id && e.targetHandle === "in",
      )
      if (loopInEdges.length > 0) {
        const upstreamEdge = loopInEdges[0]
        const upstreamNode = allNodes.find((n) => n.id === upstreamEdge.source)
        if (upstreamNode) {
          const upstreamText = getNodeOutput(upstreamNode, upstreamEdge.sourceHandle, nodeStates, triggerData)
          if (upstreamText) {
            const items = splitByLoopDelimiter(upstreamText, columns)
            const filtered = selectListItems(items, selectorArg)
            if (filtered.length > 1) return filtered
          }
        }
      } else if (colIndex >= 0) {
        // Manual mode: extract column values from rows
        const rows = sourceNode.data.rows as string[][] | undefined
        if (rows) {
          const items = rows
            .map((row) => row[colIndex]?.trim())
            .filter(Boolean) as string[]
          const filtered = selectListItems(items, selectorArg)
          if (filtered.length > 1) return filtered
        }
      }
      continue
    }

    // generate-script "images" handle fan-out — each scene imagePrompt becomes one item
    if (sourceNode.type === "generate-script" && edge.sourceHandle === "images") {
      const script = getActiveScriptFromState(nodeStates, edge.source)
      const scenesList = (script?.scenes as Array<Record<string, unknown>>) ?? []
      if (scenesList.length > 1) {
        const items = scenesList.map((s) => (s.imagePrompt as string) ?? "")
        return selectListItems(items, selectorArg)
      }
    }

    // Check outputMode from edge data — only fan-out if mode is "each"
    // List/loop/split-text edges default to "each"; all other edges default to "last"
    const edgeOutputMode = edgeData?.outputMode as string | undefined
    const outputMode = edgeOutputMode ?? (DEFAULT_EACH_TYPES.has(sourceNode.type) ? "each" : "last")
    if (outputMode !== "each") continue

    // 2. List node — parse items by newline
    if (sourceNode.type === "list") {
      const items = extractSourceNodeOutputAsList(sourceNode, triggerData)
      if (items && items.length > 1) {
        const filtered = selectListItems(items, selectorArg)
        if (filtered.length > 1) return filtered
      }
      continue
    }

    // 3. Split-text node — read splitResults from completed state
    if (sourceNode.type === "split-text") {
      const state = nodeStates[sourceNode.id]
      if (state?.output?.splitResults && state.output.splitResults.length > 1) {
        const filtered = selectListItems(state.output.splitResults, selectorArg)
        if (filtered.length > 1) return filtered
      }
      continue
    }

    // 4. Any node with listResults from a prior fan-out execution
    const state = nodeStates[sourceNode.id]
    if (state?.output?.listResults && state.output.listResults.length > 1) {
      const filtered = selectListItems(state.output.listResults, selectorArg)
      if (filtered.length > 1) return filtered
    }

    // 5. Fallback: accumulated generatedResults from multiple manual runs
    const savedResults = extractAllGeneratedResults(
      sourceNode.data as Record<string, unknown>,
    )
    if (savedResults) {
      const filtered = selectListItems(savedResults, selectorArg)
      if (filtered.length > 1) return filtered
    }
  }

  // Transitive fan-out: if a direct parent is a text-prompt whose own upstream
  // is a list-like node with "each" mode, resolve the text template per item.
  for (const edge of incomingEdges) {
    const sourceNode = allNodes.find((n) => n.id === edge.source)
    if (!sourceNode || sourceNode.type !== "text-prompt") continue

    const sourceIncoming = edges.filter((e) => e.target === sourceNode.id)
    for (const srcEdge of sourceIncoming) {
      const listNode = allNodes.find((n) => n.id === srcEdge.source)
      if (!listNode || !DEFAULT_EACH_TYPES.has(listNode.type)) continue

      const gpEdgeMode = (srcEdge.data as Record<string, unknown> | undefined)
        ?.outputMode as string | undefined
      if ((gpEdgeMode ?? "each") !== "each") continue

      // Read range config from the upstream edge
      const gpData = srcEdge.data as Record<string, unknown> | undefined

      // Get list items
      let listItems: string[] | undefined
      if (listNode.type === "list") {
        listItems = extractSourceNodeOutputAsList(listNode, triggerData)
      } else if (listNode.type === "split-text") {
        const st = nodeStates[listNode.id]
        if (st?.output?.splitResults && st.output.splitResults.length > 1) {
          listItems = st.output.splitResults
        }
      }
      if (!listItems || listItems.length <= 1) continue

      // Apply range/list selection from the upstream edge
      const filtered = selectListItems(
        listItems,
        gpData as SelectorFields | undefined,
      )
      if (filtered.length <= 1) continue

      // Build ref map for the text-prompt to resolve nested refs
      const refMap = buildNodeRefMap(sourceNode.id, {
        nodes: allNodes,
        edges,
        nodeStates,
      })
      const listLabel = (listNode.data.label as string) || listNode.type || listNode.id
      const sourceText = (sourceNode.data.text as string) || ""

      const resolvedItems: string[] = []
      for (const item of filtered) {
        const itemMap = new Map(refMap)
        itemMap.set(listLabel, item)
        resolvedItems.push(resolveNodeRefs(sourceText, itemMap))
      }
      if (resolvedItems.length > 1) return resolvedItems
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Routing helpers — reduce repetition for audio/video target routing
// ---------------------------------------------------------------------------

/** Route an audio output to the correct input field based on target node type. */
function routeAudioOutput(
  inputs: ResolvedInputs,
  output: string,
  targetType: string,
  sourceNodeId: string,
): void {
  if (targetType === "mix-audio" || targetType === "combine-audio") {
    inputs.audioUrls = [...(inputs.audioUrls ?? []), output]
    inputs.audioUrlsWithSourceIds = [...(inputs.audioUrlsWithSourceIds ?? []), { nodeId: sourceNodeId, url: output }]
  } else if (targetType === "merge-video-audio") {
    inputs.audioSources = [
      ...(inputs.audioSources ?? []),
      { url: output, sourceNodeId },
    ]
  } else if (targetType === "suno-mashup") {
    // suno-mashup needs 2 audio URLs — first goes to audioUrl, second to audioUrl2
    if (!inputs.audioUrl) {
      inputs.audioUrl = output
    } else {
      inputs.audioUrl2 = output
    }
  } else {
    inputs.audioUrl = output
  }
}

/** Route a video output to the correct input field based on target node type. */
function routeVideoOutput(
  inputs: ResolvedInputs,
  output: string,
  targetType: string,
  sourceNodeId: string,
): void {
  if (targetType === "combine-videos") {
    inputs.videoUrls = [...(inputs.videoUrls ?? []), output]
    inputs.videoUrlsWithSourceIds = [...(inputs.videoUrlsWithSourceIds ?? []), { nodeId: sourceNodeId, url: output }]
  } else if (targetType === "merge-video-audio") {
    if (!inputs.videoUrl) {
      inputs.videoUrl = output
    } else {
      inputs.audioSources = [
        ...(inputs.audioSources ?? []),
        { url: output, sourceNodeId, sourceType: "video" as const },
      ]
    }
  } else {
    inputs.videoUrl = output
  }
}

// ---------------------------------------------------------------------------
// Media type sets for source type classification
// ---------------------------------------------------------------------------

const TEXT_SOURCE_NODE_TYPES = new Set([
  "text-prompt",
  "list",
  "loop",
  "transcribe",
  "suno-lyrics",
  "image-to-text",
  "ai-writer",
  "llm-chat",
  "combine-text",
  "split-text",
  "suno-style-boost",
  "forced-alignment",
  "qa-check",
])

// Preview routes by actual media type, not always to text (handled in routeOutput)
// Social-media-format may produce images (handled in routeOutput)

/** Target node types that accumulate inputs into arrays (videoUrls, audioUrls). */
const ARRAY_ACCUMULATING_TYPES = new Set(["combine-videos", "mix-audio", "combine-audio"])

const REFERENCE_HANDLE_MAP: Record<string, "referenceImageUrls" | "referenceVideoUrls" | "referenceAudioUrls"> = {
  "references": "referenceImageUrls",
  "reference-images": "referenceImageUrls",
  "reference-videos": "referenceVideoUrls",
  "reference-audio": "referenceAudioUrls",
}

const ENTITY_NODE_TYPES = new Set(["character", "face", "object", "location"])

const VIDEO_OUTPUT_NODE_TYPES = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "lip-sync",
  "speech-to-video",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  "suno-music-video",
  "combine-videos",
  "merge-video-audio",
  "add-captions",
  "resize-video",
  "social-media-format",
  "trim-video",
  "render-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "transcode-video",
  "manual-edit",
])

const AUDIO_OUTPUT_NODE_TYPES = new Set([
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "audio-isolation",
  "text-to-dialogue",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-separate",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-convert-wav",
  "suno-upload-extend",
  "trim-audio",
  "mix-audio",
  "combine-audio",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "voice-design",
])

const SOCIAL_POST_NODE_TYPES = new Set([
  "instagram-post", "tiktok-post", "youtube-upload",
  "linkedin-post", "x-post", "facebook-post", "telegram-post",
])

const SUNO_TRACK_NODE_TYPES = new Set([
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-convert-wav",
  "suno-upload-extend",
])

// ---------------------------------------------------------------------------
// Generate-script helpers
// ---------------------------------------------------------------------------

function getActiveScriptFromState(nodeStates: Record<string, NodeExecutionState>, nodeId: string): Record<string, unknown> | undefined {
  const state = nodeStates[nodeId]
  return state?.output?.script as Record<string, unknown> | undefined
}

function deduplicateCharacters(scenes: Array<Record<string, unknown>>): Array<{ name: string; description: string; mood?: string; action?: string; position?: string }> {
  const seen = new Map<string, { name: string; description: string; mood?: string; action?: string; position?: string }>()
  for (const scene of scenes) {
    const chars = scene.characters as Array<string | Record<string, unknown>> | undefined
    if (!chars) continue
    for (const c of chars) {
      if (typeof c === "string") {
        const key = c.toLowerCase()
        if (!seen.has(key)) seen.set(key, { name: c, description: "" })
      } else {
        const name = (c.name as string) ?? ""
        const key = name.toLowerCase()
        if (!seen.has(key)) seen.set(key, { name, description: (c.description as string) ?? "", mood: (c.mood as string) ?? undefined, action: (c.action as string) ?? undefined, position: (c.position as string) ?? undefined })
      }
    }
  }
  return Array.from(seen.values())
}

function deduplicateLocations(scenes: Array<Record<string, unknown>>): Array<{ name: string; description: string; timeOfDay: string; weather?: string; lighting?: string }> {
  const seen = new Map<string, { name: string; description: string; timeOfDay: string; weather?: string; lighting?: string }>()
  for (const scene of scenes) {
    const loc = scene.location as Record<string, unknown> | undefined
    if (!loc) continue
    const name = (loc.name as string) ?? ""
    const key = name.toLowerCase()
    if (!seen.has(key)) seen.set(key, { name, description: (loc.description as string) ?? "", timeOfDay: (loc.timeOfDay as string) ?? "", weather: (loc.weather as string) ?? undefined, lighting: (loc.lighting as string) ?? undefined })
  }
  return Array.from(seen.values())
}

// ---------------------------------------------------------------------------
// Main routing function
// ---------------------------------------------------------------------------

function routeOutput(
  inputs: ResolvedInputs,
  src: SimpleNode,
  target: SimpleNode,
  output: string,
  edge: SimpleEdge,
  allEdges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): void {
  const srcType = src.type
  const targetType = target.type

  // Component-specific target routing — route by handle ID, not media type.
  if (target.type === "component" && edge.targetHandle?.startsWith("in_")) {
    const handleId = edge.targetHandle.replace(/^in_/, "")
    if (!inputs.componentInputMap) inputs.componentInputMap = {}
    inputs.componentInputMap[handleId] = output
    return
  }

  // --- Handle-specific routing takes priority for named input slots ---
  // These MUST be checked before source-type routing, otherwise source-type
  // handlers (e.g., generate-image → imageUrl) return early and these are
  // never reached.
  if (edge.targetHandle === "startFrame") {
    inputs.startFrameUrl = output
    return
  }
  if (edge.targetHandle === "endFrame") {
    inputs.endFrameUrl = output
    return
  }
  if (edge.targetHandle === "audio") {
    routeAudioOutput(inputs, output, targetType, src.id)
    return
  }
  if (edge.targetHandle === "mask") {
    inputs.maskUrl = output
    return
  }
  const refHandleKey = REFERENCE_HANDLE_MAP[edge.targetHandle ?? ""]
  if (refHandleKey) {
    inputs[refHandleKey] = [...((inputs[refHandleKey] as string[] | undefined) ?? []), output]
    return
  }
  if (edge.targetHandle === "system-prompt") {
    inputs.systemPrompt = output
    return
  }

  // --- List node output mode routing (reads mode from edge data) ---
  if (srcType === "list") {
    const edgeMode = (edge.data as Record<string, unknown> | undefined)?.outputMode as string | undefined
    const outputMode = edgeMode ?? "each" // list edges default to "each"
    const items = ((src.data.items as string | undefined) || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (outputMode === "all") {
      inputs.prompt = items.join(", ") || output
    } else if (outputMode === "last") {
      // List sources have no user-selection concept, so "Selected" falls back
      // to the final row. This overlaps with the other meaning of "last" — the
      // final index in a range/list expression — but only because lists don't
      // support the Selected semantic that generic nodes use.
      inputs.prompt = items[items.length - 1] || output
    } else if (outputMode.startsWith("item:")) {
      const idx = parseInt(outputMode.split(":")[1], 10)
      inputs.prompt = items[idx] ?? items[0] ?? output
    } else {
      // "each" mode — output first item; fan-out handled separately
      inputs.prompt = output
    }
    return
  }

  // --- Preview node: route by actual item type (matches frontend) ---
  if (srcType === "preview") {
    const state = nodeStates[src.id]
    const previewItems = state?.output?.previewItems
    if (previewItems && previewItems.length > 0) {
      const first = previewItems.find((item) => item.value)
      if (first) {
        if (first.type === "image") {
          inputs.imageUrl = output
          return
        }
        if (first.type === "video") {
          routeVideoOutput(inputs, output, targetType, src.id)
          return
        }
        if (first.type === "audio") {
          routeAudioOutput(inputs, output, targetType, src.id)
          return
        }
      }
    }
    // Fallback: treat as prompt (default behavior)
    inputs.prompt = output
    return
  }

  // --- Generate-script: handle-based routing ---
  if (srcType === "generate-script") {
    const handle = edge.sourceHandle
    const script = getActiveScriptFromState(nodeStates, src.id)
    const scenes = (script?.scenes as Array<Record<string, unknown>>) ?? []

    if (handle === "images" && scenes.length > 0) {
      // Pass generated image URLs as referenceImageUrls
      const imageUrls: string[] = []
      for (const s of scenes) {
        const genImages = s.generatedImages as Array<{ url: string }> | undefined
        const activeIdx = (s.activeImageIndex as number | undefined) ?? 0
        const url = genImages?.[activeIdx]?.url
        if (url) imageUrls.push(url)
      }
      if (imageUrls.length > 0) {
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), ...imageUrls]
      }
      // Also pass imagePrompts as text for generate-image list mode
      inputs.prompt = scenes.map((s) => (s.imagePrompt as string) ?? "").join("\n")
    } else if (handle === "dialogue") {
      const lines: Array<{ speaker: string; text: string; emotion?: string }> = []
      for (const s of scenes) {
        const dlg = s.dialogue as Array<Record<string, unknown>> | undefined
        if (dlg) {
          for (const d of dlg) {
            lines.push({
              speaker: (d.speaker as string) ?? "",
              text: (d.text as string) ?? "",
              emotion: (d.emotion as string) ?? undefined,
            })
          }
        }
      }
      if (lines.length > 0) inputs.dialogueLines = lines
    } else if (handle === "music") {
      const moods = new Set<string>()
      for (const s of scenes) {
        const m = s.musicMood as string | undefined
        if (m?.trim()) moods.add(m.trim())
      }
      if (moods.size > 0) inputs.prompt = Array.from(moods).join(", ")
    } else if (handle === "sfx") {
      const effects: string[] = []
      for (const s of scenes) {
        const fx = s.soundEffects as string[] | undefined
        if (fx) effects.push(...fx)
      }
      if (effects.length > 0) inputs.prompt = effects.join(", ")
    } else if (handle === "characters") {
      const chars = deduplicateCharacters(scenes)
      if (chars.length > 0) inputs.scriptCharacters = chars
    } else if (handle === "locations") {
      const locs = deduplicateLocations(scenes)
      if (locs.length > 0) inputs.scriptLocations = locs
    } else {
      inputs.prompt = output
    }
    return
  }

  // --- Router passthrough — detect media type from the resolved output value ---
  if (srcType === "router") {
    if (!output || output === "gate") {
      inputs.prompt = ""
      return
    }
    if (IMAGE_URL_RE.test(output)) {
      inputs.imageUrl = output
    } else if (VIDEO_URL_RE.test(output)) {
      routeVideoOutput(inputs, output, targetType, src.id)
    } else if (AUDIO_URL_RE.test(output)) {
      routeAudioOutput(inputs, output, targetType, src.id)
    } else {
      inputs.prompt = output
    }
    return
  }

  // --- Text/prompt sources ---
  if (TEXT_SOURCE_NODE_TYPES.has(srcType)) {
    inputs.prompt = output
    return
  }

  // --- Upload image ---
  if (srcType === "upload-image") {
    if (targetType === "generate-image") {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    } else {
      inputs.imageUrl = output
    }
    return
  }

  // --- Entity nodes → reference images (or imageUrl for lip-sync) ---
  if (ENTITY_NODE_TYPES.has(srcType)) {
    if (targetType === "lip-sync" || targetType === "speech-to-video") {
      inputs.imageUrl = output
    } else {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    }
    return
  }

  // --- Upload video / YouTube ---
  if (srcType === "upload-video" || srcType === "youtube-video") {
    if (targetType === "suno-cover" && srcType === "youtube-video") {
      const audioUrl = (src.data.downloadedAudioUrl as string | undefined)?.trim()
      inputs.uploadUrl = audioUrl || output
    } else {
      routeVideoOutput(inputs, output, targetType, src.id)
    }
    return
  }

  // --- Generate image → depends on target ---
  if (srcType === "generate-image") {
    if (targetType === "generate-image") {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    } else if (targetType === "text-to-audio") {
      inputs.prompt = (src.data.prompt as string) ?? ""
    } else {
      inputs.imageUrl = output
    }
    return
  }

  // --- Extract frame → image output (like generate-image) ---
  if (srcType === "extract-frame") {
    if (
      targetType === "generate-image" ||
      targetType === "edit-image" ||
      targetType === "image-to-image" ||
      targetType === "modify-image"
    ) {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    } else {
      inputs.imageUrl = output
    }
    return
  }

  // --- Edit/I2I/Modify/Upscale/RemoveBG image → reference for image nodes, imageUrl for others ---
  if (srcType === "edit-image" || srcType === "image-to-image" || srcType === "modify-image" || srcType === "upscale-image" || srcType === "remove-background") {
    if (
      targetType === "generate-image" ||
      targetType === "edit-image" ||
      targetType === "image-to-image" ||
      targetType === "modify-image"
    ) {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    } else {
      inputs.imageUrl = output
    }
    return
  }

  // --- Video output nodes ---
  if (VIDEO_OUTPUT_NODE_TYPES.has(srcType)) {
    routeVideoOutput(inputs, output, targetType, src.id)

    // Pass through kieTaskId for VEO/Runway extend and upscale nodes
    if (targetType === "extend-video" || targetType === "video-upscale") {
      const state = nodeStates[src.id]
      if (state?.output?.kieTaskId) {
        inputs.kieTaskId = state.output.kieTaskId
      } else if (src.data.kieTaskId) {
        // Fallback to node data for skipped/frozen nodes (matches frontend)
        inputs.kieTaskId = src.data.kieTaskId as string
      }
    }
    return
  }

  // --- Reference audio ---
  if (srcType === "reference-audio") {
    routeAudioOutput(inputs, output, targetType, src.id)
    return
  }

  // --- Upload audio ---
  if (srcType === "upload-audio") {
    routeAudioOutput(inputs, output, targetType, src.id)
    return
  }

  // --- Adjust volume → could be audio or video ---
  if (srcType === "adjust-volume") {
    const lastInputType = (src.data.lastInputType as string | undefined) ?? "audio"
    if (lastInputType === "video") {
      inputs.videoUrl = output
    } else {
      routeAudioOutput(inputs, output, targetType, src.id)
    }
    return
  }

  // --- Audio output nodes ---
  if (AUDIO_OUTPUT_NODE_TYPES.has(srcType)) {
    routeAudioOutput(inputs, output, targetType, src.id)

    // Suno track/task ID passthrough
    if (SUNO_TRACK_NODE_TYPES.has(srcType)) {
      const state = nodeStates[src.id]
      if (state?.output?.sunoTrackId) {
        inputs.sunoTrackId = state.output.sunoTrackId
      } else if (src.data.sunoTrackId) {
        // Fallback to node data for skipped/frozen nodes (matches frontend)
        inputs.sunoTrackId = src.data.sunoTrackId as string
      }
      if (state?.output?.sunoTaskId) {
        inputs.sunoTaskId = state.output.sunoTaskId
      } else if (src.data.sunoTaskId) {
        inputs.sunoTaskId = src.data.sunoTaskId as string
      }
    }
    return
  }

  // --- Scene node ---
  if (srcType === "scene") {
    const state = nodeStates[src.id]
    if (state?.output?.imageUrl) {
      if (targetType === "generate-image") {
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), state.output.imageUrl]
      } else {
        inputs.imageUrl = state.output.imageUrl
      }
    }
    if (state?.output?.videoUrl) {
      if (targetType === "combine-videos") {
        inputs.videoUrls = [...(inputs.videoUrls ?? []), state.output.videoUrl]
        inputs.videoUrlsWithSourceIds = [
          ...(inputs.videoUrlsWithSourceIds ?? []),
          { nodeId: src.id, url: state.output.videoUrl },
        ]
      } else if (targetType === "merge-video-audio") {
        if (!inputs.videoUrl) {
          inputs.videoUrl = state.output.videoUrl
        } else {
          inputs.audioSources = [
            ...(inputs.audioSources ?? []),
            { url: state.output.videoUrl, sourceNodeId: src.id, sourceType: "video" as const },
          ]
        }
      } else {
        inputs.videoUrl = state.output.videoUrl
      }
    }
    if (state?.output?.text) {
      inputs.prompt = state.output.text
    }
    // Extract character/object/location reference images from scene data (matches frontend)
    const sceneData = src.data
    const characters = (sceneData.characters as Array<{ assetId: string }> | undefined) ?? []
    const objects = (sceneData.objects as Array<{ assetId: string }> | undefined) ?? []
    const locations = (sceneData.locations as Array<{ assetId: string }> | undefined) ?? []
    const allAssetIds = [
      ...characters.map((c) => c.assetId),
      ...locations.map((l) => l.assetId),
      ...objects.map((o) => o.assetId),
    ].filter(Boolean)
    if (allAssetIds.length > 0) {
      // Look for character definition nodes in the workflow
      for (const assetId of allAssetIds) {
        const assetNode = allNodes.find((n) => n.id === assetId)
        if (!assetNode) continue
        const assetState = nodeStates[assetId]
        const refUrl = assetState?.output?.imageUrl ||
          (assetNode.data.sourceImageUrl as string | undefined) ||
          (assetNode.data.referenceImageUrl as string | undefined)
        if (refUrl) {
          inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), refUrl]
        }
      }
    }
    return
  }

  // --- Sub-workflow / component output routing ---
  if (srcType === "sub-workflow" || srcType === "sub-workflow-input" || srcType === "component") {
    const routeSnapshot = src.data.routeSnapshot as {
      outputPorts?: Array<{ id: string; mediaType: string }>
    } | undefined
    const sourceHandle = edge.sourceHandle

    let mediaType: string | undefined
    if (sourceHandle && routeSnapshot?.outputPorts) {
      const portId = sourceHandle.replace(/^out_/, "")
      const port = routeSnapshot.outputPorts.find((p) => p.id === portId)
      mediaType = port?.mediaType
    }

    if (srcType === "sub-workflow-input") {
      const ports = src.data.ports as Array<{ id: string; mediaType: string }> | undefined
      if (sourceHandle && ports) {
        const port = ports.find((p) => p.id === sourceHandle)
        mediaType = port?.mediaType
      }
    }

    // Component nodes: read output type from componentMetadata.outputs
    if (!mediaType && srcType === "component" && sourceHandle) {
      const compMeta = src.data.componentMetadata as { outputs?: Array<{ id: string; type: string }> } | undefined
      const portId = sourceHandle.replace(/^out_/, "")
      const handleType = compMeta?.outputs?.find((o) => o.id === portId)?.type
      if (handleType) mediaType = handleType
    }

    if (mediaType === "image") {
      if (targetType === "generate-image" || targetType === "edit-image" || targetType === "image-to-image" || targetType === "modify-image") {
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
      } else {
        inputs.imageUrl = output
      }
    } else if (mediaType === "video") {
      routeVideoOutput(inputs, output, targetType, src.id)
    } else if (mediaType === "audio") {
      routeAudioOutput(inputs, output, targetType, src.id)
    } else {
      inputs.prompt = output
    }
    return
  }

  // --- Webhook trigger with dynamic params ---
  if (srcType === "webhook-trigger") {
    const state = nodeStates[src.id]
    const paramOutputs = state?.output?.paramOutputs
    const params = src.data.params as Array<{ id: string; name: string; type: string }> | undefined

    if (params && params.length > 0 && paramOutputs && edge.sourceHandle) {
      // Route by param type using the source handle ID
      const param = params.find((p) => p.id === edge.sourceHandle)
      if (param) {
        const val = paramOutputs[param.id]
        if (val) {
          if (param.type === "text") inputs.prompt = val
          else if (param.type === "imageUrl") inputs.imageUrl = val
          else if (param.type === "videoUrl") routeVideoOutput(inputs, val, targetType, src.id)
          else if (param.type === "audioUrl") routeAudioOutput(inputs, val, targetType, src.id)
        }
      }
    } else {
      // Legacy fallback
      inputs.prompt = output
    }
    return
  }

  // --- Schedule trigger ---
  if (srcType === "schedule-trigger") {
    inputs.prompt = output
    return
  }

  // --- Social post nodes: route by source type ---
  if (SOCIAL_POST_NODE_TYPES.has(targetType)) {
    if (VIDEO_OUTPUT_NODE_TYPES.has(srcType) || srcType === "upload-video" || srcType === "youtube-video") {
      routeVideoOutput(inputs, output, targetType, src.id)
    } else if (
      srcType === "generate-image" || srcType === "edit-image" || srcType === "image-to-image" ||
      srcType === "modify-image" || srcType === "upscale-image" || srcType === "remove-background" ||
      srcType === "upload-image" || ENTITY_NODE_TYPES.has(srcType)
    ) {
      inputs.imageUrl = output
    } else if (AUDIO_OUTPUT_NODE_TYPES.has(srcType) || srcType === "upload-audio" || srcType === "reference-audio") {
      routeAudioOutput(inputs, output, targetType, src.id)
    } else {
      inputs.caption = output
    }
    return
  }

  // Fallback: treat as prompt
  inputs.prompt = output
}
