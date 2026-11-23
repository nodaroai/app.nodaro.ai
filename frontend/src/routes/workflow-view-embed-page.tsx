import { useParams } from "react-router-dom"
import { ReactFlowProvider } from "@xyflow/react"
import { SeededViewCanvas } from "@/components/workflow-view/seeded-view-canvas"
import { ViewStatusScreen } from "@/components/workflow-view/view-status-screen"
import { useWorkflowView } from "@/components/workflow-view/use-workflow-view"
import { useViewDocumentHead } from "@/components/workflow-view/use-view-document-head"
import { workflowViewUrl } from "@/lib/public-links"
import { surfaceBrandName } from "@/lib/surface-selectors"

/**
 * `/embed/view/:token` — the same read-only canvas with no bar or menus, for an
 * `<iframe>` on another site. One small corner link opens the full page.
 */
export default function WorkflowViewEmbedPage() {
  const { token } = useParams<{ token: string }>()
  const state = useWorkflowView(token)
  const view = state.status === "ready" ? state.view : undefined
  useViewDocumentHead(view?.name, view?.indexable)

  if (state.status !== "ready" || !token) {
    return (
      <div className="h-dvh w-full">
        <ViewStatusScreen state={state.status === "ready" ? { status: "not_found" } : state} />
      </div>
    )
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background">
      <ReactFlowProvider>
        <SeededViewCanvas token={token} view={state.view} showMiniMap={false}>
          <a
            href={workflowViewUrl(token)}
            target="_blank"
            rel="noopener"
            title={state.view.name}
            className="absolute end-2 top-2 z-10 rounded bg-background/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground backdrop-blur-sm hover:text-foreground"
          >
            {surfaceBrandName()}
          </a>
        </SeededViewCanvas>
      </ReactFlowProvider>
    </div>
  )
}
