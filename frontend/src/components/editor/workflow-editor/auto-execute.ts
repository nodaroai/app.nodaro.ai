/**
 * Auto-execute logic for zero-cost inline nodes (combine-text, split-text, extract-field).
 *
 * Two triggers:
 *  1. Config change — handled by the `useAutoExecute` hook in each node component.
 *  2. Upstream completion — `cascadeAutoExecute(nodeId)` called after any node finishes.
 */

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { extractNodeOutput } from "./execution-graph"
import { executeNode } from "./execute-node"
import type { ExecutionContext } from "./types"
import type { WorkflowNode } from "@/types/nodes"

const noop = () => {}

/** Minimal ctx for inline-only execution (combine-text, split-text, extract-field don't use ctx). */
const INLINE_CTX: ExecutionContext = {
  userId: undefined,
  projectId: undefined,
  trackInterval: (i) => i,
  untrackInterval: noop,
  save: () => Promise.resolve(),
  setIsRunning: noop,
  isWorkflowStale: () => false,
  isStorageError: () => false,
  setShowStorageExceeded: noop,
  setStorageExceededData: noop,
  setShowInsufficientCredits: noop,
  setInsufficientCreditsData: noop,
}

/** Precomputed from NODE_DEFINITIONS — O(1) lookup. */
const AUTO_EXECUTE_TYPES = new Set(
  NODE_DEFINITIONS.filter((d) => d.autoExecute).map((d) => d.type),
)

/** Display-only nodes that read upstream data reactively (list, loop, preview). */
const REACTIVE_DISPLAY_TYPES = new Set(["list", "loop", "preview"])

/**
 * Execute a single auto-execute node if it has upstream data.
 * Does NOT save the workflow or toggle global isRunning — this is a lightweight inline run.
 * @param visited  Cycle protection set — prevents infinite loops in cyclic graphs.
 */
export function autoExecuteNode(nodeId: string, visited = new Set<string>()): void {
  if (visited.has(nodeId)) return
  visited.add(nodeId)

  const { nodes, edges } = useWorkflowStore.getState()
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const node = nodeMap.get(nodeId)
  if (!node) return
  if (!AUTO_EXECUTE_TYPES.has(node.type ?? "")) return

  const data = node.data as Record<string, unknown>
  if (data.executionStatus === "running") return

  // Must have at least one upstream connection
  const inEdges = edges.filter((e) => e.target === nodeId)
  if (inEdges.length === 0) return

  // At least one upstream must have output data
  const hasUpstreamData = inEdges.some((e) => {
    const src = nodeMap.get(e.source)
    if (!src) return false
    const srcData = src.data as Record<string, unknown>
    return (
      extractNodeOutput(src) !== undefined ||
      srcData.generatedJson !== undefined ||
      (srcData.__listResults as unknown[] | undefined)?.length
    )
  })
  if (!hasUpstreamData) return

  executeNode(node as WorkflowNode, INLINE_CTX)
    .then(() => cascadeAutoExecute(nodeId, visited))
    .catch(() => {
      /* errors are handled inside executeNode via updateNodeData */
    })
}

/**
 * After a node completes execution, trigger any downstream auto-execute nodes
 * and refresh downstream display-only nodes (list, loop, preview).
 * @param visited  Cycle protection set — shared across the cascade chain.
 */
export function cascadeAutoExecute(completedNodeId: string, visited = new Set<string>()): void {
  const { nodes, edges, updateNodeData } = useWorkflowStore.getState()
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const outEdges = edges.filter((e) => e.source === completedNodeId)

  for (const edge of outEdges) {
    const target = nodeMap.get(edge.target)
    if (!target) continue

    if (AUTO_EXECUTE_TYPES.has(target.type ?? "")) {
      autoExecuteNode(target.id, visited)
    } else if (REACTIVE_DISPLAY_TYPES.has(target.type ?? "")) {
      // Touch the node to force Zustand subscribers (useMemo in list/loop/preview)
      // to recalculate with the fresh upstream data.
      updateNodeData(target.id, { _upstreamRefresh: Date.now() })
    }
  }
}
