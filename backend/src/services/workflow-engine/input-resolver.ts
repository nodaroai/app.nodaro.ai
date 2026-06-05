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
import { extractSourceNodeOutput, extractSourceNodeOutputAsList, extractSavedNodeOutput, extractAllGeneratedResults, extractVideoDurationFromNode, getPrimaryOutput } from "./output-extractor.js"
import { extractGeneratedJsonAsList } from "@nodaro/shared"
import { splitGeneratedItems } from "@nodaro/shared"
import { isSourceNode } from "./execution-graph.js"
import { buildNodeRefMap } from "./payload-builder.js"
import { IMAGE_URL_RE, VIDEO_URL_RE, AUDIO_URL_RE } from "./inline-executor.js"
import { resolveNodeRefs } from "@nodaro/shared"
import { resolveIndex, selectListItems, type SelectorFields } from "@nodaro/shared"
import { splitByLoopDelimiter } from "@nodaro/shared"
import { SOCIAL_POST_NODE_TYPES } from "@nodaro/shared"
import { PARAMETER_NODE_TYPES } from "@nodaro/shared"

/**
 * Resolve a node's primary output from execution state or source node data.
 * Shared helper — deduplicates the check-state-then-source pattern used in
 * resolveNodeInputs, getListInputForNode, and loop column routing.
 *
 * `context` (allNodes + edges) is required when the source is a group or
 * collect node — they compute their output dynamically from children /
 * upstream edges, not from static `data`. When omitted, group/collect emit
 * nothing.
 */
