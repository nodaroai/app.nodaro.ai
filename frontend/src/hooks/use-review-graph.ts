/**
 * The canvas a review reads (`lib/edl-review/review-graph.ts`), held until
 * something the render reads changes. A store write that changes nothing the
 * review reads (a run's progress or status, a drag, an edit beside the render)
 * returns the snapshot already held, so the hook does not re-render and no
 * memo keyed on the snapshot recomputes.
 *
 * The snapshot can hold old run state: never read a run-state key from it
 * (the lock reads the live store).
 */
import { useRef } from "react"
import { runStateKeys, stableReviewGraph, type IgnoredKeys, type ReviewGraph } from "@/lib/edl-review/review-graph"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "./use-workflow-store"

export type ReviewCanvas = ReviewGraph<WorkflowNode, WorkflowEdge>

export function useReviewGraph(rootId: string, ignored: IgnoredKeys = runStateKeys): ReviewCanvas {
  const cache = useRef<ReviewCanvas | null>(null)
  return useWorkflowStore((s) => stableReviewGraph(cache, { nodes: s.nodes, edges: s.edges }, rootId, ignored))
}
