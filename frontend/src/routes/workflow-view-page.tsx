import { useParams } from "react-router-dom"
import { ReactFlowProvider } from "@xyflow/react"
import { SeededViewCanvas } from "@/components/workflow-view/seeded-view-canvas"
import { ViewTopBar } from "@/components/workflow-view/view-top-bar"
import { ViewStatusScreen } from "@/components/workflow-view/view-status-screen"
import { useWorkflowView } from "@/components/workflow-view/use-workflow-view"
import { useViewDocumentHead } from "@/components/workflow-view/use-view-document-head"
import { SiteHeaderSlot } from "@/components/layout/site-header-slot"
import { useSharedHeaderMode } from "@/lib/shared-header"

const noop = () => {}

/**
 * `/view/:token` — a workflow's canvas for anyone with the link, no sign-in:
 * nothing runs or saves, and the visitor may move and resize the cards to read
 * them. On Nodaro's own deployments the shared site header sits above it (the
 * embed never has one); a deployment with a header of its own, or none, keeps
 * the page's slim bar alone.
 */
export default function WorkflowViewPage() {
  const { token } = useParams<{ token: string }>()
  const state = useWorkflowView(token)
  const view = state.status === "ready" ? state.view : undefined
  useViewDocumentHead(view?.name, view?.indexable)
  const siteHeader = useSharedHeaderMode() === "default"

  if (state.status !== "ready" || !token) {
    return (
      <div className="h-dvh w-full">
        <ViewStatusScreen state={state.status === "ready" ? { status: "not_found" } : state} />
      </div>
    )
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      {siteHeader && <SiteHeaderSlot compact onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen={false} publicPage />}
      <ViewTopBar token={token} name={state.view.name} exported={state.view.export} showMadeWith={!siteHeader} />
      {/* Its end clears the site header's fixed phone bottom bar, where there is one. */}
      <main className="relative min-h-0 flex-1 pb-[var(--ns-bottom-bar-h,0px)]">
        <ReactFlowProvider>
          <SeededViewCanvas token={token} view={state.view} />
        </ReactFlowProvider>
      </main>
    </div>
  )
}
