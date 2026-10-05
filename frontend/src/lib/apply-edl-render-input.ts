/**
 * What an Apply EDL node would render if it ran now — the input its render
 * rule judges (`edlValidityOf` in render mode): the EDL, the media URLs wired
 * into `sources`, and the node's own settings. Read by the browser engine
 * itself (`getListFanOutForNode` and `resolveNodeInputs`, what its Run plans
 * and sends; the server's input resolver and DAG payload builder mirror them),
 * so the panel's badge judges exactly what the run would send. Pinned against
 * both engines by `__tests__/apply-edl-render-rule-parity.test.ts`.
 */
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { getListFanOutForNode, resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import type { GraphEdge, GraphNode } from "@/lib/edit-plan-estimate"
import type { ApplyEdlRenderContext } from "@/lib/edl-validity"

const dataOf = (n: GraphNode): Record<string, unknown> => (n.data as Record<string, unknown> | undefined) ?? {}

/** Only the given wires into `node`, every other edge kept (a List's columns
 *  and a Text node's upstream list are read through the edges INTO them). */
const withOnlyWires = (node: GraphNode, keep: (e: GraphEdge) => boolean, edges: readonly GraphEdge[]): WorkflowEdge[] =>
  edges.filter((e) => e.target !== node.id || keep(e)) as unknown as WorkflowEdge[]

/** The browser engine's own input resolution (`resolveNodeInputs`, what its
 *  single-node Run sends) of `node` with only the given wires into it. */
const engineInputs = (node: GraphNode, nodes: readonly GraphNode[], wires: WorkflowEdge[]) =>
  resolveNodeInputs(node as unknown as WorkflowNode, nodes as unknown as WorkflowNode[], wires)

/** Whether a held value is something a wire delivers: the engines skip a wire
 *  whose producer yields nothing (`if (!output) continue`). */
const holdsValue = (v: unknown): boolean =>
  v !== undefined && v !== null && !(typeof v === "string" && !v.trim()) && !(Array.isArray(v) && v.length === 0)

/** The last list each wire fanned out over, so the store selector behind the
 *  badge gets the same array back while nothing changed (a fresh array on every
 *  call would never compare equal). */
const fanOutCache = new WeakMap<GraphEdge, readonly (string | undefined)[]>()

/**
 * The items an `edl` wire fans the render out over, at the positions the run
 * names them (a row the run skips stays an empty slot), or `undefined` when
 * this wire delivers one value per run. Asked of the browser engine's own
 * fan-out (`getListFanOutForNode`, the rule its Run plans with) with only this
 * wire into the render, so whatever the engine fans out — a plan's clips, a
 * Camera Switch batch, a List's rows, a list transform, Generate Text's
 * `items` — is judged item by item, and nothing else is: an edge set to one
 * item, a list holding one value, or a handle that never lists (Camera Switch's
 * transcript) delivers one value.
 */
function wireFanOut(
  node: GraphNode,
  edge: GraphEdge,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): readonly (string | undefined)[] | undefined {
  const fan = getListFanOutForNode(
    node as unknown as WorkflowNode,
    nodes as unknown as WorkflowNode[],
    withOnlyWires(node, (e) => e === edge, edges),
  )
  if (!fan || fan.items.length < 2) return undefined
  const held: (string | undefined)[] = []
  fan.items.forEach((item, k) => {
    held[fan.rowIndices[k] ?? k] = item
  })
  const filled = Array.from(held, (item) => item)
  const cached = fanOutCache.get(edge)
  if (cached && cached.length === filled.length && cached.every((item, i) => item === filled[i])) return cached
  fanOutCache.set(edge, filled)
  return filled
}

/**
 * Where the EDL a render reads comes from, which decides what a LIST means:
 *  - "plan": a wire that fans the render out (see `wireFanOut`). The list is
 *    its items, delivered one per run, so each item is one render.
 *  - "wire": a wire that delivers one value per run, which renders whole, as
 *    one EDL.
 *  - "inline": nothing wired holds a value, so the node's own EDL renders, whole.
 */
export type ApplyEdlRenderEdlSource = "plan" | "wire" | "inline"

export interface ApplyEdlRenderEdl {
  readonly value: unknown
  readonly source: ApplyEdlRenderEdlSource
}

/**
 * The EDL an Apply EDL node would render if it ran now, the way both engines
 * pick it: the LAST `edl` wire whose producer holds a value (edges in array
 * order; a wire from a producer that holds nothing is skipped), read through
 * teleports — else the node's inline EDL (`inputs.edl ?? data.edl`). A wire
 * that fans the render out holds its list, one render per item; any other
 * wire holds the one value it delivers, as the browser engine resolves it
 * (`resolveNodeInputs`: the output handle it leaves, an edge set to one item).
 */
export function resolveApplyEdlRenderEdl(
  node: GraphNode,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): ApplyEdlRenderEdl {
  const edlEdges = edges.filter((e) => e.target === node.id && e.targetHandle === "edl")
  for (let i = edlEdges.length - 1; i >= 0; i--) {
    const edge = edlEdges[i]!
    const clips = wireFanOut(node, edge, nodes, edges)
    if (clips) return { value: clips, source: "plan" }
    const value = engineInputs(node, nodes, withOnlyWires(node, (e) => e === edge, edges)).edl
    if (holdsValue(value)) return { value, source: "wire" }
  }
  return { value: dataOf(node).edl, source: "inline" }
}

/**
 * The media-URL overrides an Apply EDL node's `sources` wires deliver now, as
 * both engines collect them: in edge order, one entry per wire whose producer
 * yields a value. A wire whose producer yields nothing adds no entry, so the
 * wires after it move up a slot (the overrides are POSITIONAL onto
 * `EdlSource[i].url`). A list wired into Sources that fans the render out is
 * read here as the one value its wire delivers outside a fan-out, not render
 * by render.
 */
export function resolveApplyEdlRenderSources(
  node: GraphNode,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): string[] {
  return engineInputs(node, nodes, withOnlyWires(node, (e) => e.targetHandle === "sources", edges)).sources ?? []
}

/** The node's settings as the render reads them — the DAG payload builder's
 *  defaults: any `output` other than "audio" is a video render, and a missing
 *  crossfade is a hard cut. */
export function applyEdlRenderContext(
  data: { readonly output?: unknown; readonly crossfadeMs?: unknown },
  input: { readonly source: ApplyEdlRenderEdlSource; readonly sources: readonly string[] },
): ApplyEdlRenderContext {
  return {
    clipList: input.source === "plan",
    output: data.output === "audio" ? "audio" : "video",
    crossfadeMs: typeof data.crossfadeMs === "number" ? data.crossfadeMs : 0,
    sources: input.sources,
  }
}
