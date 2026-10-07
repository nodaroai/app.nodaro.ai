/**
 * Estimate the credit cost of running a set of executable nodes — the single
 * source of truth for the Execute-workflow button badge, the pre-run credit
 * precheck, and the run-confirmation gate. Uses the COST multiplier (fan-out ×
 * repeat × per-output-minute units) so list-driven runs and per-minute renders
 * are priced for everything they will reserve — this number gates the run.
 *
 * The per-model cached cost is injected (`cachedCost`) rather than imported, so
 * this stays in CORE — the live-cost cache lives under `@/ee` (credits are an
 * enterprise concern) and only the already-allowlisted callers reach into it.
 */
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { nodeTypeDefaultLabel } from "@/components/editor/config-panel-label"
import { NODE_CREDIT_COSTS, getCostFactors, type RunCreditLine } from "./types"
import { previewRunnable } from "./preview-gate"

/**
 * A node's name as a confirm shows it: its label, or — when it has none — its
 * type's default label ("Apply EDL", never "apply-edl"). Still the stored
 * English string: the dialog localizes it at render, as the canvas header does.
 */
export function runNodeLabel(node: Pick<WorkflowNode, "type" | "data">): string {
  const label = (node.data as { label?: unknown } | undefined)?.label
  return typeof label === "string" && label.trim() !== "" ? label : nodeTypeDefaultLabel(node.type ?? "")
}

/**
 * One line per node the run executes: its label, how many times it runs and
 * how many units each run prices, and its credits. The total
 * (`estimateRunCredits`) is the sum of these lines — one code path, so the
 * Render final confirm's breakdown can never disagree with its total
 * (U1, decided 2026-10-06).
 */
export function estimateRunCreditLines(
  executable: WorkflowNode[],
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  cachedCost: (modelId: string) => number | undefined,
): RunCreditLine[] {
  // A run stops at a Preview render: what it gates never runs and is never
  // billed in this run, so it is never priced here either.
  const runs = previewRunnable(executable, allNodes, edges)
  // The executable set is exactly what re-runs: an upstream planner inside it
  // re-plans (its canvas result is stale); one outside it keeps its result, so a
  // single-node / run-from-here render is priced on the plan that will render.
  const rerunIds = new Set(executable.map((n) => n.id))
  return runs.map((node) => {
    const modelId = getModelIdentifier(node, edges, allNodes, rerunIds)
    const cached = cachedCost(modelId)
    // Cold cache: prefer the row for the identifier this run will actually
    // reserve on, and only then the coarse node-type row. `getModelIdentifier`
    // is already renderer- and graph-aware (add-captions:kinetic vs
    // add-captions), so skipping straight to the node type quoted the cheap
    // variant's price for a run that reserves the dear one.
    const cost = cached !== undefined
      ? cached
      : (NODE_CREDIT_COSTS[modelId] ?? NODE_CREDIT_COSTS[node.type ?? ""] ?? 1)
    // Both factors of the cost multiplier: fan-out × per-unit (e.g. minutes).
    const quantity = getCostFactors(node, allNodes, edges, rerunIds)
    return { nodeId: node.id, label: runNodeLabel(node), quantity, credits: cost * quantity.fanOut * quantity.units }
  })
}

/** The total of a run's lines. */
export function sumRunCreditLines(lines: readonly RunCreditLine[]): number {
  return lines.reduce((sum, line) => sum + line.credits, 0)
}

export function estimateRunCredits(
  executable: WorkflowNode[],
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  cachedCost: (modelId: string) => number | undefined,
): number {
  return sumRunCreditLines(estimateRunCreditLines(executable, allNodes, edges, cachedCost))
}
