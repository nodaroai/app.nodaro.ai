/**
 * Node reference helpers for the frontend.
 * Finds upstream ancestor nodes for {Node Label} autocomplete.
 * Also builds label→output maps for execution-time resolution.
 */

import type { WorkflowNode, WorkflowEdge, LoopNodeData } from "@/types/nodes"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { resolveNodeRefs } from "@nodaro-shared/node-refs"

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

  // Start with direct parents
  for (const edge of edges) {
    if (edge.target === nodeId && !visited.has(edge.source)) {
      visited.add(edge.source)
      queue.push(edge.source)
    }
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!
    const node = nodes.find((n) => n.id === currentId)
    if (!node) continue

    const data = node.data as Record<string, unknown>
    const label = (data.label as string) || node.type || currentId

    result.push({
      id: currentId,
      label,
      type: node.type as string,
    })

    // Add parents of current node
    for (const edge of edges) {
      if (edge.target === currentId && !visited.has(edge.source)) {
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

const LIST_LIKE_TYPES = new Set(["list", "loop", "split-text"])

/** Return the outputMode from connecting edges, defaulting to "each" for list-like nodes. */
function getEdgeOutputMode(
  connectingEdges: ReadonlyArray<WorkflowEdge>,
): string {
  for (const edge of connectingEdges) {
    const mode = (edge.data as Record<string, unknown> | undefined)
      ?.outputMode as string | undefined
    if (mode) return mode
  }
  return "each"
}

/** Parse the list of items from a list/loop/split-text node's data. */
function extractListItems(node: WorkflowNode): string[] {
  const data = node.data as Record<string, unknown>
  if (node.type === "list") {
    // New format: columns + rows (same as loop)
    const listCols = (data as LoopNodeData).columns
    if (listCols) {
      const rows = (data as LoopNodeData).rows
      return (rows ?? []).map((r) => r[0]?.trim() ?? "").filter(Boolean)
    }
    // Legacy format: items string
    return ((data.items as string) || "")
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0)
  }
  if (node.type === "loop") {
    const rows = (data as LoopNodeData).rows
    return (rows ?? []).map((r) => r[0]?.trim() ?? "").filter(Boolean)
  }
  if (node.type === "split-text") {
    return (data.splitResults as string[] | undefined) ?? []
  }
  return []
}

/** Resolve a list of items using the given output mode. */
function resolveListOutput(
  items: string[],
  mode: string,
): string | undefined {
  if (items.length === 0) return undefined
  if (mode === "last") return items[items.length - 1]
  if (mode.startsWith("item:")) {
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
      const mode = getEdgeOutputMode(connectingEdges)
      const items = extractListItems(node)
      output = resolveListOutput(items, mode)
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
