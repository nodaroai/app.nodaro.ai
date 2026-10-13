/**
 * What a render node's own pill and Run button quote (C4): the per-minute rate
 * of the row the render-node registry names for it — its quality and, for
 * Speaker View, the price tier its graph tells (`renderEstimateCreditId`,
 * `@nodaro/render-rules`, the id every run-level estimate prices) — for the
 * minutes it can reserve, priced as one whole render the way the server
 * charges it (`lib/unit-quote.ts`). The same id and minutes the run estimate
 * prices, so the node and the run's confirm agree.
 */
import { renderEstimateCreditId } from "@nodaro/render-rules"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUnitQuoteCredits } from "@/hooks/use-unit-quote-credits"
import { useApplyEdlEstimateMinutes } from "@/hooks/use-apply-edl-estimate-minutes"
import { editPlanOutputOf } from "@/lib/edit-plan-saved-output"

/** A pill prices running THIS node now: nothing upstream re-plans. Module-level
 *  so the selector sees a stable reference. */
const NO_RERUNS: ReadonlySet<string> = new Set()

/** The credit id the node's own run reserves on; a primitive, safe on every store tick. */
export function useRenderNodeCreditId(nodeId: string): string | undefined {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId)
    return node ? renderEstimateCreditId({ id: node.id, type: node.type, data: node.data }, s.nodes as never, s.edges as never, NO_RERUNS, editPlanOutputOf) : undefined
  })
}

/** Credits a Run of this render node alone is quoted at. */
export function useRenderNodeCredits(nodeId: string): number {
  // The whole render's price for its minutes — what the run is charged (lib/unit-quote.ts).
  return useUnitQuoteCredits(useRenderNodeCreditId(nodeId), useApplyEdlEstimateMinutes(nodeId))
}
