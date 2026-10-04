/**
 * BASE credits of a video-utility node (Trim Video, Loop Video, Combine
 * Videos, Assemble Narrated Video) from the graph: its own settings plus the
 * upstream lengths and the clips its wires bring. The node's price pill shows
 * it, and the workflow estimate divides it into pricing units
 * (`workflow-editor/types.ts :: getPricingUnits`), so the two read one number.
 * The estimators are the ones the routes and the workflow run charge with
 * (`@nodaro/shared`).
 */
import {
  assembleNarratedVideoCredits,
  estimateCombineVideosCredits,
  estimateLoopVideoCredits,
  estimateTrimVideoCredits,
  VIDEO_UTIL_PRICING,
  type CombineVideosEstimatorInput,
  type LoopVideoEstimatorInput,
  type TrimVideoEstimatorInput,
} from "@nodaro/shared"
import { getCombineUpstreamDurations, getUpstreamDuration } from "@/lib/upstream-duration"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export function estimateVideoUtilityBaseCredits(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): number | undefined {
  const data = node.data as Record<string, unknown>
  switch (node.type) {
    case "loop-video":
      return estimateLoopVideoCredits(data as LoopVideoEstimatorInput, getUpstreamDuration(node.id, nodes, edges))
    case "trim-video":
      return estimateTrimVideoCredits(data as TrimVideoEstimatorInput, getUpstreamDuration(node.id, nodes, edges))
    case "combine-videos":
      return estimateCombineVideosCredits(data as CombineVideosEstimatorInput, getCombineUpstreamDurations(node, nodes, edges))
    case "assemble-narrated-video": {
      // Block count = edges wired into the "video" handle (the `blocks` array
      // driver — see execute-node.ts). No inputs wired yet still prices the
      // 1-block floor (never shows the unreachable N=0 value).
      const wired = edges.filter((e) => e.target === node.id && e.targetHandle === "video").length
      return assembleNarratedVideoCredits(Math.max(1, wired))
    }
    default:
      return undefined
  }
}

/** Pricing units of a video-utility node: its base credits over one unit (its own one-unit price row). */
export function videoUtilityPricingUnits(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): number {
  const base = estimateVideoUtilityBaseCredits(node, nodes, edges)
  return base === undefined ? 1 : base / VIDEO_UTIL_PRICING.CREDIT_UNIT
}
