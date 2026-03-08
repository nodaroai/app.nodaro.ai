import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { Loader2, Clock } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
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
import { useRunSlots, AppRunnerLayout, RunsSidebar } from "@/components/app-runner"

export default function AppRunnerPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuth()

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

  // Seed presentation store when app loads
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
      executionStatus: "idle",
      nodeStates: {},
    })
  }, [app])

  // Run slots hook — all slot state, CRUD, DB sync
  const runSlots = useRunSlots({ slug, user, persistRuns: !!user })

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

  return (
    <AppRunnerLayout
      showHistory={runSlots.showHistory && !!user}
      onCloseHistory={() => runSlots.setShowHistory(false)}
      sidebar={
        <RunsSidebar
          slots={runSlots.slots}
          activeSlotId={runSlots.activeSlotId}
          onSelectSlot={runSlots.handleSelectSlot}
          onCreateNew={runSlots.handleCreateNew}
          onDuplicateSlot={runSlots.handleDuplicateSlot}
          onDeleteSlot={runSlots.handleRequestDelete}
          onRenameSlot={runSlots.handleRenameSlot}
          onClose={() => runSlots.setShowHistory(false)}
          versions={runSlots.versions}
          selectedVersion={runSlots.selectedVersion}
          onSelectVersion={runSlots.setSelectedVersion}
          latestVersion={runSlots.latestVersion}
        />
      }
      runsButton={
        user && runSlots.slots.length > 0 && !runSlots.showHistory ? (
          <div className="absolute top-[5.5rem] md:top-[3.75rem] left-3 z-20">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runSlots.setShowHistory(true)}
              className="h-8 border-border bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted touch-manipulation"
            >
              <Clock className="h-4 w-4 mr-1" />
              Runs ({runSlots.slots.length})
            </Button>
          </div>
        ) : null
      }
    >
      <PresentationView
        mode="fullscreen"
        isOwner={false}
        onCancel={cancel}
        onNewRun={user ? runSlots.handleHeaderAction : undefined}
        newRunLabel={runSlots.newRunLabel}
        inputsReadOnly={runSlots.inputsReadOnlyValue}
        suppressOutputFallback={runSlots.activeSlotId !== null}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={runSlots.deleteConfirmSlotId !== null} onOpenChange={(open) => { if (!open) runSlots.setDeleteConfirmSlotId(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Run</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this run? This action cannot be undone.
          </p>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => runSlots.setDeleteConfirmSlotId(null)} autoFocus>
              Cancel
            </Button>
            <Button variant="destructive" onClick={runSlots.handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppRunnerLayout>
  )
}
