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
 */
import { renderPlanBasis, type RenderGraphEdge, type RenderGraphNode } from "@nodaro/shared"
import type { WorkflowNode } from "@/types/nodes"
import { editPlanOutputOf } from "@/lib/edit-plan-saved-output"
import { extractNodeOutputAsList } from "./node-input-resolver"

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
    (planNode) => {
      const node = planNode as WorkflowNode
      return extractNodeOutputAsList(node, "edl") ?? editPlanOutputOf(node.data as Readonly<Record<string, unknown>>)?.json
    },
    row,
    new Set([renderId]),
  )
}