export function getNodeOutput(
  node: SimpleNode,
  sourceHandle: string | null | undefined,
  nodeStates: Record<string, NodeExecutionState>,
  triggerData?: Record<string, unknown>,
  context?: { nodes: SimpleNode[]; edges: SimpleEdge[] },
): string | undefined {
  const state = nodeStates[node.id]
  if (state?.output) {
    return getPrimaryOutput(state.output, node.type, sourceHandle)
  }
  if (isSourceNode(node.type) || node.type === "group" || node.type === "collect") {
    const srcOutput = extractSourceNodeOutput(node, triggerData, sourceHandle, context)
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
  // Build an O(1) node index once (replaces per-edge linear `allNodes.find`
  // scans, including the teleport-chain walk below).
  const nodeById = new Map(allNodes.map((n) => [n.id, n] as const))

  const incomingEdges = edges.filter((e) => e.target === targetNode.id)
  const inputs: ResolvedInputs = {}
  const ctx = { nodes: allNodes, edges }

  for (const edge of incomingEdges) {
    let sourceNode = nodeById.get(edge.source)
    if (!sourceNode) continue

    // The effective sourceHandle for downstream resolution. Starts as the
    // consumer-side edge's sourceHandle. If we walk through teleport
    // send/receive pairs, the consumer's edge.sourceHandle refers to the
    // teleport node's "out" port (or similar) — NOT the underlying source's
    // handle. For handle-discriminated sources like selector (picked/rest),
    // llm-chat (items vs text), and loop/list (per-column handles), we MUST
    // surface the original upstream-of-teleport edge's sourceHandle instead,
    // or downstream channel routing collapses to the default channel
    // regardless of which channel was actually wired through the teleport pair.
    let effectiveSourceHandle: string | null | undefined = edge.sourceHandle

    // Teleport transparency: resolve through the chain to the original source
    if (sourceNode.type === "teleport-send" || sourceNode.type === "teleport-receive") {
      let current = sourceNode
      let lastInEdge: SimpleEdge | undefined
      const visited = new Set<string>()
      while ((current.type === "teleport-send" || current.type === "teleport-receive") && !visited.has(current.id)) {
        visited.add(current.id)
        const inEdge = edges.find((e) => e.target === current.id)
        if (!inEdge) break
        const upstream = nodeById.get(inEdge.source)
        if (!upstream) break
        // Remember the LAST edge whose source is the final non-teleport
        // upstream — its sourceHandle is the handle on the real source
        // (e.g. selector's "picked"/"rest", llm-chat's "items").
        lastInEdge = inEdge
        current = upstream
      }
      sourceNode = current
      if (lastInEdge) effectiveSourceHandle = lastInEdge.sourceHandle
    }

    // Get output from node state or source node data
    let output: string | undefined
    const state = nodeStates[sourceNode.id]

    const edgeData = edge.data as Record<string, unknown> | undefined
    const edgeOutputMode = edgeData?.outputMode as string | undefined

    // Generate Text (llm-chat) `items` handle MUST resolve via the current
    // ===NEXT=== split (resolveLlmChatItems below), NEVER via a stale
    // `data.generatedResults` snapshot persisted from a prior browser run. The
    // generic `effectiveListResults` fan-out blocks below read
    // extractAllGeneratedResults(data) and would intercept this edge first,
    // diverging from the frontend (whose `items` handle ALWAYS splits the
    // current text). Gate both blocks off for this exact edge so it falls
    // through to the handle-aware llm-chat block. Other handles/types untouched.
    const isLlmChatItemsEdge =
      sourceNode.type === "llm-chat" && effectiveSourceHandle === "items"

    // Selector emits two channels (pickedResults + restResults) keyed by
    // edge.sourceHandle. The "rest" handle returns the unselected remainder;
    // any other handle (typically "picked", or omitted) returns the picked
    // items. Mirrors the frontend node-input-resolver.ts srcListResults
    // ternary — without this, selector outputs are invisible to the generic
    // listResults fan-out path (selector never populates state.output.listResults)
    // and the resolver falls through to extractAllGeneratedResults which reads
    // data.generatedResults (not pickedResults/restResults).
    const selectorListResults: string[] | undefined =
      sourceNode.type === "selector"
        ? (effectiveSourceHandle === "rest"
            ? (state?.output?.restResults
                ?? (sourceNode.data.restResults as string[] | undefined))
            : (state?.output?.pickedResults
                ?? (sourceNode.data.pickedResults as string[] | undefined)))
        : undefined

    const effectiveListResults = isLlmChatItemsEdge
      ? undefined
      : selectorListResults
        ?? state?.output?.listResults
        ?? extractAllGeneratedResults(sourceNode.data as Record<string, unknown>)
        ?? extractGeneratedJsonAsList(sourceNode.data as Record<string, unknown>)

    // Fan-in targets (collect): consume the entire upstream list as a single
    // `inputs.inputs` array regardless of edgeOutputMode — collect strategies
    // fold the list into one value, they are never fanned out per-item. When
    // upstream has no list (no fan-out happened), wrap its single output as
    // `[output]` so the strategy still has something to fold.
    if (FAN_IN_NODE_TYPES.has(targetNode.type)) {
      // llm-chat `items` edge: the fold source is the current ===NEXT=== split
      // (not the stale-generatedResults-derived effectiveListResults, which we
      // zeroed above), so a reduce over `items` folds the same blocks the
      // frontend would. Falls through to the single-result wrap if no items.
      const fanInList: string[] | undefined = isLlmChatItemsEdge
        ? resolveLlmChatItems(sourceNode, effectiveSourceHandle, nodeStates)
        : effectiveListResults
      const filtered: string[] = fanInList && fanInList.length > 0
        ? selectListItems(fanInList, edgeData as SelectorFields | undefined)
        : []
      const collected: string[] = []
      for (const item of filtered) {
        if (typeof item === "string" && item.length > 0) collected.push(item)
      }
      if (collected.length > 0) {
        inputs.inputs = [...(inputs.inputs ?? []), ...collected]
        continue
      }
      // Single-result fallback — upstream wasn't fanned out.
      const single = getNodeOutput(sourceNode, effectiveSourceHandle, nodeStates, triggerData)
      if (single) {
        inputs.inputs = [...(inputs.inputs ?? []), single]
      }
      continue
    }

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
        // List sources have no intrinsic media type — items can be mixed
        // photo/video, so classify per-item via URL regex instead of srcType.
        if (
          SOCIAL_POST_NODE_TYPES.has(targetNode.type) &&
          (targetNode.data?.action as string | undefined) === "post-carousel"
        ) {
          for (const item of filtered) {
            if (!item) continue
            const type = VIDEO_URL_RE.test(item) ? "video" : "photo"
            inputs.mediaItems = [...(inputs.mediaItems ?? []), { type, url: item }]
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

    // Generate Text (llm-chat) `items` handle: the ===NEXT===-split list is a
    // fan-out source exactly like loop/list. Resolve the per-iteration value
    // from the split items, honoring the edge's item/last/item:N mode + range/
    // list selector. Mirrors the loop/list per-iteration blocks (and the
    // frontend node-input-resolver). Only the explicit `items` handle splits —
    // the default/`text` handle stays scalar and falls through to getNodeOutput
    // below (full generatedText with delimiters intact).
    if (!output && sourceNode.type === "llm-chat" && effectiveSourceHandle === "items") {
      const raw = resolveLlmChatItems(sourceNode, effectiveSourceHandle, nodeStates)
      if (raw && raw.length > 0) {
        const ranged = selectListItems(raw, edgeData as SelectorFields | undefined)
        if (ranged.length > 0) {
          if (edgeOutputMode === "item") {
            const itemIndex = edgeData?.itemIndex as string | undefined
            output = ranged[resolveIndex(itemIndex ?? "1", ranged.length)] ?? ranged[0]
          } else if (edgeOutputMode?.startsWith("item:")) {
            const idx = parseInt(edgeOutputMode.split(":")[1], 10)
            output = ranged[idx] ?? ranged[0]
          } else if (edgeOutputMode === "last") {
            output = ranged[ranged.length - 1]
          } else if (listIterationIndex != null) {
            output = ranged[listIterationIndex % ranged.length]
          }
          // Non-iteration / non-fan-out context (listIterationIndex undefined,
          // default/each mode): leave `output` unset so it falls through to
          // getNodeOutput below — the full generatedText with its ===NEXT===
          // delimiters intact, preserving the pre-existing scalar prompt value.
        }
      }
    }

    if (!output) {
      // Loop/list column routing: resolve correct column value by sourceHandle
      // (matches frontend). Uses resolveListLoopColumnItems which recursively
      // follows connected-mode chains (list → list → image-source), applying
      // each intermediate edge's filter. Without recursion, chains of two or
      // more connected-mode lists couldn't propagate items through the
      // orchestrator — the downstream gen-image fell back to collectAncestorRefs
      // and bypassed every filter in between.
      if (sourceNode.type === "list") {
        const items = resolveListLoopColumnItems(
          sourceNode,
          effectiveSourceHandle,
          edges,
          allNodes,
          nodeStates,
          triggerData,
          new Set(),
          nodeById,
        )
        if (items && items.length > 0) {
          const filtered = selectListItems(items, edgeData as SelectorFields | undefined)
          if (filtered.length > 0) {
            if (listIterationIndex != null) {
              output = filtered[listIterationIndex % filtered.length]
            } else {
              output = filtered[0]
            }
          }
        }
      }

      if (!output) {
        output = getNodeOutput(sourceNode, effectiveSourceHandle, nodeStates, triggerData, ctx)
      }
    }

    // Parameter nodes (framing, camera-motion, person, mood, etc.) are
    // additive enhancements — payload-builder's `collectCinematographyHints`
    // appends their hint to the prompt. Short-circuit the edge here so we
    // don't overwrite `inputs.prompt` with the parameter hint, which would
    // silently erase the consumer's manual prompt.
    if (!output && PARAMETER_NODE_TYPES.has(sourceNode.type)) continue

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
  // Mirrors image-to-video — the generate-video node exposes the same
  // selectedStartFrame/EndFrame/Audio dropdown fallbacks. New typed-handle
  // edges (imageReferences, videoReferences, audioReferences, startFrame,
  // endFrame, audio) are handled by REFERENCE_HANDLE_MAP + the generic
  // targetHandle checks in routeOutput, so no extra entries here.
  "generate-video": [
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
  // ai-avatar: audio-mode can be driven by a selected upstream audio node.
  // No selectedImageNodeId — the avatar identity comes from the avatarId
  // catalog picker, not from a wired image.
  "ai-avatar": [
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

  const nodeById = new Map(allNodes.map((n) => [n.id, n] as const))

  for (const { dataField, inputField, guard } of mappings) {
    // Skip if the input is already resolved (custom guard or simple truthy check)
    if (guard ? !guard(inputs) : inputs[inputField]) continue
    const selectedId = targetNode.data[dataField] as string | undefined
    if (!selectedId) continue
    const node = nodeById.get(selectedId)
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
const DEFAULT_EACH_TYPES = new Set(["list", "split-text", "selector"])

/**
 * Resolve the Generate Text (llm-chat) `items` handle into its fan-out list —
 * the LLM result split on `===NEXT===` via the shared `splitGeneratedItems`
 * helper (identical to the backend output-extractor + frontend resolver, so
 * single-node and DAG runs produce the SAME items — design REQ B parity).
 *
 * Prefers the completed-state `output.items` (already split at extraction time)
 * and falls back to splitting the source node's `data.generatedText`. Returns
 * `undefined` for any handle other than `items` (the default/`text` handle is a
 * scalar source — no fan-out) so callers only fan out on the explicit handle.
 *
 * The list is ALREADY structured: each block may legitimately contain commas /
 * newlines, so loop/list consumers must NOT re-chop it by their own column
 * delimiter (callers route through this instead of `splitByLoopDelimiter`).
 */
function resolveLlmChatItems(
  node: SimpleNode,
  sourceHandle: string | null | undefined,
  nodeStates: Record<string, NodeExecutionState>,
): string[] | undefined {
  if (node.type !== "llm-chat" || sourceHandle !== "items") return undefined
  const stateItems = nodeStates[node.id]?.output?.items
  if (stateItems && stateItems.length > 0) return stateItems
  const items = splitGeneratedItems(
    (node.data as Record<string, unknown>).generatedText as string | undefined,
  )
  return items.length > 0 ? items : undefined
}

/**
 * Resolve the list of values flowing out of a list/loop column, recursively
 * following connected-mode chains and applying each edge's selector filter.
 *
 * Without this, chained connected-mode lists (e.g. gen-image → list1 → list2 →
 * gen-image2) couldn't propagate their items through the backend orchestrator,
 * because getNodeOutput on an intermediate list returned a single string with
 * no awareness of upstream accumulated results.
 *
 * Mirrors the frontend's resolveLoopColumnValues + resolveUpstreamWithEdgeFilter.
 */
/**
 * Resolve a legacy global "in" handle (connected mode) on a list/loop node.
 *
 * Old `loop` (Table) workflows wired a single upstream to a bare `"in"` target
 * handle instead of the per-column `${handleId}_in` handles; the node then
 * splits that upstream's output by the column delimiter and fans out. The
 * current list/loop node component (`loop-node.tsx::buildHandles`) no longer
 * emits an `"in"` handle, but un-migrated workflows can still carry such an
 * edge — `loop-node.tsx::connectedRows` and the frontend `resolveLoopColumnValues`
 * BOTH still resolve it. Without this, normalizing loop → list would silently
 * drop the connected-mode fan-out for those legacy nodes (the exact gap the
 * dedicated `loop` branch in `getListInputForNode` used to cover, case b).
 *
 * Applies the "in" edge's own selector internally, exactly like the per-column
 * branch; the caller's `selectListItems` then applies the consumer edge's
 * selector on top. Returns undefined when there is no "in" edge / no items.
 */
function resolveLegacyInHandleItems(
  sourceNode: SimpleNode,
  columns: Array<{ handleId: string; splitDelimiter?: string }> | undefined,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  triggerData: Record<string, unknown> | undefined,
  ctx: { nodes: SimpleNode[]; edges: SimpleEdge[] },
): string[] | undefined {
  const legacyInEdge = edges.find(
    (e) => e.target === sourceNode.id && e.targetHandle === "in",
  )
  if (!legacyInEdge) return undefined
  const upstreamNode = allNodes.find((n) => n.id === legacyInEdge.source)
  if (!upstreamNode) return undefined
  const inSelector = legacyInEdge.data as SelectorFields | undefined
  // Generate Text `items` handle is ALREADY ===NEXT===-split — pass it through
  // whole rather than re-chopping by the column delimiter.
  const llmItems = resolveLlmChatItems(upstreamNode, legacyInEdge.sourceHandle, nodeStates)
  if (llmItems) {
    const filtered = selectListItems(llmItems, inSelector)
    if (filtered.length > 0) return filtered
  }
  const upstreamText = getNodeOutput(upstreamNode, legacyInEdge.sourceHandle, nodeStates, triggerData, ctx)
  if (upstreamText) {
    const lines = splitByLoopDelimiter(upstreamText, columns)
    const filtered = selectListItems(lines, inSelector)
    if (filtered.length > 0) return filtered
  }
  return undefined
}

function resolveListLoopColumnItems(
  sourceNode: SimpleNode,
  sourceHandle: string | null | undefined,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  triggerData: Record<string, unknown> | undefined,
  visited: Set<string> = new Set(),
  // Threaded O(1) node index — built once by the top-level caller and reused
  // across recursion levels. Falls back to a local build for direct callers.
  nodeById: Map<string, SimpleNode> = new Map(allNodes.map((n) => [n.id, n] as const)),
): string[] | undefined {
  if (visited.has(sourceNode.id)) return undefined
  visited.add(sourceNode.id)

  const ctx = { nodes: allNodes, edges }
  const columns = sourceNode.data.columns as
    | Array<{ id: string; handleId: string; type?: string; splitDelimiter?: string; connectedSourceId?: string; connectedSourceHandle?: string }>
    | undefined
  if (!columns || !sourceHandle) {
    // No typed column routing — fall back to legacy extraction.
    return extractSourceNodeOutputAsList(sourceNode, triggerData, sourceHandle, ctx)
  }
  const colIndex = columns.findIndex((c) => c.handleId === sourceHandle)
  if (colIndex < 0) {
    // The consumer's sourceHandle doesn't match a column. A legacy `"in"`
    // connected-mode edge still fans out the same split list regardless of
    // which column handle the consumer reads (the old `loop` branch checked
    // `loopInEdges` unconditionally too), so try it before legacy extraction.
    const legacyItems = resolveLegacyInHandleItems(sourceNode, columns, edges, allNodes, nodeStates, triggerData, ctx)
    if (legacyItems) return legacyItems
    return extractSourceNodeOutputAsList(sourceNode, triggerData, sourceHandle, ctx)
  }
  const col = columns[colIndex]

  // Per-column connected source: resolve upstream's items, applying this edge's filter.
  const colInEdge = edges.find(
    (e) => e.target === sourceNode.id && e.targetHandle === `${col.handleId}_in`,
  )
  if (colInEdge) {
    const upstreamNode = nodeById.get(colInEdge.source)
    if (upstreamNode) {
      const edgeSelector = colInEdge.data as SelectorFields | undefined
      let upstreamVals: string[] | undefined

      // Generate Text `items` handle: ===NEXT===-split list, ALREADY structured.
      // Return it whole (after the edge filter), bypassing the `length > 1` gate
      // and the splitByLoopDelimiter re-chop below — each block may contain
      // commas/newlines and must NOT be split by this column's delimiter.
      const llmItems = resolveLlmChatItems(upstreamNode, colInEdge.sourceHandle, nodeStates)
      if (llmItems) {
        const filtered = selectListItems(llmItems, edgeSelector)
        if (filtered.length > 0) return filtered
      }

      if (upstreamNode.type === "list") {
        // Recurse into chained lists.
        upstreamVals = resolveListLoopColumnItems(
          upstreamNode,
          colInEdge.sourceHandle,
          edges,
          allNodes,
          nodeStates,
          triggerData,
          visited,
          nodeById,
        )
      } else if (upstreamNode.type === "selector") {
        // Selector emits picked/rest channels keyed by sourceHandle. Mirrors
        // the listResults branch below but routes by colInEdge.sourceHandle —
        // selector never populates listResults, so the generic branch would
        // miss it. Prefer state.output, fall back to data.* snapshots.
        const state = nodeStates[upstreamNode.id]
        const data = upstreamNode.data as Record<string, unknown>
        const channel = colInEdge.sourceHandle === "rest"
          ? (state?.output?.restResults ?? (data.restResults as string[] | undefined))
          : (state?.output?.pickedResults ?? (data.pickedResults as string[] | undefined))
        if (channel && channel.length > 0) {
          upstreamVals = channel.filter((v): v is string => typeof v === "string" && v.length > 0)
        }
      } else {
        // Non-list upstream: prefer completed state's listResults (fan-out
        // output), fall back to the node's accumulated generatedResults.
        const state = nodeStates[upstreamNode.id]
        if (state?.output?.listResults && state.output.listResults.length > 0) {
          upstreamVals = state.output.listResults.filter((v): v is string => typeof v === "string" && v.length > 0)
        } else {
          const fromData = extractAllGeneratedResults(upstreamNode.data as Record<string, unknown>)
          if (fromData && fromData.length > 0) upstreamVals = fromData
        }
      }

      if (upstreamVals && upstreamVals.length > 1) {
        const filtered = selectListItems(upstreamVals, edgeSelector)
        if (filtered.length > 0) return filtered
      }

      // Single-output upstream (or no multi-item accumulation): split the
      // primary text output by this column's delimiter (default newline).
      const upstreamText = getNodeOutput(upstreamNode, colInEdge.sourceHandle, nodeStates, triggerData, ctx)
      if (upstreamText) {
        const lines = splitByLoopDelimiter(upstreamText, columns)
        if (lines.length > 0) return lines
      }
    }
  }

  // Legacy global "in" handle (connected mode), checked AFTER per-column and
  // BEFORE manual rows — mirroring the frontend `resolveLoopColumnValues`
  // ordering (per-column edge → legacy "in" → manual rows).
  const legacyItems = resolveLegacyInHandleItems(sourceNode, columns, edges, allNodes, nodeStates, triggerData, ctx)
  if (legacyItems) return legacyItems

  // Manual mode: extract column values directly from rows.
  const rows = (sourceNode.data.rows as string[][] | undefined) ?? []
  const items = rows.map((row) => row[colIndex]?.trim()).filter(Boolean) as string[]
  if (items.length > 0) return items

  // Legacy items-string fallback.
  return extractSourceNodeOutputAsList(sourceNode, triggerData, sourceHandle, ctx)
}

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
  // Fan-in targets consume the upstream list — they are NOT fanned out themselves.
  // Returning undefined here keeps the orchestrator from creating one execution
  // per upstream item and lets resolveNodeInputs populate `inputs.inputs` instead.
  if (FAN_IN_NODE_TYPES.has(targetNode.type)) return undefined

  // Build O(1) lookup indexes once (replaces per-edge linear array scans).
  const nodeById = new Map(allNodes.map((n) => [n.id, n] as const))
  const edgesByTarget = new Map<string, SimpleEdge[]>()
  for (const e of edges) {
    const list = edgesByTarget.get(e.target)
    if (list) list.push(e)
    else edgesByTarget.set(e.target, [e])
  }

  const ctx = { nodes: allNodes, edges }
  const incomingEdges = edgesByTarget.get(targetNode.id) ?? []

  for (const edge of incomingEdges) {
    const sourceNode = nodeById.get(edge.source)
    if (!sourceNode) continue

    // Read range config from the edge
    const edgeData = edge.data as Record<string, unknown> | undefined
    const selectorArg = edgeData as SelectorFields | undefined

    // generate-script "images" handle fan-out — each scene imagePrompt becomes one item
    if (sourceNode.type === "generate-script" && edge.sourceHandle === "images") {
      const script = getActiveScriptFromState(nodeStates, edge.source)
      const scenesList = (script?.scenes as Array<Record<string, unknown>>) ?? []
      if (scenesList.length > 1) {
        const items = scenesList.map((s) => (s.imagePrompt as string) ?? "")
        return selectListItems(items, selectorArg)
      }
    }

    // Generate Text (llm-chat) "items" handle → ===NEXT===-split list (fan-out).
    // This handle is NOT in DEFAULT_EACH_TYPES, so the generic outputMode gate
    // below would default it to "last" and `continue` (no fan-out) — it must be
    // resolved here, handle-aware. The default/`text` handle is left to the
    // generic path, where llm-chat is a scalar source (no fan-out). Mirrors the
    // frontend node-input-resolver getListInputForNode branch. Honors the edge's
    // range/list selector. item/last/item:N pick a single value → no fan-out.
    if (sourceNode.type === "llm-chat" && edge.sourceHandle === "items") {
      const llmEdgeMode = edgeData?.outputMode as string | undefined
      if (llmEdgeMode === "item" || llmEdgeMode === "last" || llmEdgeMode?.startsWith("item:")) {
        continue
      }
      const raw = resolveLlmChatItems(sourceNode, edge.sourceHandle, nodeStates)
      if (raw && raw.length > 0) {
        const filtered = selectListItems(raw, selectorArg)
        if (filtered.length > 1) return filtered
      }
      continue
    }

    // Check outputMode from edge data — only fan-out if mode is "each"
    // List/loop/split-text edges default to "each"; all other edges default to "last"
    const edgeOutputMode = edgeData?.outputMode as string | undefined
    const outputMode = edgeOutputMode ?? (DEFAULT_EACH_TYPES.has(sourceNode.type) ? "each" : "last")
    if (outputMode !== "each") continue

    // 1. List node (also covers legacy `loop`, normalized to `list` upstream of
    //    this code) — use the recursive resolver for connected-mode chains.
    //    `resolveListLoopColumnItems` handles all three legacy loop modes:
    //    per-column `${handleId}_in` edges, the global `"in"` connected handle,
    //    and manual-mode column rows. See loop-list-fanout-parity.test.ts.
    if (sourceNode.type === "list") {
      const items = resolveListLoopColumnItems(
        sourceNode,
        edge.sourceHandle,
        edges,
        allNodes,
        nodeStates,
        triggerData,
        new Set(),
        nodeById,
      )
      if (items && items.length > 1) {
        const filtered = selectListItems(items, selectorArg)
        if (filtered.length > 1) return filtered
      }
      continue
    }

    // 2. Split-text node — read splitResults from completed state
    if (sourceNode.type === "split-text") {
      const state = nodeStates[sourceNode.id]
      if (state?.output?.splitResults && state.output.splitResults.length > 1) {
        const filtered = selectListItems(state.output.splitResults, selectorArg)
        if (filtered.length > 1) return filtered
      }
      continue
    }

    // 3. Selector — picked vs rest channel selected by edge.sourceHandle.
    //    Mirrors the filter-list family but routes by handle. Selector never
    //    populates listResults, so the generic block below would miss its
    //    output entirely. Prefer state.output, fall back to data.* snapshots
    //    for nodes that ran in a previous session.
    const state = nodeStates[sourceNode.id]
    if (sourceNode.type === "selector") {
      const data = sourceNode.data as Record<string, unknown>
      const channel = edge.sourceHandle === "rest"
        ? (state?.output?.restResults ?? (data.restResults as string[] | undefined))
        : (state?.output?.pickedResults ?? (data.pickedResults as string[] | undefined))
      if (channel && channel.length > 1) {
        const filtered = selectListItems(channel, selectorArg)
        if (filtered.length > 1) return filtered
      }
      continue
    }

    // 4. Any node with listResults from a prior fan-out execution
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

    // 6. JSON array output (e.g. web-scrape generatedJson) — each element is one list item
    const jsonItems = extractGeneratedJsonAsList(sourceNode.data as Record<string, unknown>)
    if (jsonItems) {
      const filtered = selectListItems(jsonItems, selectorArg)
      if (filtered.length > 1) return filtered
    }
  }

  // Transitive fan-out: if a direct parent is a text-prompt whose own upstream
  // is a list-like node with "each" mode, resolve the text template per item.
  for (const edge of incomingEdges) {
    const sourceNode = nodeById.get(edge.source)
    if (!sourceNode || sourceNode.type !== "text-prompt") continue

    const sourceIncoming = edgesByTarget.get(sourceNode.id) ?? []
    for (const srcEdge of sourceIncoming) {
      const listNode = nodeById.get(srcEdge.source)
      if (!listNode || !DEFAULT_EACH_TYPES.has(listNode.type)) continue

      const gpEdgeMode = (srcEdge.data as Record<string, unknown> | undefined)
        ?.outputMode as string | undefined
      if ((gpEdgeMode ?? "each") !== "each") continue

      // Read range config from the upstream edge
      const gpData = srcEdge.data as Record<string, unknown> | undefined

      // Get list items — list routes through extractSourceNodeOutputAsList
      // (which handles its columns+rows); split-text reads its splitResults
      // from execution state.
      let listItems: string[] | undefined
      if (listNode.type === "list") {
        listItems = extractSourceNodeOutputAsList(listNode, triggerData, srcEdge.sourceHandle, ctx)
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

/** Route a video output to the correct input field based on target node type.
 *  `duration` is the upstream node's video duration (seconds) when known —
 *  attached to `videoUrl` (single-input nodes like trim-video / loop-video)
 *  and to per-entry `videoUrlsWithSourceIds` rows (combine-videos), so the
 *  payload-builder can build aligned upstreamDurations / upstreamDuration. */
function routeVideoOutput(
  inputs: ResolvedInputs,
  output: string,
  targetType: string,
  sourceNodeId: string,
  duration?: number,
): void {
  if (targetType === "combine-videos") {
    inputs.videoUrls = [...(inputs.videoUrls ?? []), output]
    inputs.videoUrlsWithSourceIds = [
      ...(inputs.videoUrlsWithSourceIds ?? []),
      { nodeId: sourceNodeId, url: output, duration },
    ]
  } else if (targetType === "merge-video-audio") {
    if (!inputs.videoUrl) {
      inputs.videoUrl = output
      if (duration !== undefined) inputs.videoDuration = duration
    } else {
      inputs.audioSources = [
        ...(inputs.audioSources ?? []),
        { url: output, sourceNodeId, sourceType: "video" as const },
      ]
    }
  } else {
    inputs.videoUrl = output
    if (duration !== undefined) inputs.videoDuration = duration
  }
}

// ---------------------------------------------------------------------------
// Media type sets for source type classification
// ---------------------------------------------------------------------------

const TEXT_SOURCE_NODE_TYPES = new Set([
  "text-prompt",
  "list",
  "transcribe",
  "suno-lyrics",
  "image-to-text",
  "ai-writer",
  "llm-chat",
  "combine-text",
  "split-text",
  "extract-field",
  "suno-style-boost",
  "forced-alignment",
  "qa-check",
  "image-critic",
])

// Preview routes by actual media type, not always to text (handled in routeOutput)
// Social-media-format may produce images (handled in routeOutput)

/** Target node types that accumulate inputs into arrays (videoUrls, audioUrls). */
const ARRAY_ACCUMULATING_TYPES = new Set(["combine-videos", "mix-audio", "combine-audio"])

/** Target node types that consume an upstream list as a single fan-in input.
 *  The resolver collects all upstream items into `inputs.inputs` and skips
 *  per-item routing entirely — the strategy folds the list into one value. */
const FAN_IN_NODE_TYPES = new Set(["reduce"])

const REFERENCE_HANDLE_MAP: Record<string, "referenceImageUrls" | "referenceVideoUrls" | "referenceAudioUrls"> = {
  // Legacy / i2v single-name handle ids (kept for un-migrated workflows)
  "references": "referenceImageUrls",
  "reference-videos": "referenceVideoUrls",
  "reference-audio": "referenceAudioUrls",
  // New canonical typed-handle ids (Generate Video) — share the resolved-input
  // keys with the legacy ids so payload-builder code doesn't fork.
  "imageReferences": "referenceImageUrls",
  "videoReferences": "referenceVideoUrls",
  "audioReferences": "referenceAudioUrls",
}

const ENTITY_NODE_TYPES = new Set(["character", "face", "object", "location"])

const VIDEO_OUTPUT_NODE_TYPES = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "generate-video",
  "lip-sync",
  "speech-to-video",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  "video-retake",
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
  "video-sfx",
  "ai-avatar",
  "cinematic-avatar",
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

const IMAGE_SOURCE_NODE_TYPES = new Set([
  "generate-image", "edit-image", "image-to-image", "modify-image",
  "upscale-image", "remove-background", "upload-image", "extract-frame",
])

function isVideoSourceType(srcType: string): boolean {
  return VIDEO_OUTPUT_NODE_TYPES.has(srcType) || srcType === "upload-video" || srcType === "youtube-video"
}

function isImageSourceType(srcType: string): boolean {
  return IMAGE_SOURCE_NODE_TYPES.has(srcType) || ENTITY_NODE_TYPES.has(srcType)
}

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
  // cinematic-avatar reference handles — one upstream producer per handle.
  // Routed to dedicated ref* slots (NOT videoUrl/audioUrl/imageUrl) so a
  // cinematic node's reference wires never collide with a generic media input
  // and so payload-builder can assemble the typed references array. These MUST
  // be checked before source-type routing, which would otherwise land a video
  // producer in inputs.videoUrl, etc.
  //
  // GATED on targetType === "cinematic-avatar": the `ref-*` handle names are NOT
  // exclusive to cinematic-avatar. generate-music ships a live "ref-audio" handle
  // whose value MUST land in inputs.audioUrl (it reads referenceAudioUrl ←
  // resolvedInputs.audioUrl, never refAudioUrl). Without this guard a generic
  // ref-audio interceptor would divert generate-music's reference URL into the
  // cinematic-only refAudioUrl slot and silently break the Suno cover/reference
  // feature. Only cinematic-avatar renders ref-video/ref-image, but we gate all
  // three for symmetry + future-safety.
  if (targetType === "cinematic-avatar") {
    if (edge.targetHandle === "ref-video") {
      inputs.refVideoUrl = output
      return
    }
    if (edge.targetHandle === "ref-audio") {
      inputs.refAudioUrl = output
      return
    }
    if (edge.targetHandle === "ref-image") {
      inputs.refImageUrl = output
      return
    }
  }
  // ai-avatar `script` handle: routes a wired text-prompt directly into the
  // `script` field (verbatim TTS input — never folded into `prompt`).
  if (edge.targetHandle === "script") {
    inputs.script = output
    return
  }
  if (edge.targetHandle === "mask") {
    inputs.maskUrl = output
    return
  }
  if (edge.targetHandle === "lottie") {
    if (output.startsWith("http") || output.startsWith("/")) {
      const name = (src.data.label as string | undefined) ?? "Lottie Asset"
      inputs.lottieAssets = [
        ...(inputs.lottieAssets ?? []),
        { id: src.id, url: output, name },
      ]
    }
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
  // Generate-video exposes a `negative` typed handle alongside `prompt`. The
  // `prompt` handle is already handled by the default text-source path below
  // (TEXT_SOURCE_NODE_TYPES → inputs.prompt). `negative` diverts from that
  // path and MUST be routed here, otherwise text-prompt sources wired to the
  // Negative handle silently fall into `inputs.prompt` (positive slot).
  if (edge.targetHandle === "negative") {
    inputs.negativePrompt = output
    return
  }
  if (edge.targetHandle === "image") {
    inputs.imageUrl = output
    return
  }
  // Video-sfx (and any future single-video-input node) exposes a typed
  // `video` handle for its input clip. Generic video-source routing
  // (VIDEO_OUTPUT_NODE_TYPES → routeVideoOutput → inputs.videoUrl) already
  // works for upload-video / generate-video / video-to-video upstreams, but
  // an explicit handle case bullet-proofs against sources whose default
  // routing doesn't land in `videoUrl` (e.g. a future media-producing
  // source-type that defaults elsewhere). Mirrors the `image` handle above.
  if (edge.targetHandle === "video") {
    inputs.videoUrl = output
    return
  }
  if (edge.targetHandle === "reference") {
    inputs.referenceImageUrl = output
    return
  }

  // Carousel accumulation must run before srcType branches below, which
  // overwrite imageUrl/videoUrl (last-wins) and would hide fanned-in items.
  if (
    SOCIAL_POST_NODE_TYPES.has(targetType) &&
    (target.data.action as string | undefined) === "post-carousel"
  ) {
    const isVideo = isVideoSourceType(srcType)
    if (isVideo || isImageSourceType(srcType)) {
      inputs.mediaItems = [...(inputs.mediaItems ?? []), { type: isVideo ? "video" : "photo", url: output }]
    }
  }

  // --- List with typed column — route by column type ---
  // List nodes store columns with typed handles; the output should land in the
  // matching input slot (image → referenceImageUrls, etc.), not always in
  // `prompt`. Without this, list → generate-image (reference image) drops the
  // wired URL and the downstream node falls back to collectAncestorRefs, which
  // walks raw upstream and ignores edge filters.
  if (srcType === "list" && Array.isArray(src.data.columns) && edge.sourceHandle) {
    const columns = src.data.columns as Array<{ handleId: string; type?: string }>
    let col = columns.find((c) => c.handleId === edge.sourceHandle)
    // Natively-created list nodes use a fixed "list" output handle (not the
    // per-column handles that loop-origin migrated nodes keep), so the handleId
    // lookup won't match. Fall back to the first column so the user's
    // column-type setting is honoured.
    if (!col && columns.length > 0) {
      col = columns[0]
    }
    const colType = col?.type ?? "text"
    const targetAction = (target.data.action as string | undefined) ?? ""
    const isCarouselTarget = SOCIAL_POST_NODE_TYPES.has(targetType) && targetAction === "post-carousel"
    if (colType === "image-url") {
      if (isCarouselTarget) {
        inputs.mediaItems = [...(inputs.mediaItems ?? []), { type: "photo", url: output }]
      } else if (targetType === "generate-image" || targetType === "edit-image" || targetType === "image-to-image" || targetType === "modify-image") {
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
      } else {
        inputs.imageUrl = output
      }
      return
    }
    if (colType === "video-url") {
      if (isCarouselTarget) {
        inputs.mediaItems = [...(inputs.mediaItems ?? []), { type: "video", url: output }]
      }
      routeVideoOutput(inputs, output, targetType, src.id)
      return
    }
    if (colType === "audio-url") {
      routeAudioOutput(inputs, output, targetType, src.id)
      return
    }
    // text column falls through to the list text-routing / prompt fallback below
  }

  // --- List node output mode routing (reads mode from edge data) ---
  if (srcType === "list") {
    const edgeMode = (edge.data as Record<string, unknown> | undefined)?.outputMode as string | undefined
    const outputMode = edgeMode ?? "each" // list edges default to "each"
    // Prefer modern columns+rows format; fall back to legacy items string.
    // Without the modern branch, a list in All mode joined only the legacy
    // items string (empty for modern lists) and each/last/item hit their
    // `|| output` fallback — producing a single item instead of the full list.
    const cols = src.data.columns as Array<{ handleId: string }> | undefined
    const items = cols
      ? ((src.data.rows as string[][] | undefined) ?? [])
          .map((r) => r[0]?.trim() ?? "")
          .filter((v) => v.length > 0)
      : ((src.data.items as string | undefined) || "")
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
    // Transcribe → add-captions: wire word-timed captions through alongside the
    // text fallback. The kinetic-captions worker prefers `captions` when present
    // and falls back to `text` only for static styles.
    if (srcType === "transcribe" && targetType === "add-captions") {
      const state = nodeStates[src.id]
      if (state?.output?.captions && state.output.captions.length > 0) {
        inputs.captions = state.output.captions
      }
    }
    inputs.prompt = output
    return
  }

  // --- Upload image ---
  if (srcType === "upload-image") {
    if (targetType === "generate-image" || targetType === "video-to-video") {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    } else {
      inputs.imageUrl = output
    }
    return
  }

  // --- Entity nodes → reference images (or imageUrl for lip-sync / motion-transfer / ai-avatar image mode) ---
  if (ENTITY_NODE_TYPES.has(srcType)) {
    if (targetType === "lip-sync" || targetType === "speech-to-video" || targetType === "motion-transfer" || targetType === "ai-avatar") {
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
      routeVideoOutput(inputs, output, targetType, src.id, extractVideoDurationFromNode(src.data))
    }
    return
  }

  // --- Generate image → depends on target ---
  if (srcType === "generate-image") {
    if (targetType === "generate-image" || targetType === "video-to-video") {
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
      targetType === "modify-image" ||
      targetType === "video-to-video"
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
      targetType === "modify-image" ||
      targetType === "video-to-video"
    ) {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    } else {
      inputs.imageUrl = output
    }
    return
  }

  // --- Video output nodes ---
  if (VIDEO_OUTPUT_NODE_TYPES.has(srcType)) {
    routeVideoOutput(inputs, output, targetType, src.id, extractVideoDurationFromNode(src.data))

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

  // --- Suno voice persona — voiceId → personaId on music-generation nodes ---
  if (srcType === "suno-voice") {
    if (
      targetType === "suno-generate" ||
      targetType === "suno-cover" ||
      targetType === "suno-extend"
    ) {
      const voiceId =
        (src.data.voiceId as string | undefined)?.trim() || output
      if (voiceId) {
        inputs.personaId = voiceId
        inputs.personaModel =
          (src.data.personaModel as string | undefined) ?? "voice_persona"
      }
    }
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

  // --- Voice-changer → audio (audio mode) or video (video mode) ---
  // Dual-mode like adjust-volume. `output` was already narrowed to the right URL
  // by getPrimaryOutput via the source handle; route it to the matching slot.
  // Default (no explicit handle) prefers video when the node produced one.
  if (srcType === "voice-changer") {
    const producedVideo =
      Boolean(nodeStates[src.id]?.output?.videoUrl) ||
      Boolean(src.data.generatedVideoUrl)
    if (edge.sourceHandle === "video" || (edge.sourceHandle !== "audio" && producedVideo)) {
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
      if (targetType === "generate-image" || targetType === "video-to-video") {
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
      const nodeById = new Map(allNodes.map((n) => [n.id, n] as const))
      for (const assetId of allAssetIds) {
        const assetNode = nodeById.get(assetId)
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
  // Note: carousel accumulation runs at the top of routeOutput; this block
  // fills single-value fields used by post-image/reel/story/video actions.
  if (SOCIAL_POST_NODE_TYPES.has(targetType)) {
    if (isVideoSourceType(srcType)) {
      routeVideoOutput(inputs, output, targetType, src.id, extractVideoDurationFromNode(src.data))
    } else if (isImageSourceType(srcType) && srcType !== "extract-frame") {
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
