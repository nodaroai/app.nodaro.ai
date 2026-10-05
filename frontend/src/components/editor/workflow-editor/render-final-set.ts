/**
 * What Render final and Update preview run (TA17 a, decided 2026-10-04):
 * `(desc(plan) ∩ anc(render)) ∪ desc(render)`, minus the plan.
 *
 * The plan is the Edit Plan behind the render's `edl` wire (`renderPlanPath`).
 * It never re-runs: its saved output, with the person's review applied
 * (`editPlanSavedOutput`), is what the run seeds. Everything between the plan
 * and the render re-runs — for Tighten and a single-camera Clip Pack that is
 * nothing, so the set is exactly "from the render node onward"; in multicam
 * Camera Switch re-runs first and restored spans get its cameras. With no plan
 * behind the render the set is the render onward.
 *
 * "Feeds" is the stop rule's own definition (`buildFeedMaps`: wires, Group
 * membership, field mappings), so the tail a Preview gated is exactly what a
 * Render final runs: nothing the preview held back is left unrun.
 */
import { buildFeedMaps, PREVIEW_RENDER_NODE_TYPES, renderPlanPath, type FeedEdge, type FeedNode } from "@nodaro/shared"

/** A node and a wire as the walk reads them: either engine's graph fits. */
interface GraphNode {
  readonly id: string
  readonly type?: string | null
  readonly data?: unknown
  readonly parentId?: string | null
}
interface GraphEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
  readonly data?: unknown
}

/** Every node reached from `start` through `next`, `start` included. */
function reach(start: string, next: ReadonlyMap<string, ReadonlyArray<string>>): Set<string> {
  const seen = new Set<string>([start])
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const id of next.get(current) ?? []) {
      if (!seen.has(id)) {
        seen.add(id)
        queue.push(id)
      }
    }
  }
  return seen
}

/** The ids a Render final on `renderId` runs. Empty when the node is not on the graph. */
export function renderFinalRunSet(
  renderId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): ReadonlySet<string> {
  if (!nodes.some((n) => n.id === renderId)) return new Set()
  const { children, parents } = buildFeedMaps(nodes as readonly FeedNode[], edges as readonly FeedEdge[])
  const set = reach(renderId, children)
  const planId = renderPlanPath(renderId, nodes, edges)?.planId
  if (planId) {
    const ancestors = reach(renderId, parents)
    for (const id of reach(planId, children)) if (ancestors.has(id)) set.add(id)
    set.delete(planId)
  }
  return set
}

/**
 * A one-shot quality override on the render, as the run's `inputOverrides`
 * (TA18): the node keeps its own Quality, so the toolbar Run always previews
 * and Render final always renders the final. An override clears the overridden
 * node's saved results, so it may only name a node the run re-runs.
 */
export function renderRunOverrides(
  renderId: string,
  quality: "proxy" | "final",
  runSet: ReadonlySet<string>,
): Record<string, Record<string, unknown>> {
  if (!runSet.has(renderId)) {
    throw new Error(`a run override cannot name ${renderId}: it is outside the run's subset, and an override clears the node's saved results`)
  }
  return { [renderId]: { quality } }
}

/**
 * The renders an Edit Plan feeds (its clips or its cut reach the render's `edl`
 * input, through teleports and Camera Switch), in canvas order. A plan-anchored
 * entry point (the plan's context menu) asks WHICH when there are several:
 * one render per click (TA2 item 4, decided 2026-10-04).
 */
export function rendersOfPlan(
  planId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): GraphNode[] {
  return nodes.filter(
    (n) => PREVIEW_RENDER_NODE_TYPES.has(n.type ?? "") && renderPlanPath(n.id, nodes, edges)?.planId === planId,
  )
}
