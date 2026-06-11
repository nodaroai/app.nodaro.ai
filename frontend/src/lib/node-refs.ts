/**
 * Node reference helpers for the frontend.
 * Finds upstream ancestor nodes for {Node Label} autocomplete.
 * Also builds label→output maps for execution-time resolution.
 */

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { extractNodeOutputAsList } from "@/components/editor/workflow-editor/node-input-resolver"
import {
  resolveIndex,
  resolveNodeRefs,
  parseNodeRef,
  NODE_REF_PATTERN,
  RESERVED_TEMPLATE_VARS,
} from "@nodaro/shared"
import type { PromptSegment } from "@nodaro/shared"

export interface NodeRefItem {
  id: string
  label: string
  type: string
}

/**
 * BFS traversal to find all upstream ancestor nodes.
 * Returns nodes sorted by proximity (direct parents first).
 * Handles duplicate labels by appending "(2)", "(3)", etc.
 */
export function getUpstreamNodes(
  nodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): NodeRefItem[] {
  const visited = new Set<string>()
  const result: NodeRefItem[] = []
  const queue: string[] = []

  // Build lookups once (O(V+E)) so the BFS is O(V+E) overall instead of
  // O(V·(V+E)) from `nodes.find()` + a full `edges` scan per visited node.
  // `edgesByTarget` preserves each target's edges in original array order, so
  // seeding + traversal order — and thus the output — stays identical.
  const nodesById = new Map<string, WorkflowNode>()
  for (const n of nodes) nodesById.set(n.id, n)
  const edgesByTarget = new Map<string, WorkflowEdge[]>()
  for (const edge of edges) {
    const bucket = edgesByTarget.get(edge.target)
    if (bucket) bucket.push(edge)
    else edgesByTarget.set(edge.target, [edge])
  }

  // Start with direct parents
  for (const edge of edgesByTarget.get(nodeId) ?? []) {
    if (!visited.has(edge.source)) {
      visited.add(edge.source)
      queue.push(edge.source)
    }
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!
    const node = nodesById.get(currentId)
    if (!node) continue

    const data = node.data as Record<string, unknown>
    const label = (data.label as string) || node.type || currentId

    result.push({
      id: currentId,
      label,
      type: node.type as string,
    })

    // Add parents of current node
    for (const edge of edgesByTarget.get(currentId) ?? []) {
      if (!visited.has(edge.source)) {
        visited.add(edge.source)
        queue.push(edge.source)
      }
    }
  }

  // Handle duplicate labels by appending suffix
  const labelCount = new Map<string, number>()
  for (const item of result) {
    labelCount.set(item.label, (labelCount.get(item.label) ?? 0) + 1)
  }
  const labelSeen = new Map<string, number>()
  for (const item of result) {
    if ((labelCount.get(item.label) ?? 0) > 1) {
      const seen = (labelSeen.get(item.label) ?? 0) + 1
      labelSeen.set(item.label, seen)
      if (seen > 1) {
        item.label = `${item.label} (${seen})`
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// List-like node helpers for buildNodeRefMap edge-aware output extraction
// ---------------------------------------------------------------------------

const LIST_LIKE_TYPES = new Set(["list", "split-text"])

/** Return the edge's outputMode + itemIndex, defaulting to "each" for list-like nodes. */
function getEdgeOutputMode(
  connectingEdges: ReadonlyArray<WorkflowEdge>,
): { mode: string; itemIndex?: string } {
  for (const edge of connectingEdges) {
    const ed = edge.data as Record<string, unknown> | undefined
    const mode = ed?.outputMode as string | undefined
    if (mode) return { mode, itemIndex: ed?.itemIndex as string | undefined }
  }
  return { mode: "each" }
}

/** Parse the list of items from a list/loop/split-text node's data.
 *  Delegates to extractNodeOutputAsList so connected/legacy/format permutations
 *  behave the same way as the runtime executor and the list-node UI. */
function extractListItems(node: WorkflowNode): string[] {
  return extractNodeOutputAsList(node) ?? []
}

/** Resolve a list of items using the given output mode + 1-based itemIndex. */
function resolveListOutput(
  items: string[],
  mode: string,
  itemIndex?: string,
): string | undefined {
  if (items.length === 0) return undefined
  if (mode === "last") return items[items.length - 1]
  if (mode === "item") {
    // New format: outputMode="item" + itemIndex="1"|"2"|"last" (1-based, supports last/last-N)
    const idx = resolveIndex(itemIndex ?? "1", items.length)
    return items[idx] ?? items[0]
  }
  if (mode.startsWith("item:")) {
    // Legacy format: outputMode="item:0" (0-based index baked into the mode string)
    const idx = parseInt(mode.split(":")[1], 10)
    return items[idx] ?? items[0]
  }
  if (mode === "all") return items.join(", ")
  // "each" — return first item; fan-out clones get their own item via execution engine
  return items[0]
}

/**
 * Build a label→output map for resolving {Node Label} refs at execution time.
 * Uses BFS with edge tracking so list/loop/split-text nodes respect the
 * connecting edge's outputMode (e.g. "item:1", "last", "all").
 */
export function buildNodeRefMap(
  nodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): Map<string, string> {
  const map = new Map<string, string>()
  const visited = new Set<string>()
  const queue: Array<{
    id: string
    connectingEdges: ReadonlyArray<WorkflowEdge>
  }> = []

  // Seed BFS with direct parents, grouping edges by source
  const seedEdges = new Map<string, WorkflowEdge[]>()
  for (const edge of edges) {
    if (edge.target === nodeId) {
      if (!seedEdges.has(edge.source)) seedEdges.set(edge.source, [])
      seedEdges.get(edge.source)!.push(edge)
    }
  }
  for (const [sourceId, edgeGroup] of seedEdges) {
    visited.add(sourceId)
    queue.push({ id: sourceId, connectingEdges: edgeGroup })
  }

  // Collect results for duplicate-label handling
  const results: Array<{ label: string; output: string }> = []

  while (queue.length > 0) {
    const { id: currentId, connectingEdges } = queue.shift()!
    const node = nodes.find((n) => n.id === currentId)
    if (!node) continue

    const data = node.data as Record<string, unknown>
    const label = (data.label as string) || node.type || currentId

    // List-like nodes always go through list extraction (even "each" is not
    // regular behavior — it's fan-out, so the ref should resolve via items)
    let output: string | undefined
    if (LIST_LIKE_TYPES.has(node.type as string)) {
      const { mode, itemIndex } = getEdgeOutputMode(connectingEdges)
      const items = extractListItems(node)
      output = resolveListOutput(items, mode, itemIndex)
    }
    // All other nodes use default extraction
    if (output === undefined) {
      output = extractNodeOutput(node)
    }

    if (output) results.push({ label, output })

    // BFS: traverse to parents of current node
    const nextEdges = new Map<string, WorkflowEdge[]>()
    for (const edge of edges) {
      if (edge.target === currentId && !visited.has(edge.source)) {
        if (!nextEdges.has(edge.source)) nextEdges.set(edge.source, [])
        nextEdges.get(edge.source)!.push(edge)
      }
    }
    for (const [sourceId, edgeGroup] of nextEdges) {
      visited.add(sourceId)
      queue.push({ id: sourceId, connectingEdges: edgeGroup })
    }
  }

  // Duplicate label handling (same logic as getUpstreamNodes)
  const labelCount = new Map<string, number>()
  for (const r of results) {
    labelCount.set(r.label, (labelCount.get(r.label) ?? 0) + 1)
  }
  const labelSeen = new Map<string, number>()
  for (const r of results) {
    let key = r.label
    if ((labelCount.get(r.label) ?? 0) > 1) {
      const seen = (labelSeen.get(r.label) ?? 0) + 1
      labelSeen.set(r.label, seen)
      if (seen > 1) key = `${r.label} (${seen})`
    }
    map.set(key, r.output)
  }

  return map
}

/**
 * Resolve {Node Label} references in a text string.
 * Returns the original text if no refs are found or refMap is empty.
 */
export function resolveTextRefs(
  text: string | undefined,
  refMap: Map<string, string>,
): string | undefined {
  if (!text || refMap.size === 0) return text
  return resolveNodeRefs(text, refMap)
}

/**
 * Segment-emitting twin of {@link resolveTextRefs}: identical replacement
 * semantics, but each resolved `{Node Label}` value is tagged `origin:
 * "variable"` while surrounding literal text (and dormant `{name || fallback}`
 * defaults — author-typed, not a resolved node value) stays `origin: "user"`.
 *
 * INVARIANT (guarded by node-refs-segments.test.ts):
 *   segments.map(s => s.text).join("") === resolveTextRefs(text, refMap)
 *
 * Built on the SAME primitives as `resolveNodeRefs` ({@link NODE_REF_PATTERN},
 * {@link parseNodeRef}, {@link RESERVED_TEMPLATE_VARS}) so it can never drift
 * from the source of truth. `resolveNodeRefs` iterates to a fixed point for
 * nested refs (`{List}` → `{Animal1}` → "dog"); we mirror that by fully
 * resolving each emitted dynamic value through `resolveNodeRefs`, so a
 * variable segment's text equals exactly what the fixed point produces.
 */
export function resolveTextRefsSegments(
  text: string,
  refMap: ReadonlyMap<string, string>,
): PromptSegment[] {
  if (!text) return []
  const out: PromptSegment[] = []
  const pushUser = (t: string) => {
    if (!t) return
    const prev = out[out.length - 1]
    if (prev && prev.origin === "user") out[out.length - 1] = { text: prev.text + t, origin: "user" }
    else out.push({ text: t, origin: "user" })
  }
  // Mutable map view so nested resolution behaves identically to resolveNodeRefs
  // (which takes a ReadonlyMap and never mutates). resolveNodeRefs accepts a
  // ReadonlyMap, so this is just a typed reuse of the same instance.
  const re = new RegExp(NODE_REF_PATTERN.source, "g")
  let last = 0
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0
    const { name, fallback } = parseNodeRef(m[1])
    if (RESERVED_TEMPLATE_VARS.has(name)) {
      // resolveNodeRefs leaves reserved vars literal — fold into the gap push.
      continue
    }
    const output = refMap.get(name)
    if (output !== undefined) {
      // Connected output (even empty string) → resolved value, tagged variable.
      pushUser(text.slice(last, idx))
      // Nested refs inside the value expand to the same fixed point.
      out.push({ text: resolveNodeRefs(output, refMap), origin: "variable" })
      last = idx + m[0].length
    } else if (fallback !== null) {
      // Absent/empty + `|| fallback` → the author-typed default (user text).
      pushUser(text.slice(last, idx))
      pushUser(resolveNodeRefs(fallback, refMap))
      last = idx + m[0].length
    }
    // Absent + no `||` → literal `{name}`: left for the next gap push.
  }
  pushUser(text.slice(last))
  return out
}
