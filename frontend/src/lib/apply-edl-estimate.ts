/**
 * How many OUTPUT MINUTES an Apply EDL node's credit ESTIMATE should price — the
 * editor's face of `@nodaro/render-rules`' `resolveApplyEdlEstimateMinutes`, the
 * ONE render-length rule (decided 2026-10-07). The listing a published app,
 * component or template stores reads the same rule, so a template's card price
 * and the editor's estimate after cloning it assume the same render length.
 * The rule, its two situations (EXACT / ESTIMATED) and its per-mode assumptions
 * are documented there.
 *
 * The editor reads an Edit Plan's saved output through its cached reader
 * (`editPlanOutputOf`), so a store selector built on these stays stable.
 */
import {
  EDL_LENGTH_PRESERVING_TYPES,
  persistedEdlPlan as persistedEdlPlanWith,
  resolveApplyEdlEstimateMinutes as resolveMinutesWith,
} from "@nodaro/render-rules"
import type { GraphEdge, GraphNode } from "@/lib/edit-plan-estimate"
import { editPlanOutputOf } from "@/lib/edit-plan-saved-output"

export { EDL_LENGTH_PRESERVING_TYPES }

/** The editor's Edit Plan reader, handed to the shared rules (the render's minutes, a step's input length). */
export const readPlan = (data: Readonly<Record<string, unknown>>) => editPlanOutputOf(data)

/**
 * The EDL a producer holds on the canvas — what its `edl` output would deliver
 * now (an Edit Plan's with the person's review applied). The estimate's reader;
 * the Apply EDL panel's badge reads what the engines read instead
 * (`apply-edl-render-input.ts`).
 */
export function persistedEdlPlan(producer: GraphNode): unknown {
  return persistedEdlPlanWith(producer, readPlan)
}

/**
 * @param rerunIds ids of the nodes about to EXECUTE. Pass the executable set for
 *   a whole-workflow / run-selected estimate; pass an empty set for a single-node
 *   estimate (the node's pill, its Run button), where nothing upstream re-plans.
 */
export function resolveApplyEdlEstimateMinutes(
  node: GraphNode,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  rerunIds: ReadonlySet<string>,
): number {
  return resolveMinutesWith(node, nodes, edges, rerunIds, readPlan)
}
