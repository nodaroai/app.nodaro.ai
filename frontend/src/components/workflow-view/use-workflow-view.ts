import { useEffect, useState } from "react"
import { getWorkflowView, isNotAvailableError, isNotFoundError, type WorkflowView } from "@/lib/api"

export type WorkflowViewState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly view: WorkflowView }
  | { readonly status: "not_found" }
  | { readonly status: "not_available" }
  | { readonly status: "error" }

/** Loads a published view by its token. Public: never sends the session. */
export function useWorkflowView(token: string | undefined): WorkflowViewState {
  const [state, setState] = useState<WorkflowViewState>({ status: "loading" })

  useEffect(() => {
    if (!token) {
      setState({ status: "not_found" })
      return
    }
    const controller = new AbortController()
    setState({ status: "loading" })
    getWorkflowView(token, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setState({ status: "ready", view })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (isNotFoundError(err)) setState({ status: "not_found" })
        else if (isNotAvailableError(err)) setState({ status: "not_available" })
        else setState({ status: "error" })
      })
    return () => controller.abort()
  }, [token])

  return state
}
