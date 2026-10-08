/**
 * How many times a node runs because an Edit Plan in `clips` mode fans its
 * clips out — the one rule the editor's run estimate (`getFanOutMultiplier`)
 * and the listing a published app, component or template stores both read
 * (decided 2026-10-07), so a Clip Pack's card price counts each clip's render
 * and captions exactly as the editor does after cloning it.
 *
 * Deliberately narrow: an Each wire straight from an Edit Plan, and a chain
 * that starts at one and runs through non-list nodes (Clip Pack renders each
 * clip, then captions each render across an Each wire). Every other fan-out
 * (lists, Content Ideas, other producers, the Repeat count) is `nodeFanOut`'s,
 * which reads these.
 */
import {
  compactWithRows,
  defaultEdgeOutputMode,
  editPlanSavedOutput,
  EDIT_PLAN_DEFAULT_CLIP_COUNT,
  EDIT_PLAN_MAX_CLIP_COUNT,
  FAN_OUT_EACH_HANDLES,
  FAN_OUT_EACH_TYPES,
  isDefaultSelectorConfig,
  listResultsServeHandle,
  selectListItems,
  type SelectorFields,
} from "@nodaro/shared"
import type { EditPlanOutputReader, EstimateGraphNode } from "./apply-edl-estimate"

/** A wire as the fan-out reads it: the estimate's, plus its data (mode and selector). */
export interface FanOutGraphEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
  readonly data?: unknown
}

const dataOf = (n: EstimateGraphNode): Record<string, unknown> => (n.data as Record<string, unknown> | undefined) ?? {}
const edgeDataOf = (e: FanOutGraphEdge): Record<string, unknown> | undefined =>
  e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : undefined

/** How many of `count` items a selector keeps: 0 when it keeps one or none. */
export function selectedFanOutCount(count: number, selector: SelectorFields | undefined): number {
  const items = Array.from({ length: count }, (_, i) => String(i + 1))
  const kept = isDefaultSelectorConfig(selector) ? items.length : selectListItems(items, selector).length
  return kept > 1 ? kept : 0
}

/**
 * Downstream executions one Edit Plan run fans out: 1 unless it is in `clips`
 * mode. When the planner is NOT re-running, its persisted plan is what iterates —
 * exact. When it re-plans, it returns UP TO `count` clips (the default clip
 * count when unset), so the setting is the figure; a persisted plan holding
 * more is still honoured, never under-counted. A persisted clip set counts its
 * KEPT clips the edge selects: 0 when it selects none, since nothing renders.
 */
export function editPlanClipFanOut(
  data: Record<string, unknown>,
  replans: boolean,
  selector?: SelectorFields,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
): number {
  const plan = data.generatedJson
  const persisted = Array.isArray(plan) ? plan.length : 0
  if (!replans && plan !== undefined && plan !== null) {
    // Both engines fan out on the SHAPE of the persisted plan, not on the node's
    // current `mode` — the user may have switched mode without re-running. An
    // array iterates; an object (tighten / chapters) runs once.
    if (persisted === 0) return 1
    // The clips as the person's review leaves them: the PLAN's rows, "" at
    // every dropped clip (TA13, TA16). The edge's range / list selector picks
    // rows of the plan, and only the kept clips among them run. None kept is 0.
    const rows = planOutputOf(data)?.listResults ?? []
    const picked = isDefaultSelectorConfig(selector) ? rows : selectListItems(rows, selector)
    return compactWithRows(picked).items.length
  }
  // Re-planning — or no plan yet (a fresh template): what the settings ask for.
  if (data.mode !== "clips") return 1
  const raw = typeof data.count === "number" && data.count > 0 ? Math.floor(data.count) : EDIT_PLAN_DEFAULT_CLIP_COUNT
  const clips = Math.max(Math.min(EDIT_PLAN_MAX_CLIP_COUNT, Math.max(1, raw)), persisted)
  const kept = selectedFanOutCount(clips, selector)
  return kept > 0 ? kept : 1
}

/** A per-handle fan-out node (Camera Switch) that is NOT re-running renders the
 *  batch it holds: one downstream run per item of its last batch. 0 otherwise. */
export function heldBatchFanOut(node: EstimateGraphNode, rerunIds: ReadonlySet<string>): number {
  if (!Object.prototype.hasOwnProperty.call(FAN_OUT_EACH_HANDLES, node.type ?? "") || rerunIds.has(node.id)) return 0
  const batch = dataOf(node).__listResults
  return Array.isArray(batch) && batch.length > 1 ? batch.length : 0
}

