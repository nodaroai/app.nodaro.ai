/**
 * The UGC videos a run prices, as every server estimate reads them: the
 * editor's own rule (`ugcEstimateRunParts`, @nodaro/render-rules) — the parts
 * of the nodes the run executes, each times the runs of the node that executes
 * it (`nodeFanOut`, the rule the editor's run lines read). A run of the whole
 * graph: `ugcGraphVideos`. A run of a SUBSET (a Render final, a run of named
 * nodes, a continue-from-failed, an app run's Retry): `ugcRunSetVideos`.
 *
 * One difference from the editor, toward the pricier side: a script the run
 * leaves out hands on the plan of the run it continues, which the saved graph
 * does not always hold (a continuation seeds from the earlier run's state, and
 * a run's results are not written back to the graph). Every plan input that
 * can raise the price is therefore read at no less than either: the longer
 * length, the more screenshot cards, and both languages when they differ
 * (`neverUnder`).
 */
import {
  UGC_ESTIMATE_PARTS,
  nodeFanOut,
  ugcChainInput,
  ugcEstimateRunParts,
  type EstimateGraphNode,
  type FanOutGraphEdge,
  type UgcChain,
  type UgcEstimateInput,
  type UgcEstimatePart,
} from "@nodaro/render-rules"

interface GraphNode {
  readonly id?: string
  readonly type?: string | null
  readonly data?: unknown
}
interface GraphEdge {
  readonly source?: string
  readonly target?: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
  readonly data?: unknown
}

/** One part a run-set video prices: its node, its part, and how many times that node runs. */
export interface UgcRunSetPart {
  readonly id: string
  readonly part: UgcEstimatePart
  readonly runs: number
}

/** One video a run set executes some of. */
export interface UgcRunSetVideo {
  readonly chain: UgcChain
  /**
   * What its estimate is asked: one input, or two when the plan handed on and the script's setting
   * are in different languages (each part then takes the larger answer, `ugcVideoEstimate`).
   */
  readonly inputs: readonly [UgcEstimateInput, ...UgcEstimateInput[]]
  readonly parts: readonly UgcRunSetPart[]
}

/** How many times each node runs in a run that re-runs `rerunIds` (`nodeFanOut`); one run for none named. */
function runsReader(nodes: ReadonlyArray<GraphNode>, edges: ReadonlyArray<GraphEdge> | undefined, rerunIds: ReadonlySet<string>) {
  const gateNodes: EstimateGraphNode[] = nodes.flatMap((n) => (n.id ? [{ id: n.id, type: n.type, data: n.data }] : []))
  const gateEdges = (edges ?? []).flatMap((e) =>
    e.source && e.target ? [{ source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, data: e.data } as FanOutGraphEdge] : [],
  )
  const byId = new Map(gateNodes.map((n) => [n.id, n] as const))
  return (id: string | null): number => {
    const node = id === null ? undefined : byId.get(id)
    return node ? nodeFanOut(node, gateNodes, gateEdges, rerunIds) : 1
  }
}

/** A frozen node (`data.skipped`) does not run: it hands on what it holds. */
const isFrozen = (n: GraphNode): boolean => (n.data as { skipped?: unknown } | undefined)?.skipped === true

/**
 * The UGC videos a run of the WHOLE graph prices (the run estimate, the listing, an app run's
 * up-front check): every video's parts but a kept script's or creator's, each times the runs of the
 * node that executes it, as the editor prices a whole run. Each video's input is read as the graph
 * stands, or, with `overrides` (an app run's inputs), as the run reads it (`ugcChainInput`).
 */
export function ugcGraphVideos(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge> | undefined,
  opts: { readonly overrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>> } = {},
): UgcRunSetVideo[] {
  const run = ugcEstimateRunParts(nodes, nodes, edges)
  if (!run) return []
  // The nodes a whole run re-runs: every node but a frozen one, as the per-node sum reads it.
  const runsOf = runsReader(nodes, edges, new Set(nodes.flatMap((n) => (n.id !== undefined && !isFrozen(n) ? [n.id] : []))))
  return run.chains.map((c) => ({
    chain: c.chain,
    inputs: [ugcChainInput(c.chain, nodes, edges, opts.overrides ? { overrides: opts.overrides } : {}).input],
    parts: c.nodes.map((m) => ({ id: m.id, part: m.part, runs: runsOf(m.fanOutOf) })),
  }))
}

/** The figures of one video's estimate a price reads. */
export interface UgcVideoFigures {
  readonly parts: Readonly<Record<UgcEstimatePart, number>>
  readonly holdParts: Readonly<Record<UgcEstimatePart, number>>
  readonly estimateParts?: readonly UgcEstimatePart[]
}

/**
 * A video's figures: its one input's answer, or, with two inputs, each part (price and hold) at the
 * larger of the two answers, and a part marked an estimate when either answer marks it.
 */
export async function ugcVideoEstimate<T extends UgcVideoFigures>(
  inputs: UgcRunSetVideo["inputs"],
  ask: (input: UgcEstimateInput) => Promise<T>,
): Promise<UgcVideoFigures> {
  const answers: T[] = []
  for (const input of inputs) answers.push(await ask(input))
  if (answers.length === 1) return answers[0]!
  const max = (pick: (a: T) => Readonly<Record<UgcEstimatePart, number>>) =>
    Object.fromEntries(UGC_ESTIMATE_PARTS.map((p) => [p, Math.max(...answers.map((a) => pick(a)[p] ?? 0))])) as Record<UgcEstimatePart, number>
  const estimateParts = [...new Set(answers.flatMap((a) => a.estimateParts ?? []))]
  return { parts: max((a) => a.parts), holdParts: max((a) => a.holdParts), ...(estimateParts.length > 0 ? { estimateParts } : {}) }
}

/**
 * The inputs a video of a run set is asked with, never under what its script would write now: the
 * run's reading (`saved`: a script the run leaves out hands on the plan the graph holds) and the
 * reading with the script re-run (`now`: its length setting, the images wired now, its language
 * setting). Length and screenshot cards take the larger; a language that differs is asked both ways.
 */
function neverUnder(saved: UgcEstimateInput, now: UgcEstimateInput): UgcRunSetVideo["inputs"] {
  const numbers = {
    targetDurationSec: Math.max(saved.targetDurationSec, now.targetDurationSec),
    screenshotCount: Math.max(saved.screenshotCount, now.screenshotCount),
  }
  const first = { ...saved, ...numbers }
  return (saved.language ?? "en") === (now.language ?? "en") ? [first] : [first, { ...now, ...numbers }]
}

/** The UGC videos a run of `runNodeIds` executes some of, each with the parts it prices; empty when none. */
export function ugcRunSetVideos(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge> | undefined,
  runNodeIds: ReadonlySet<string>,
): UgcRunSetVideo[] {
  const executed = nodes.filter((n) => n.id !== undefined && runNodeIds.has(n.id))
  const run = ugcEstimateRunParts(executed, nodes, edges)
  if (!run) return []
  const runsOf = runsReader(nodes, edges, runNodeIds)
  return run.chains.map((c) => {
    // The plan handed on may be newer than the one the graph holds: never under the script re-run.
    const scriptId = c.chain.scriptId
    const now = ugcChainInput(c.chain, nodes, edges, { run: { executes: (id) => id === scriptId || runNodeIds.has(id) } }).input
    return { chain: c.chain, inputs: neverUnder(c.input, now), parts: c.nodes.map((m) => ({ id: m.id, part: m.part, runs: runsOf(m.fanOutOf) })) }
  })
}
