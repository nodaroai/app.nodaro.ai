import { useEffect, useCallback } from "react"
import { useParams, useSearchParams, Link } from "react-router-dom"
import { Loader2, Clock, MoreVertical, Trash2, Link as LinkIcon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { PresentationView } from "@/components/presentation/presentation-view"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "@/hooks/use-workflow-store"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { useRunSlots, AppRunnerLayout, RunsSidebar, MobileAppShell, ORIGINAL_SLOT_ID } from "@/components/app-runner"
import { updateAppRunInputs } from "@/lib/api"

export default function AppRunnerPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  // Deep-linking query params
  const initialRunId = searchParams.get("run") ?? undefined
  const initialSidebar = searchParams.get("sidebar") as "open" | "closed" | null

  // App runner store
  const loadApp = useAppRunnerStore((s) => s.loadApp)
  const app = useAppRunnerStore((s) => s.app)
  const errorMessage = useAppRunnerStore((s) => s.errorMessage)
  const cancel = useAppRunnerStore((s) => s.cancel)
  const reset = useAppRunnerStore((s) => s.reset)

  // Load app on mount — don't wait for auth (app is public)
  useEffect(() => {
    if (slug) loadApp(slug)
    return () => { reset() }
  }, [slug, loadApp, reset])

  // Clear presentation store immediately on slug change (before new app loads)
  // This prevents stale images/text from the previous app showing during the fetch
  useEffect(() => {
    usePresentationStore.setState({
      nodes: [],
      edges: [],
      inputValues: {},
      nodeStates: {},
      executionId: null,
      executionStatus: "idle",
      completedNodes: 0,
      totalNodes: 0,
      errorMessage: null,
    })
  }, [slug])

  // Seed presentation store when app loads (structural data only —
  // nodeStates + executionStatus are managed by the auto-select in useRunSlots)
  useEffect(() => {
    if (!app) return
    const snapshotSettings = (app.snapshotSettings ?? {}) as Record<string, unknown>
    const presentationSettings = (snapshotSettings.presentationSettings ?? DEFAULT_PRESENTATION_SETTINGS) as PresentationSettings
    usePresentationStore.setState({
      workflowId: app.workflowId,
      workflowName: app.name,
      nodes: app.snapshotNodes as WorkflowNode[],
      edges: app.snapshotEdges as WorkflowEdge[],
      isOwner: false,
      estimatedCost: app.estimatedCredits,
      presentationSettings,
    })
  }, [app])

  // Run slots hook — all slot state, CRUD, DB sync
  const runSlots = useRunSlots({ slug, user, persistRuns: !!user, initialRunId, initialSidebar })

  const isMobile = useIsMobile()

  // Persist hidden output cards to the backend when the user hides/unhides them
  const handleHiddenNodesChange = useCallback((nodeIds: string[]) => {
    const activeId = runSlots.activeSlotId
    if (activeId && activeId !== ORIGINAL_SLOT_ID && slug) {
      updateAppRunInputs(slug, activeId, undefined, undefined, nodeIds).catch(() => {})
    }
  }, [runSlots.activeSlotId, slug])

  // Persist edited node states (from media edit) to the backend
  const handleNodeStatesChange = useCallback((editedNodeStates: Record<string, unknown>) => {
    const activeId = runSlots.activeSlotId
    if (activeId && activeId !== ORIGINAL_SLOT_ID && slug) {
      updateAppRunInputs(slug, activeId, undefined, undefined, undefined, editedNodeStates).catch(() => {})
    }
  }, [runSlots.activeSlotId, slug])

  // Loading / error states — show spinner until app is loaded (no blank flash)
  if (errorMessage && !app) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">App Not Found</h1>
          <p className="text-muted-foreground mb-4">{errorMessage}</p>
          <Link to="/projects" className="text-[#ff0073] hover:underline">
            Go to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  if (!app) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const deleteDialog = (
    <Dialog open={runSlots.deleteConfirmSlotId !== null} onOpenChange={(open) => { if (!open) runSlots.setDeleteConfirmSlotId(null) }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move to archive</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This run will be moved to your archive. You can restore it or permanently delete it from <Link to="/archived-runs" className="underline">Archived runs</Link>.
        </p>
        <DialogFooter className="flex gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => runSlots.setDeleteConfirmSlotId(null)} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={runSlots.handleConfirmDelete}>
            Move to archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  if (isMobile) {
    return (
      <>
        <MobileAppShell
          app={app}
          user={user ?? null}
          runSlots={runSlots}
          cancel={cancel}
          initialRunId={initialRunId}
        />
        {deleteDialog}
      </>
    )
  }

  return (
    <AppRunnerLayout
      showHistory={runSlots.showHistory && !!user}
      collapsed={runSlots.sidebarCollapsed}
      onCloseHistory={() => runSlots.setShowHistory(false)}
      sidebar={user ? (
        <RunsSidebar
          slots={runSlots.slots}
          activeSlotId={runSlots.activeSlotId}
          onSelectSlot={runSlots.handleSelectSlot}
          onCreateNew={runSlots.handleCreateNew}
          onDuplicateSlot={runSlots.handleDuplicateSlot}
          onDeleteSlot={runSlots.handleRequestDelete}
          onRenameSlot={runSlots.handleRenameSlot}
          onClose={runSlots.handleCloseSidebar}
          collapsed={runSlots.sidebarCollapsed}
          isLoadingRuns={runSlots.isLoadingRuns}
          versions={runSlots.versions}
          selectedVersion={runSlots.selectedVersion}
          onSelectVersion={runSlots.setSelectedVersion}
          latestVersion={runSlots.latestVersion}
        />
      ) : null}
    >
      {runSlots.isLoadingRun ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl bg-card/60 backdrop-blur-md border border-border/50 shadow-lg">
            <Loader2 className="h-6 w-6 animate-spin text-[#ff0073]" />
            <span className="text-sm text-muted-foreground">Loading run...</span>
          </div>
        </div>
      ) : (
        <PresentationView
          mode="fullscreen"
          isOwner={false}
          onCancel={cancel}
          onNewRun={user ? runSlots.handleHeaderAction : undefined}
          newRunLabel={runSlots.newRunLabel}
          inputsReadOnly={runSlots.inputsReadOnlyValue}
          suppressOutputFallback={(runSlots.activeSlotId !== null && runSlots.activeSlotId !== ORIGINAL_SLOT_ID) || !!initialRunId}
          showFullscreenToggle
          onHiddenNodesChange={handleHiddenNodesChange}
          onNodeStatesChange={handleNodeStatesChange}
          headerLeft={
            user && !runSlots.showHistory ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => runSlots.setShowHistory(true)}
                className="h-8 border-border bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted touch-manipulation shrink-0 md:hidden"
              >
                <Clock className="h-4 w-4 mr-1" />
                Runs
              </Button>
            ) : null
          }
          headerActions={
            user && runSlots.activeSlotId && runSlots.activeSlotId !== ORIGINAL_SLOT_ID ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Run actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      const url = new URL(window.location.href)
                      url.searchParams.set("run", runSlots.activeSlotId!)
                      navigator.clipboard.writeText(url.toString()).then(
                        () => toast.success("Link copied"),
                        () => toast.error("Failed to copy link"),
                      )
                    }}
                  >
                    <LinkIcon className="h-4 w-4 mr-2" />
                    Copy link to this run
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => runSlots.handleRequestDelete(runSlots.activeSlotId!)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Move to archive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null
          }
        />
      )}
      {deleteDialog}
    </AppRunnerLayout>
  )
}
