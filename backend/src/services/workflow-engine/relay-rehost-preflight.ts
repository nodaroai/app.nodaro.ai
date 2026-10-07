/**
 * The up-front re-host size scan of a run (SV12, decided 2026-10-06).
 *
 * On a self-host, Speaker View runs on nodaro.ai through the relay, which
 * re-hosts every private source of the edit (up to the 500 MB cap). A source
 * over the cap would fail that node only when its turn came — after a relayed
 * node upstream (Transcribe, Edit Plan, Camera Switch: billed on the
 * connected cloud account) had already charged. So the orchestrator asks the
 * same helper the route asks (`checkRehostSizes`) of every edit it can already
 * read, before ANY node dispatches, and refuses the run naming the node and
 * the source.
 *
 * Which edits are known at run start: an edit written on the node itself, and
 * an edit wired into its `edl` input from a node the run already holds (saved
 * data, a node outside "Run from here", a frozen node — the states the run
 * seeded before dispatch), including every clip of a saved clip batch. NOT
 * covered, by construction: an edit made DURING the run. A relayed producer
 * (Edit Plan, Camera Switch) hands back an edit whose sources nodaro.ai
 * already holds, so those never re-host; any other edit made mid-run is
 * checked by the relay worker itself, before it relays (and, when no size is
 * readable, by the in-rehost cap) — both naming the source the same way.
 *
 * Nested graphs are scanned too (`nestedRelayRehostRefusals`, over the graphs
 * `loadNestedRunGraphs` loads for the orchestrator's other up-front checks):
 * every Speaker View a sub-workflow in the run will execute, with the edits
 * that nested run can already read — one written on the node, or wired in
 * from a source node or a frozen node of the same graph (their saved data is
 * what the nested run hands on). NOT covered there, by construction: an edit
 * the parent passes in through the sub-workflow's input, or one a nested node
 * makes during the run (the relay worker checks both). A `component` is not a
 * nested graph of this run: it runs as its own execution, which scans itself.
 */
import { checkRehostSizes, rehostSizeMessage, type RehostByteSizeProbe } from "../../lib/rehost-size-check.js"
import { getEffectivelySkippedIds, isSourceNode } from "./execution-graph.js"
import { extractSavedNodeOutput, extractSourceNodeOutput, getPrimaryOutput } from "./output-extractor.js"
import { seededFromSavedData } from "./saved-data.js"
import type { NestedRunGraph } from "./sub-workflow-handler.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "./types.js"

/** The relayed node types whose job re-hosts its edit's sources, with the
 *  name the refusal gives them. */
const REHOST_SIZE_CHECKED_TYPES: Readonly<Record<string, string>> = { "speaker-view": "Speaker View" }

export interface RelayRehostRefusal {
  readonly nodeId: string
  readonly message: string
}

/** One edit, a clip set or a list of edits, as the edits it holds. */
function editsIn(value: unknown): unknown[] {
  let v = value
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown
    } catch {
      return []
    }
  }
  if (Array.isArray(v)) return v.flatMap(editsIn)
  if (!v || typeof v !== "object") return []
  const clips = (v as { clips?: unknown }).clips
  if (Array.isArray(clips)) return clips.flatMap(editsIn)
  return Array.isArray((v as { sources?: unknown }).sources) ? [v] : []
}

/** The edits `node` will be handed that the run already holds. */
export function knownEditsFor(
  node: SimpleNode,
  nodes: readonly SimpleNode[],
  edges: readonly SimpleEdge[],
  nodeStates: Readonly<Record<string, NodeExecutionState>>,
): unknown[] {
  const edits: unknown[] = editsIn((node.data as Record<string, unknown> | undefined)?.edl)
  for (const e of edges) {
    if (e.target !== node.id || e.targetHandle !== "edl") continue
    const state = nodeStates[e.source]
    if (state?.status !== "completed" || !state.output) continue
    const list = state.output.listResults
    if (Array.isArray(list) && list.length > 0) {
      edits.push(...list.flatMap(editsIn))
      continue
    }
    const source = nodes.find((n) => n.id === e.source)
    if (!source?.type) continue
    edits.push(...editsIn(getPrimaryOutput(state.output, source.type, e.sourceHandle)))
  }
  return edits
}

/**
 * Every Speaker View node this run will execute (no state yet) whose known
 * edit holds a private source over the re-host cap — the refusal names the
 * node and the sources. Call only where the node relays (a self-host).
 */
export async function findRelayRehostRefusals(
  nodes: readonly SimpleNode[],
  edges: readonly SimpleEdge[],
  nodeStates: Readonly<Record<string, NodeExecutionState>>,
  opts: { probe?: RehostByteSizeProbe } = {},
): Promise<RelayRehostRefusal[]> {
  return scanGraph(nodes, edges, nodeStates, opts, (label, nodeId) => `${label} node ${nodeId}`)
}

async function scanGraph(
  nodes: readonly SimpleNode[],
  edges: readonly SimpleEdge[],
  nodeStates: Readonly<Record<string, NodeExecutionState>>,
  opts: { probe?: RehostByteSizeProbe },
  where: (label: string, nodeId: string) => string,
): Promise<RelayRehostRefusal[]> {
  const refusals: RelayRehostRefusal[] = []
  for (const node of nodes) {
    const label = node.type ? REHOST_SIZE_CHECKED_TYPES[node.type] : undefined
    if (!label || nodeStates[node.id]) continue
    for (const edit of knownEditsFor(node, nodes, edges, nodeStates)) {
      const hits = await checkRehostSizes(edit, opts)
      if (hits.length === 0) continue
      refusals.push({ nodeId: node.id, message: `${rehostSizeMessage(label, hits)} (${where(label, node.id)})` })
      break
    }
  }
  return refusals
}

/**
 * The states a nested run starts from that hand an edit on: its source nodes,
 * and its frozen nodes with their saved data (the nested run's own frozen seed
 * carries no output, but its readers fall back to the saved data). Its input
 * node, fed by the parent at run time, gets none — unknowable up front.
 */
function nestedSeedStates(graph: NestedRunGraph): Record<string, NodeExecutionState> {
  const states: Record<string, NodeExecutionState> = {}
  for (const node of graph.nodes) {
    if (!isSourceNode(node.type)) continue
    const output = extractSourceNodeOutput(node)
    if (output) states[node.id] = seededFromSavedData(output)
  }
  for (const id of getEffectivelySkippedIds(graph.nodes, graph.edges)) {
    const node = graph.nodes.find((n) => n.id === id)
    if (node) states[id] = seededFromSavedData(extractSavedNodeOutput(node) ?? extractSourceNodeOutput(node))
  }
  return states
}

/**
 * `findRelayRehostRefusals`, asked of every graph a `sub-workflow` in the run
 * will execute (`loadNestedRunGraphs`): the refusal names the path down to the
 * node, outermost sub-workflow first. Call only where the node relays.
 */
export async function nestedRelayRehostRefusals(
  graphs: readonly NestedRunGraph[],
  opts: { probe?: RehostByteSizeProbe } = {},
): Promise<RelayRehostRefusal[]> {
  const refusals: RelayRehostRefusal[] = []
  for (const graph of graphs) {
    const path = graph.subWorkflowPath.join(" → ")
    refusals.push(
      ...(await scanGraph(graph.nodes, graph.edges, nestedSeedStates(graph), opts, (label, nodeId) => `Sub-workflow node ${path} → ${label} node ${nodeId}`)),
    )
  }
  return refusals
}
