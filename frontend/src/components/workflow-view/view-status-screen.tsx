import { Loader2 } from "lucide-react"
import { useT } from "@/lib/i18n"
import type { WorkflowViewState } from "./use-workflow-view"

/** Every state of a view page that is not the canvas: loading, gone, not live yet, failed. */
export function ViewStatusScreen({ state }: { readonly state: Exclude<WorkflowViewState, { status: "ready" }> }) {
  const t = useT()
  if (state.status === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background" role="status" aria-label={t("common.loading")}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  const [title, body] =
    state.status === "not_found"
      ? [t("workflowView.notFoundTitle"), t("workflowView.notFoundBody")]
      : state.status === "not_available"
        ? [t("workflowView.notAvailableTitle"), t("workflowView.notAvailableBody")]
        : [t("workflowView.loadFailedTitle"), t("workflowView.loadFailedBody")]
  return (
    <div className="flex h-full w-full items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}