/**
 * The clips fan-out a node INHERITS from further upstream: it follows ONLY a
 * chain that starts at an Edit Plan in clips mode, through non-list nodes.
 * General Each-wire inheritance is a different question (a Selector or a list
 * transform runs ONCE over its whole list).
 */
export function inheritedClipFanOut(
  source: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly FanOutGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
  visited: Set<string> = new Set(),
): number {
  if (visited.has(source.id) || FAN_OUT_EACH_TYPES.has(source.type ?? "")) return 1
  visited.add(source.id)
  for (const edge of edges) {
    if (edge.target !== source.id) continue
    const upstream = nodes.find((n) => n.id === edge.source)
    if (!upstream) continue
    const explicit = edgeDataOf(edge)?.outputMode as string | undefined
    if (upstream.type === "edit-plan") {
      if ((explicit ?? "each") !== "each") continue
      const n = editPlanClipFanOut(dataOf(upstream), rerunIds.has(upstream.id), edgeDataOf(edge) as SelectorFields | undefined, planOutputOf)
      // 0: no kept clip reaches this chain, so nothing after it runs.
      if (n !== 1) return n
      continue
    }
    if ((explicit ?? defaultEdgeOutputMode(upstream.type, edge.sourceHandle)) !== "each") continue
    // A handle whose edge never lists (Camera Switch's transcript) fans nothing out.
    if (!listResultsServeHandle(upstream.type, edge.sourceHandle)) continue
    const held = heldBatchFanOut(upstream, rerunIds)
    if (held > 1) return held
    const n = inheritedClipFanOut(upstream, nodes, edges, rerunIds, planOutputOf, visited)
    if (n !== 1) return n
  }
  return 1
}

/** The mode an edge runs in: its own, else its producer's default. */
function edgeMode(edge: FanOutGraphEdge, source: EstimateGraphNode): string {
  return (edgeDataOf(edge)?.outputMode as string | undefined) ?? defaultEdgeOutputMode(source.type, edge.sourceHandle)
}

/**
 * An Each wire whose clips producer emits nothing on it: 0 runs. Read the
 * way {@link clipFanOut} reads the same wire. A wire from any other producer
 * is the caller's to judge (false here).
 */
export function clipWireCarriesNothing(
  edge: FanOutGraphEdge,
  nodes: readonly EstimateGraphNode[],
  edges: readonly FanOutGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
): boolean {
  const source = nodes.find((n) => n.id === edge.source)
  if (!source || edgeMode(edge, source) !== "each") return false
  if (source.type === "edit-plan") {
    return editPlanClipFanOut(dataOf(source), rerunIds.has(source.id), edgeDataOf(edge) as SelectorFields | undefined, planOutputOf) === 0
  }
  if (FAN_OUT_EACH_TYPES.has(source.type ?? "")) return false
  if (!listResultsServeHandle(source.type, edge.sourceHandle) || heldBatchFanOut(source, rerunIds) > 1) return false
  return inheritedClipFanOut(source, nodes, edges, rerunIds, planOutputOf) === 0
}

/**
 * How many times `node` runs because of a clips plan upstream (1 when none;
 * 0 when the plan keeps no clip for it). `rerunIds` are the nodes about to
 * execute, as for the render's minutes: a re-planning Edit Plan counts its
 * clip-count setting, one that does not re-run counts the clips it holds.
 */
export function clipFanOut(
  node: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly FanOutGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
): number {
  const incoming = edges.filter((e) => e.target === node.id)
  if (incoming.some((e) => clipWireCarriesNothing(e, nodes, edges, rerunIds, planOutputOf))) return 0
  for (const edge of incoming) {
    const source = nodes.find((n) => n.id === edge.source)
    if (!source || edgeMode(edge, source) !== "each") continue
    if (source.type === "edit-plan") {
      const n = editPlanClipFanOut(dataOf(source), rerunIds.has(source.id), edgeDataOf(edge) as SelectorFields | undefined, planOutputOf)
      if (n > 1) return n
      continue
    }
    if (FAN_OUT_EACH_TYPES.has(source.type ?? "")) continue
    if (!listResultsServeHandle(source.type, edge.sourceHandle)) continue
    const held = heldBatchFanOut(source, rerunIds)
    if (held > 1) return held
    const inherited = inheritedClipFanOut(source, nodes, edges, rerunIds, planOutputOf)
    if (inherited > 1) return inherited
  }
  return 1
}
