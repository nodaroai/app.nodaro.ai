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
import { usecaseMulticamOffered } from "@/lib/use-case-multicam-viewer"
import { usecaseFramesWithheld } from "@/lib/use-case-frames-viewer"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { nodeTypeDefaultLabel } from "@/components/editor/config-panel-label"
import { NODE_CREDIT_COSTS, estimateNodeCredits, getCostFactors, isExecutableNode, type RunCreditLine, type RunCreditQuantity } from "./types"
import { previewRunnable } from "./preview-gate"
import { nodeProviders } from "@nodaro/render-rules"
import { isExpandedClone } from "@nodaro/shared/workflow"
import { USE_CASE_FEE_STATIC_CREDITS, expandUseCaseNodes, isUseCaseNodeType, usecaseFeeCreditId, withUseCaseMembers, type UseCaseExpansion } from "@nodaro/render-rules"
import { speechPriceIdsFor } from "@/lib/speech-estimate"
import { unitQuoteIdFor, upperUnits } from "@/lib/unit-quote"
import { carriedEdges } from "./carried-edges"
import { seedanceRefQuoteKeyFor } from "@/lib/seedance-ref-quote"
// @registry-lookup prices each node of a run by its own type (NODE_CREDIT_COSTS / estimateNodeCredits)

/** The units a run is priced at, exactly: the factors' whole units unless they carry fractional ones. */
function exactUnitsOf(quantity: RunCreditQuantity): number {
  return quantity.exactUnits ?? quantity.units
}

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
  rawEdges: WorkflowEdge[],
  cachedCost: (modelId: string) => number | undefined,
): RunCreditLine[] {
  // A use-case node is priced as the chain it builds plus its fee, on the
  // expanded graph (the server's own expansion) — use-case lines below.
  const expanded = expandedForEditor(allNodes, rawEdges)
  if (expanded) return usecaseRunLines(executable, allNodes, rawEdges, expanded, cachedCost)
  // Priced on the graph the run executes: a Teleport pair passes on exactly
  // what entered it (carried-edges.ts; the server estimate does the same).
  const edges = carriedEdges(allNodes, rawEdges)
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
    // A per-unit node (minutes of a render, seconds of a retake, …) is priced
    // as the WHOLE run the server charges — its `<rate>:<units>u` price, never
    // the one-unit price × the units, which rounds up per unit.
    const quantity = getCostFactors(node, allNodes, edges, rerunIds)
    const cost = variants.reduce((sum, v) => sum + oneRunCost(v, allNodes, edges, rerunIds, cachedCost, exactUnitsOf(quantity)), 0)
    // Both factors are shown by the confirm; the units are already in `cost`.
    return { nodeId: node.id, label: runNodeLabel(node), quantity, credits: cost * quantity.fanOut }
  })
}

/** The node once per provider it runs (`nodeProviders`), else the node itself. */
function providerVariants(node: WorkflowNode): WorkflowNode[] {
  return nodeProviders(node.type, node.data as Record<string, unknown>)
    ?.map((provider) => ({ ...node, data: { ...node.data, provider } }) as WorkflowNode) ?? [node]
}

/**
 * The credit ids a run of `executable` is priced at — each of several
 * providers' own — plus a speech node's unit row and the price of its whole
 * request (until they are cached, `getModelIdentifier` quotes the flat row, so
 * a surface could never learn that the server prices speech by length, nor
 * what it charges). What every surface that prices a run fetches before it
 * computes again.
 */
