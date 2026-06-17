/**
 * Estimate the credit cost of running a set of executable nodes — the single
 * source of truth for the Execute-workflow button badge, the pre-run credit
 * precheck, and the run-confirmation gate (>100cr). Uses the fan-out multiplier
 * so list-driven runs are counted.
 *
 * The per-model cached cost is injected (`cachedCost`) rather than imported, so
 * this stays in CORE — the live-cost cache lives under `@/ee` (credits are an
 * enterprise concern) and only the already-allowlisted callers reach into it.
 */
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { NODE_CREDIT_COSTS, getFanOutMultiplier } from "./types"

export function estimateRunCredits(
  executable: WorkflowNode[],
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  cachedCost: (modelId: string) => number | undefined,
): number {
  return executable.reduce((sum, node) => {
    const cached = cachedCost(getModelIdentifier(node))
    const cost = cached !== undefined ? cached : (NODE_CREDIT_COSTS[node.type ?? ""] ?? 1)
    return sum + cost * getFanOutMultiplier(node, allNodes, edges)
  }, 0)
}
