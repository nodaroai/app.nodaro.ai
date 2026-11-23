import { useParams } from "react-router-dom"
import { ReactFlowProvider } from "@xyflow/react"
import { SeededViewCanvas } from "@/components/workflow-view/seeded-view-canvas"
import { ViewTopBar } from "@/components/workflow-view/view-top-bar"
import { ViewStatusScreen } from "@/components/workflow-view/view-status-screen"
import { useWorkflowView } from "@/components/workflow-view/use-workflow-view"
import { useViewDocumentHead } from "@/components/workflow-view/use-view-document-head"

/** `/view/:token` — a workflow's canvas, read-only, for anyone with the link. No sign-in. */
export default function WorkflowViewPage() {
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
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <ViewTopBar token={token} name={state.view.name} exported={state.view.export} />
      <main className="relative min-h-0 flex-1">
        <ReactFlowProvider>
          <SeededViewCanvas token={token} view={state.view} />
        </ReactFlowProvider>
      </main>
    </div>
  )
}
