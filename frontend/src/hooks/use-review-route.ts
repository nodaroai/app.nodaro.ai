/**
 * `?review=<id>`: the review inspector's place in the URL (R17 a, A3-5).
 *
 * The URL and `useReviewOpenStore` say the same thing, and each can start the
 * change:
 *  - a URL that names a render (or an Edit Plan, which opens at the first
 *    render it feeds) opens the review once the workflow has loaded; an id that
 *    names nothing reviewable gets a short toast and is dropped, the other
 *    params untouched;
 *  - a review opened from the editor (`openReview`) writes the param, and
 *    closing removes it. Both REPLACE history, so Back does not walk through
 *    reviews;
 *  - a navigation that removes the param closes the review, and so does
 *    loading another workflow.
 *
 * It reads the canvas only when a URL asks for a review, and never writes the
 * param before that request has been judged: the store starts empty, and an
 * empty store is not a request to close.
 *
 * "Loaded" means the store holds the workflow the ROUTE names. The editor is not
 * remounted when only `:workflowId` changes, so after an in-app navigation (a
 * Back or Forward between workflows) the store still holds the previous
 * workflow's nodes until `load` runs; judging the link against those would
 * drop a valid one. A route that names no workflow (an embed, a test) is
 * judged against whatever the store holds.
 */
import { useCallback, useEffect, useRef } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { tx } from "@/lib/i18n"
import { reviewTargetOf } from "@/lib/edl-review/review-entry"
import { useReviewOpenStore } from "./use-review-open-store"
import { useWorkflowStore } from "./use-workflow-store"

export const REVIEW_PARAM = "review"
const UNAVAILABLE_TOAST_ID = "edl-review-link-unavailable"

export interface ReviewRoute {
  /** The render the open review is anchored at; null when closed. */
  readonly renderId: string | null
  readonly close: () => void
  /** The reviewer chose another render of the same plan. */
  readonly changeRender: (renderId: string) => void
}

export function useReviewRoute(): ReviewRoute {
  const [params, setParams] = useSearchParams()
  const requested = params.get(REVIEW_PARAM)
  const renderId = useReviewOpenStore((s) => s.renderId)
  const open = useReviewOpenStore((s) => s.open)
  const close = useReviewOpenStore((s) => s.close)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const routeWorkflowId = useParams().workflowId
  const loaded = useWorkflowStore(
    (s) => s.nodes.length > 0 && !s.isWorkflowLoading && (routeWorkflowId === undefined || routeWorkflowId === s.workflowId),
  )

  const setParam = useCallback(
    (value: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value === null) next.delete(REVIEW_PARAM)
          else next.set(REVIEW_PARAM, value)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  // Another workflow: the review of the last one has nothing to show. First of the
  // three, so that when one commit both swaps the workflow and lets a link open
  // its review, the close comes before the open and not after it. The first
  // load (no workflow yet -> this one) is not "another": a link that opened its
  // review as the workflow arrived must keep it.
  const lastWorkflow = useRef(workflowId)
  useEffect(() => {
    const before = lastWorkflow.current
    lastWorkflow.current = workflowId
    if (before !== null && before !== workflowId) close()
  }, [workflowId, close])

  // URL -> review: a request is judged once, when the canvas can answer it.
  const lastRequested = useRef<string | null>(null)
  useEffect(() => {
    const before = lastRequested.current
    lastRequested.current = requested
    if (requested === null) {
      if (before !== null) close()
      return
    }
    if (!loaded || useReviewOpenStore.getState().renderId === requested) return
    const { nodes, edges } = useWorkflowStore.getState()
    const target = reviewTargetOf(requested, nodes, edges)
    if (target) open(target)
    else {
      // Judged against the loaded workflow and found nothing: say so, then drop the param.
      // A fixed id keeps a repeat of the same effect (StrictMode) to one toast.
      toast.info(tx("edlReview.linkUnavailable"), { id: UNAVAILABLE_TOAST_ID })
      setParam(null)
    }
  }, [requested, loaded, open, close, setParam])

  // Review -> URL: only a CHANGE of the open review is written. A close removes
  // the param only if it still names the review that closed: a link to another
  // review (or workflow) that arrived meanwhile is not the closing review's to
  // delete.
  const lastOpen = useRef<string | null>(renderId)
  useEffect(() => {
    const before = lastOpen.current
    if (before === renderId) return
    lastOpen.current = renderId
    const named = params.get(REVIEW_PARAM)
    if (renderId === null) {
      if (named !== null && named === before) setParam(null)
    } else if (named !== renderId) setParam(renderId)
  }, [renderId, params, setParam])

  const changeRender = useCallback((id: string) => open(id), [open])
  return { renderId, close, changeRender }
}
