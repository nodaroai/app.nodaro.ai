/**
 * A sub-workflow or a component that holds a Preview render (decided
 * 2026-10-04: refused, permanently).
 *
 * A nested graph runs inside its caller's run and hands its outputs to the
 * caller's nodes: a Preview render in it would be consumed by a node with no
 * Render final path anywhere. So the run is refused before any node runs —
 * sub-workflows in the orchestrator's up-front nested scan (and again by the
 * sub-workflow handler, the backstop), components at publish and on their
 * inner run. App review never lifts this.
 */
import { withRunOverrides } from "@nodaro/shared/nodes"
import { previewStopsWhenEnabled } from "../../lib/preview-stop-rule.js"
import { previewRefusalMessage } from "../../lib/preview-refusal-copy.js"
import type { NestedRunGraph } from "./sub-workflow-handler.js"
import type { SimpleEdge, SimpleNode } from "./types.js"

/** The nested refusal's copy (en) for a render at Preview (`previewRefusalMessage`). */
export const PREVIEW_RENDER_NESTED_MESSAGE = previewRefusalMessage("nested", "render")

export interface NestedPreviewRender {
  /** The render set to Preview (or handing a saved Preview on), or the review-on use-case node. */
  readonly renderId: string
  /** Its node type: what the refusal names the remedy by. */
  readonly nodeType: string | undefined
  /** Sub-workflow node ids from the run graph down to it, outermost first. */
  readonly subWorkflowPath: readonly string[]
}

/** The Preview renders one nested graph holds. Every node of a nested graph
 *  runs, except a frozen one. None while the rollout flag is off. A nested
 *  graph is a SAVED graph that no run overrides: read through the shared
 *  funnel, so a stale saved continuation never releases a review-on node. */
export function previewRendersIn(nodes: readonly SimpleNode[], edges: readonly SimpleEdge[]): string[] {
  const stops = previewStopsWhenEnabled(withRunOverrides(nodes, undefined), edges)
  return [...stops.previewRenderIds, ...stops.savedPreviewRenderIds]
}

/** Every Preview render the run's nested graphs hold (`loadNestedRunGraphs`). */
export function nestedPreviewRenders(graphs: readonly NestedRunGraph[]): NestedPreviewRender[] {
  return graphs.flatMap((graph) =>
    previewRendersIn(graph.nodes, graph.edges).map((renderId) => ({
      renderId,
      nodeType: graph.nodes.find((n) => n.id === renderId)?.type,
      subWorkflowPath: graph.subWorkflowPath,
    })),
  )
}

/** Where a nested Preview render sits, for the logs and the error a node shows. */
export function nestedPreviewRenderLocation(hit: NestedPreviewRender): string {
  return `Sub-workflow node ${hit.subWorkflowPath.join(" → ")} → render ${hit.renderId}`
}
