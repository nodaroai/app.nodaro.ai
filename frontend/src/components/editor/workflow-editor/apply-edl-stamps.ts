/**
 * The plan basis a render the BROWSER runs is stamped with (A3-1) — the shared
 * `renderPlanBasis`, the rule the server's payload builder calls too.
 *
 * The plan value is read as the canvas holds the plan: a clip set's clips as
 * the person's review leaves them (`extractNodeOutputAsList`), else a Tighten
 * plan's one EDL with the review applied (`editPlanOutputOf`).
 *
 * The run set is the render alone. The browser engine runs one node at a time
 * (its ▶, its own fan-out, auto-execute); every run of several nodes — Run
 * from here, Run selected, Execute All, Render final, Update preview — runs on
 * the server. So a render wired straight to its plan is stamped, and one behind
 * Camera Switch never is: the switch did not run with it, and its saved EDL can
 * come from an older plan (the same-run rule, R1 a). Such a take reads as
 * unknown, never as current.
 *
 * `currentRenderPlanBasis` is the same rule with the pass-through nodes in the
 * run: the basis Render final or Update preview would stamp now, which the
 * review inspector compares a take with (A3-2).
 */
import { renderPlanBasis, type RenderGraphEdge, type RenderGraphNode } from "@nodaro/shared"
import type { WorkflowNode } from "@/types/nodes"
import { editPlanOutputOf } from "@/lib/edit-plan-saved-output"
import { extractNodeOutputAsList } from "./node-input-resolver"

/** The plan value a render iteration reads, as the canvas holds the plan. */
const planOutputOf = (planNode: RenderGraphNode): unknown => {
  const node = planNode as WorkflowNode
  return extractNodeOutputAsList(node, "edl") ?? editPlanOutputOf(node.data as Readonly<Record<string, unknown>>)?.json
}

export function browserRenderPlanBasis(
  renderId: string,
  nodes: readonly RenderGraphNode[],
  edges: readonly RenderGraphEdge[],
  row: number | undefined,
): string | undefined {
  return renderPlanBasis(
    renderId,
    nodes,
    edges,
    planOutputOf,
    row,
    new Set([renderId]),
  )
}

/**
 * The plan basis a run of the render WITH its pass-through nodes would stamp
 * now (Render final, Update preview: Camera Switch re-runs first) — the plan's
 * current value, read as the browser lane reads it. The review inspector
 * compares a take's `planBasis` with it (A3-2): equal means the take was cut
 * from the plan as it stands, also behind Camera Switch.
 */
export function currentRenderPlanBasis(
  renderId: string,
  nodes: readonly RenderGraphNode[],
  edges: readonly RenderGraphEdge[],
  row: number | undefined,
): string | undefined {
  return renderPlanBasis(renderId, nodes, edges, planOutputOf, row, new Set(nodes.map((n) => n.id)))
}
