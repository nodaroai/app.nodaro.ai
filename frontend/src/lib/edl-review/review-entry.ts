/**
 * Where a review can be opened (§2.7 of the inspectors design, A3-5; R17 a,
 * R18 a), read off the canvas. Pure, so every entry point asks the same
 * question: the render's node bar, the context menu, the Edit Plan's Expand
 * and `?review=`.
 *
 * A render can be reviewed when an Edit Plan's Tighten EDL is behind it
 * (`renderPlanPath`: straight, through teleports, or through Camera Switch),
 * WHATEVER its take (R18 a): a Preview, a Final, or none yet. A clip set's
 * review is the Clip Pack inspector's (A4-2), and a plan that has not run has
 * nothing to review, so neither is an entry here.
 *
 * `?review=` names a render or a plan. A plan opens at the first render it
 * feeds, in canvas order; the header's render picker (TA2 item 4) chooses among
 * the rest.
 */
import { isRenderNodeType, renderPlanPath, type RenderGraphEdge } from "@nodaro/shared"
import { planKindOf } from "./plan-kind"

export interface ReviewGraphNodeLike {
  readonly id: string
  readonly type?: string | null
  readonly data?: unknown
}

export interface ReviewEntry {
  /** The Edit Plan whose cut the review edits. */
  readonly planId: string
}

type Edges = readonly RenderGraphEdge[]

/** The Edit Plan behind `renderId` when its plan is a Tighten EDL; else null. */
export function reviewEntryOf(renderId: string, nodes: readonly ReviewGraphNodeLike[], edges: Edges): ReviewEntry | null {
  const render = nodes.find((n) => n.id === renderId)
  if (!render || !isRenderNodeType(render.type)) return null
  const path = renderPlanPath(renderId, nodes, edges)
  if (!path) return null
  const plan = nodes.find((n) => n.id === path.planId)
  const stored = (plan?.data as { readonly generatedJson?: unknown } | undefined)?.generatedJson
  return planKindOf(stored) === "edl" ? { planId: path.planId } : null
}

/** The renders `planId` feeds that can be reviewed, in canvas order. */
export function reviewRendersOf<N extends ReviewGraphNodeLike>(planId: string, nodes: readonly N[], edges: Edges): N[] {
  // Renders first: the walk up each wire is paid only by the few nodes that are one.
  return nodes.filter((n) => isRenderNodeType(n.type) && reviewEntryOf(n.id, nodes, edges)?.planId === planId)
}

/** The render a review of `id` (a render, or an Edit Plan) opens at; null when `id` names nothing reviewable. */
export function reviewTargetOf(id: string, nodes: readonly ReviewGraphNodeLike[], edges: Edges): string | null {
  const node = nodes.find((n) => n.id === id)
  if (!node) return null
  if (isRenderNodeType(node.type)) return reviewEntryOf(id, nodes, edges) ? id : null
  return reviewRendersOf(id, nodes, edges)[0]?.id ?? null
}
