/**
 * `?framing=<nodeId>`: the region editor's place in the URL (U4). It follows
 * `use-review-route.ts`: a link opens the editor once the workflow the route
 * names has loaded, if the id is a Speaker View node (else a short toast and
 * the param is dropped). A read-only (shared, Studio) workflow gets the same
 * treatment with its own toast: the panel's "Edit framing…" is disabled there,
 * and an editor opened from a link could not save. Opening from the panel writes the param and closing
 * removes it, both replacing history; loading another workflow closes it.
 */
import { useCallback, useEffect, useRef } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { tx } from "@/lib/i18n"
import { useFramingOpenStore } from "./use-framing-open-store"
import { useWorkflowStore } from "./use-workflow-store"

export const FRAMING_PARAM = "framing"
const UNAVAILABLE_TOAST_ID = "speaker-view-framing-link-unavailable"

export function useFramingRoute(): { readonly nodeId: string | null; readonly close: () => void } {
  const [params, setParams] = useSearchParams()
  const requested = params.get(FRAMING_PARAM)
  const nodeId = useFramingOpenStore((s) => s.nodeId)
  const open = useFramingOpenStore((s) => s.open)
  const close = useFramingOpenStore((s) => s.close)
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
          if (value === null) next.delete(FRAMING_PARAM)
          else next.set(FRAMING_PARAM, value)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const lastWorkflow = useRef(workflowId)
  useEffect(() => {
    const before = lastWorkflow.current
    lastWorkflow.current = workflowId
    if (before !== null && before !== workflowId) close()
  }, [workflowId, close])

  // URL -> editor: a request is judged once, when the canvas can answer it.
  const lastRequested = useRef<string | null>(null)
  useEffect(() => {
    const before = lastRequested.current
    lastRequested.current = requested
    if (requested === null) {
      if (before !== null) close()
      return
    }
    if (!loaded || useFramingOpenStore.getState().nodeId === requested) return
    const store = useWorkflowStore.getState()
    const node = store.nodes.find((n) => n.id === requested)
    if (node?.type === "speaker-view" && !store.isReadOnly) open(requested)
    else {
      toast.info(tx(node?.type === "speaker-view" ? "speakerView.framing.linkReadOnly" : "speakerView.framing.linkUnavailable"), { id: UNAVAILABLE_TOAST_ID })
      setParam(null)
    }
  }, [requested, loaded, open, close, setParam])

  // Editor -> URL: only a change is written; a close removes the param only if it names the closing node.
  const lastOpen = useRef<string | null>(nodeId)
  useEffect(() => {
    const before = lastOpen.current
    if (before === nodeId) return
    lastOpen.current = nodeId
    const named = params.get(FRAMING_PARAM)
    if (nodeId === null) {
      if (named !== null && named === before) setParam(null)
    } else if (named !== nodeId) setParam(nodeId)
  }, [nodeId, params, setParam])

  return { nodeId, close }
}
