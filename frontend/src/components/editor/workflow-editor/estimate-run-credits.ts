/**
 * Estimate the credit cost of running a set of executable nodes — the single
 * source of truth for the Execute-workflow button badge (`estimateWholeRun`),
 * the pre-run credit precheck, the run-confirmation gate, the Run-from-here
 * price and the app runner's live estimate (`computeLiveRunEstimate`, which
 * prices the user's inputs through `estimateWholeRun`). Uses the COST
 * multiplier (fan-out × repeat × per-output-minute units), and each of several
 * providers on a node at its own price, so list-driven runs, multi-provider
 * nodes and per-minute renders are priced for everything they will reserve —
 * this number gates the run. The stored listing and the server's run estimate
 * read the same rules.
 *
 * The ids to fetch prices for come from here too (`runModelIds`): each of
 * several providers' own, or a cold cache prices the second provider at the
 * coarse node-type row.
 *
 * The per-model cached cost is injected (`cachedCost`) rather than imported, so
 * this stays in CORE — the live-cost cache lives under `@/ee` (credits are an
 * enterprise concern) and only the already-allowlisted callers reach into it.
 */
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { nodeTypeDefaultLabel } from "@/components/editor/config-panel-label"
import { NODE_CREDIT_COSTS, estimateNodeCredits, getCostFactors, isExecutableNode, type RunCreditLine } from "./types"
import { previewRunnable } from "./preview-gate"
import { nodeProviders } from "@nodaro/render-rules"
import { isExpandedClone } from "@nodaro/shared"
import { speechUnitIdsFor } from "@/lib/speech-estimate"

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
    // Several providers on one node: each runs, at its own price — the run's
    // own expansion, read through `@nodaro/render-rules`' `nodeProviders`, the
    // rule the stored listing and the server's run estimate read too (decided
    // 2026-10-07). Still one line per node: its credits are their sum.
    const variants = providerVariants(node)
    const cost = variants.reduce((sum, v) => sum + oneRunCost(v, allNodes, edges, rerunIds, cachedCost), 0)
    // Both factors of the cost multiplier: fan-out × per-unit (e.g. minutes).
    const quantity = getCostFactors(node, allNodes, edges, rerunIds)
    return { nodeId: node.id, label: runNodeLabel(node), quantity, credits: cost * quantity.fanOut * quantity.units }
  })
}

/** The node once per provider it runs (`nodeProviders`), else the node itself. */
function providerVariants(node: WorkflowNode): WorkflowNode[] {
  return nodeProviders(node.type, node.data as Record<string, unknown>)
    ?.map((provider) => ({ ...node, data: { ...node.data, provider } }) as WorkflowNode) ?? [node]
}

/**
 * The credit ids a run of `executable` is priced at — each of several
 * providers' own — plus a speech node's unit row (until it is cached,
 * `getModelIdentifier` quotes the flat row, so a surface could never learn
 * that the server prices speech by length). What every surface that prices
 * a run fetches before it computes again.
 */
export function runModelIds(
  executable: WorkflowNode[],
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] {
  const runs = previewRunnable(executable, allNodes, edges)
  const rerunIds = new Set(executable.map((n) => n.id))
  return [...new Set([
    ...runs.flatMap((n) => providerVariants(n).map((v) => getModelIdentifier(v, edges, allNodes, rerunIds))),
    ...speechUnitIdsFor(runs, allNodes, edges),
  ].filter(Boolean))]
}

/**
 * The provider ids a saved workflow names — each of several providers on a
 * node, not only `data.provider` — for the price prefetch on load.
 */
export function savedProviderIds(nodes: ReadonlyArray<Pick<WorkflowNode, "type" | "data">>): string[] {
  return [...new Set(nodes.flatMap((n) => {
    const data = n.data as Record<string, unknown>
    const provider = typeof data.provider === "string" && data.provider !== "" ? [data.provider] : []
    return [...provider, ...(nodeProviders(n.type, data) ?? [])]
  }))]
}

/**
 * A whole-workflow run (every executable node re-runs, planners included;
 * a Preview render still gates what follows it): its estimate with the prices
 * cached now, and the ids still to fetch. The Execute-workflow badge, and the
 * app runner's live estimate over the user's inputs, are this.
 */
export function estimateWholeRun(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  cachedCost: (modelId: string) => number | undefined,
  /** The server has reported this id priced nowhere: not asked again. */
  isModelUnpriced: (modelId: string) => boolean = () => false,
): { total: number; uncachedModelIds: string[] } {
  const executable = nodes.filter((n) => isExecutableNode(n) && !isExpandedClone(n))
  return {
    total: estimateRunCredits(executable, nodes, edges, cachedCost),
    uncachedModelIds: runModelIds(executable, nodes, edges).filter((m) => cachedCost(m) === undefined && !isModelUnpriced(m)),
  }
}

/** The price of one unit of one run of `node` (one provider). */
function oneRunCost(
  node: WorkflowNode,
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  rerunIds: ReadonlySet<string>,
  cachedCost: (modelId: string) => number | undefined,
): number {
  const modelId = getModelIdentifier(node, edges, allNodes, rerunIds)
  const cached = cachedCost(modelId)
  if (cached !== undefined) return cached
  // Cold cache: prefer the row for the identifier this run will actually
  // reserve on. `getModelIdentifier` is already renderer- and graph-aware
  // (add-captions:kinetic vs add-captions), so skipping straight to the node
  // type quoted the cheap variant's price for a run that reserves the dear one.
  const row = NODE_CREDIT_COSTS[modelId]
  if (row !== undefined) return row
  // Then the node's own estimate (a Component's published price, a Video
  // Analysis bucket, …) — what the badge and the app runner always read, so
  // the confirm cannot quote a different cold-cache figure (decided
  // 2026-10-07). A node priced nowhere keeps the 1-credit floor.
  const own = estimateNodeCredits({ id: node.id, type: node.type, data: node.data as Record<string, unknown> }, edges, allNodes, rerunIds)
  return own > 0 ? own : (NODE_CREDIT_COSTS[node.type ?? ""] ?? 1)
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