export function runModelIds(
  executable: WorkflowNode[],
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] {
  // A use-case node: its chain's ids on the expanded graph, and its fee's.
  const expanded = expandedForEditor(allNodes, edges)
  if (expanded) {
    return [...new Set([
      ...runModelIds(expandedRun(executable, expanded), expanded.nodes, expanded.edges),
      ...executable.flatMap((n) => (isUseCaseNodeType(n.type) && paysFee(expanded, n.id) ? [usecaseFeeCreditId(n.type)] : [])),
    ])]
  }
  const runs = previewRunnable(executable, allNodes, edges)
  const rerunIds = new Set(executable.map((n) => n.id))
  return [...new Set([
    ...runs.flatMap((n) => {
      const units = exactUnitsOf(getCostFactors(n, allNodes, edges, rerunIds))
      return providerVariants(n).flatMap((v) => {
        const id = getModelIdentifier(v, edges, allNodes, rerunIds)
        // A per-unit run: also the whole run's price — the figure it is charged.
        // A Seedance reference-video run: its quote, which the server prices
        // from the probed clips (`lib/seedance-ref-quote.ts`).
        return [id, unitQuoteIdFor(id, units), seedanceRefQuoteKeyFor(v, allNodes, edges, rerunIds)]
      })
    }),
    ...speechPriceIdsFor(runs, allNodes, edges),
  ].filter((id): id is string => Boolean(id)))]
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

/** The nodes a whole-workflow run executes before the stop rule: every executable node, never an expanded clone. */
export function wholeRunExecutable(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.filter((n) => isExecutableNode(n) && !isExpandedClone(n))
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
  const executable = wholeRunExecutable(nodes)
  return {
    total: estimateRunCredits(executable, nodes, edges, cachedCost),
    uncachedModelIds: runModelIds(executable, nodes, edges).filter((m) => cachedCost(m) === undefined && !isModelUnpriced(m)),
  }
}

/**
 * The price of one run of `node` (one provider) at `units` of its price row:
 * the server's price for the whole run when it is cached (what the run is
 * charged — marked up and rounded up once), else one unit's price × the units
 * rounded up, never below it.
 */
function oneRunCost(
  node: WorkflowNode,
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  rerunIds: ReadonlySet<string>,
  cachedCost: (modelId: string) => number | undefined,
  units: number,
): number {
  // A Seedance run with reference video(s) is billed input + output seconds:
  // the server's quote from the probed clips is what it reserves (with a clip
  // not produced yet, the most it can reserve). Uncached → the row below.
  const refQuoteKey = seedanceRefQuoteKeyFor(node, allNodes, edges, rerunIds)
  const refQuote = refQuoteKey === undefined ? undefined : cachedCost(refQuoteKey)
  if (refQuote !== undefined) return refQuote * upperUnits(units)
  const modelId = getModelIdentifier(node, edges, allNodes, rerunIds)
  const quoteId = unitQuoteIdFor(modelId, units)
  const whole = quoteId === undefined ? undefined : cachedCost(quoteId)
  if (whole !== undefined) return whole
  return oneUnitCost(node, modelId, allNodes, edges, rerunIds, cachedCost) * upperUnits(units)
}

/** The price of one unit of one run of `node` (one provider), priced at `modelId`. */
function oneUnitCost(
  node: WorkflowNode,
  modelId: string,
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  rerunIds: ReadonlySet<string>,
  cachedCost: (modelId: string) => number | undefined,
): number {
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

// ---------------------------------------------------------------------------
// Use-case nodes (Tighten Episode, decided 2026-10-13)
// ---------------------------------------------------------------------------

interface ExpandedGraph {
  readonly expansion: UseCaseExpansion<WorkflowNode, WorkflowEdge>
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
}

/**
 * The graph with every use-case node replaced by the chain it builds, wired to
 * its real source — `@nodaro/render-rules`' `expandUseCaseNodes`, the one
 * expansion the server's run estimate and the listing read too, at its default
 * (`first-run`: a review-on node up to its preview; a node running its Render
 * final: its final chain from the render on, no fee). In the editor's node and
 * edge shape (inner ids are `<node>::<id>`). `null` when there is none.
 */
function expandedForEditor(nodes: WorkflowNode[], edges: WorkflowEdge[]): ExpandedGraph | null {
  // Several recordings and a master only for a viewer who may use Speaker Map, an `auto` framing source as
  // the even split only for one Speaker Frames is withheld from: the run reads what the quote prices.
  const expansion = expandUseCaseNodes(nodes, edges, { multicam: usecaseMulticamOffered(), ...(usecaseFramesWithheld() ? { framesWithheld: true } : {}) })
  if (!expansion.expanded) return null
  return {
    expansion,
    nodes: expansion.nodes.map((n) => ("position" in n ? n : ({ ...n, position: { x: 0, y: 0 } } as unknown as WorkflowNode))),
    edges: expansion.edges.map((e, i) => ("id" in e && e.id ? e : ({ ...e, id: `uc-x-${i}` } as unknown as WorkflowEdge))),
  }
}

/** Whether the run of use-case node `nodeId` pays its fee (a Render final does not: the run it finishes did). */
const paysFee = (expanded: ExpandedGraph, nodeId: string): boolean => expanded.expansion.fees.some((f) => f.nodeId === nodeId)

/**
 * What a run of `executable` executes on the expanded graph: a use-case node's
 * inner steps in its place. Only executable steps — an unwired node keeps its
 * placeholder recording, which hands on a file and runs nothing (the server
 * prices it at nothing too).
 */
function expandedRun(executable: WorkflowNode[], expanded: ExpandedGraph): WorkflowNode[] {
  const runIds = withUseCaseMembers(new Set(executable.map((n) => n.id)), expanded.expansion.members)
  return expanded.nodes.filter((n) => runIds.has(n.id) && isExecutableNode(n))
}

/**
 * The run's lines on the expanded graph, a use-case node's inner steps folded
 * into ONE line of its own: its steps (each at the runs it makes — an Each wire
 * into the node fans its steps out already) plus its fee once per run the node
 * makes (the server's `usecaseFeesTotal`) — none for a Render final, which
 * finishes a run that paid it. Every other node keeps its line,
 * priced on the expanded graph — a step after the node reads the chain's render.
 */
function usecaseRunLines(
  executable: WorkflowNode[],
  allNodes: WorkflowNode[],
  rawEdges: WorkflowEdge[],
  expanded: ExpandedGraph,
  cachedCost: (modelId: string) => number | undefined,
): RunCreditLine[] {
  const inner = new Map(
    estimateRunCreditLines(expandedRun(executable, expanded), expanded.nodes, expanded.edges, cachedCost).map((l) => [l.nodeId, l] as const),
  )
  const edges = carriedEdges(allNodes, rawEdges)
  const rerunIds = new Set(executable.map((n) => n.id))
  return executable.flatMap((node): RunCreditLine[] => {
    const type = node.type
    if (!isUseCaseNodeType(type)) {
      const line = inner.get(node.id)
      return line ? [line] : []
    }
    const steps = (expanded.expansion.members.get(node.id) ?? []).reduce((sum, id) => sum + (inner.get(id)?.credits ?? 0), 0)
    const quantity = { ...getCostFactors(node, allNodes, edges, rerunIds), units: 1, unitKind: null }
    const feeId = usecaseFeeCreditId(type)
    const fee = !paysFee(expanded, node.id) ? 0 : cachedCost(feeId) ?? NODE_CREDIT_COSTS[feeId] ?? USE_CASE_FEE_STATIC_CREDITS
    return [{ nodeId: node.id, label: runNodeLabel(node), quantity, credits: steps + fee * quantity.fanOut }]
  })
}

/**
 * What a Run of use-case node `nodeId` alone is quoted at — its line of the
 * run's own estimate, so the node's pill and Run button, the Execute badge,
 * the confirm and the precheck can never disagree. 0 for any other node.
 */
export function usecaseNodeCredits(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  cachedCost: (modelId: string) => number | undefined,
): number {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || !isUseCaseNodeType(node.type)) return 0
  return estimateRunCreditLines([node], nodes, edges, cachedCost).find((l) => l.nodeId === nodeId)?.credits ?? 0
}
