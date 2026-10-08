/**
 * Is the render's take older than its Edit Plan's review? (`editedSincePreview`,
 * lib/edl-review/face-staleness.ts.) Reads the canvas through `useReviewGraph`,
 * so a run's progress ticks and edits beside the render do not recompute it.
 */
import { useMemo } from "react"
import { editedSincePreview } from "@/lib/edl-review/face-staleness"
import { useReviewGraph } from "./use-review-graph"

export function useEditedSincePreview(renderId: string): boolean {
  const { nodes, edges } = useReviewGraph(renderId)
  return useMemo(() => editedSincePreview(renderId, nodes, edges), [renderId, nodes, edges])
}
