/**
 * The render an Edit Plan's Expand opens the review at (A3-5, R17 a): the first
 * render the plan feeds whose cut can be reviewed, in canvas order — the
 * header's render picker chooses among the rest. Null when there is none, or no
 * inspector is mounted to show it; Expand then keeps opening the plan's JSON.
 *
 * A string, so a drag or a run's progress re-renders nothing.
 */
import { useReviewHostMounted } from "./use-review-open-store"
import { useWorkflowStore } from "./use-workflow-store"
import { reviewRendersOf } from "@/lib/edl-review/review-entry"

export function usePlanReviewRender(planId: string): string | null {
  const hosted = useReviewHostMounted()
  const first = useWorkflowStore((s) => reviewRendersOf(planId, s.nodes, s.edges)[0]?.id ?? null)
  return hosted ? first : null
}
