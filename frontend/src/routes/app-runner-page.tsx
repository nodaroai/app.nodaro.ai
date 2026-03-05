import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { Loader2, Clock, Plus, Trash2, ChevronLeft, RotateCcw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useAppRunnerStore, createBridgedRun } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { PresentationView } from "@/components/presentation/presentation-view"
import { Button } from "@/components/ui/button"
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "@/hooks/use-workflow-store"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import type { AppRun } from "@/lib/api"

export default function AppRunnerPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user, loading: authLoading } = useAuth()
  const [showHistory, setShowHistory] = useState(false)

  const loadApp = useAppRunnerStore((s) => s.loadApp)
  const loadRuns = useAppRunnerStore((s) => s.loadRuns)
  const app = useAppRunnerStore((s) => s.app)
  const loading = useAppRunnerStore((s) => s.loading)
  const errorMessage = useAppRunnerStore((s) => s.errorMessage)
  const runs = useAppRunnerStore((s) => s.runs)
  const activeRunId = useAppRunnerStore((s) => s.activeRunId)
  const selectRun = useAppRunnerStore((s) => s.selectRun)
  const newRun = useAppRunnerStore((s) => s.newRun)
  const deleteRun = useAppRunnerStore((s) => s.deleteRun)
  const cancel = useAppRunnerStore((s) => s.cancel)
  const reset = useAppRunnerStore((s) => s.reset)

  // Load app on mount — populates app runner store
  useEffect(() => {
    if (!authLoading && slug) {
      loadApp(slug)
    }
    return () => { reset() }
  }, [authLoading, slug, loadApp, reset])

  // When app loads, seed the presentation store with snapshot data + presentationSettings
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

  // Sync execution state from app runner store → presentation store
  const executionStatus = useAppRunnerStore((s) => s.executionStatus)
  const nodeStates = useAppRunnerStore((s) => s.nodeStates)
  const completedNodes = useAppRunnerStore((s) => s.completedNodes)
  const totalNodes = useAppRunnerStore((s) => s.totalNodes)

  useEffect(() => {
    usePresentationStore.setState({
      executionStatus,
      nodeStates,
      completedNodes,
      totalNodes,
    })
  }, [executionStatus, nodeStates, completedNodes, totalNodes])

  // Wire presentation store's run action to app runner store's run (with input bridging)
  const appRun = useAppRunnerStore((s) => s.run)
  useEffect(() => {
    usePresentationStore.setState({
      run: createBridgedRun(() => usePresentationStore.getState().inputValues),
    })
  }, [appRun])

  // Load runs when user is authenticated and app is loaded
  useEffect(() => {
    if (user && app) {
      loadRuns()
    }
  }, [user, app, loadRuns])

  const isTerminal = executionStatus === "completed" || executionStatus === "failed"

  if (authLoading || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (errorMessage && !app) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
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

  if (!app) return null

  return (
    <div className="h-screen flex">
      {/* Past runs sidebar */}
      {user && showHistory && (
        <PastRunsSidebar
          runs={runs}
          activeRunId={activeRunId}
          onSelectRun={selectRun}
          onNewRun={newRun}
          onDeleteRun={deleteRun}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* Main content — PresentationView reads from usePresentationStore */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Floating controls — above PresentationView header */}
        <div className="absolute top-[3.75rem] left-0 right-0 flex items-center justify-center z-20 pointer-events-none">
          {/* Past runs toggle — left side */}
          {user && runs.length > 0 && !showHistory && (
            <div className="absolute left-3 pointer-events-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHistory(true)}
                className="border-border bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Clock className="h-4 w-4 mr-1" />
                Past Runs ({runs.length})
              </Button>
            </div>
          )}

          {/* New Run button — center, visible after any execution or when viewing a past run */}
          {user && (isTerminal || activeRunId !== null) && (
            <div className="pointer-events-auto">
              <Button
                size="sm"
                onClick={newRun}
                className="bg-[#ff0073] hover:bg-[#ff0073]/90 text-white shadow-md"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                New Run
              </Button>
            </div>
          )}
        </div>

        <PresentationView mode="fullscreen" isOwner={false} onCancel={cancel} />
      </div>
    </div>
  )
}

function PastRunsSidebar({
  runs,
  activeRunId,
  onSelectRun,
  onNewRun,
  onDeleteRun,
  onClose,
}: {
  runs: AppRun[]
  activeRunId: string | null
  onSelectRun: (runId: string) => void
  onNewRun: () => void
  onDeleteRun: (runId: string) => void
  onClose: () => void
}) {
  return (
    <div className="w-72 border-r border-border bg-card flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 h-14 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Past Runs</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onNewRun} title="New run">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} title="Close">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => onSelectRun(run.id)}
            className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors group ${
              activeRunId === run.id ? "bg-muted/80" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {new Date(run.createdAt).toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <RunStatusBadge status={run.execution?.status} />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteRun(run.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-all"
                  title="Delete run"
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </button>
              </div>
            </div>
            {run.creditsUsed > 0 && (
              <span className="text-[10px] text-muted-foreground">{run.creditsUsed} credits</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function RunStatusBadge({ status }: { status?: string }) {
  if (!status) return null
  const colors: Record<string, string> = {
    completed: "bg-emerald-500/10 text-emerald-500",
    failed: "bg-red-500/10 text-red-500",
    running: "bg-blue-500/10 text-blue-500",
    pending: "bg-yellow-500/10 text-yellow-500",
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colors[status] ?? "text-muted-foreground"}`}>
      {status}
    </span>
  )
}
