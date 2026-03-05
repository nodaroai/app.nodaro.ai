import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useParams, Link } from "react-router-dom"
import { Loader2, Clock, Plus, Trash2, ChevronLeft } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useAppRunnerStore, createBridgedRun } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { PresentationView } from "@/components/presentation/presentation-view"
import { Button } from "@/components/ui/button"
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "@/hooks/use-workflow-store"
import { getInputNodes } from "@/lib/presentation-utils"
import { createAppRun, updateAppRunInputs, getAppRuns, deleteAppRun } from "@/lib/api"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

// --- Types ---

interface RunSlotNodeState {
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  output?: Record<string, unknown>
  error?: string
}

interface RunSlot {
  id: string
  inputValues: Record<string, Record<string, unknown>>
  nodeStates: Record<string, RunSlotNodeState>
  executionId: string | null
  executionStatus: "idle" | "running" | "completed" | "failed"
  completedNodes: number
  totalNodes: number
  createdAt: number
}

// --- Helpers ---

function makeEmptyInputs(inputNodes: WorkflowNode[]): Record<string, Record<string, unknown>> {
  const empty: Record<string, Record<string, unknown>> = {}
  for (const node of inputNodes) {
    const t = node.type ?? ""
    if (t === "text-prompt") empty[node.id] = { text: "" }
    else if (t === "upload-image" || t === "upload-video" || t === "upload-audio") empty[node.id] = { url: "" }
  }
  return empty
}

function toSlotStatus(s: string): RunSlot["executionStatus"] {
  if (s === "loading" || s === "running") return "running"
  if (s === "completed") return "completed"
  if (s === "failed") return "failed"
  return "idle"
}

function dbStatusToSlotStatus(s: string): RunSlot["executionStatus"] {
  if (s === "running" || s === "pending") return "running"
  if (s === "completed") return "completed"
  if (s === "failed" || s === "cancelled") return "failed"
  return "idle" // "draft"
}

// --- Component ---

export default function AppRunnerPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user, loading: authLoading } = useAuth()
  const [showHistory, setShowHistory] = useState(false)
  const [runsLoaded, setRunsLoaded] = useState(false)

  // Run slots (synced with DB)
  const [slots, setSlots] = useState<RunSlot[]>([])
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null)
  const activeSlot = useMemo(() => slots.find((s) => s.id === activeSlotId), [slots, activeSlotId])

  // App runner store
  const loadApp = useAppRunnerStore((s) => s.loadApp)
  const app = useAppRunnerStore((s) => s.app)
  const loading = useAppRunnerStore((s) => s.loading)
  const errorMessage = useAppRunnerStore((s) => s.errorMessage)
  const newRun = useAppRunnerStore((s) => s.newRun)
  const cancel = useAppRunnerStore((s) => s.cancel)
  const reset = useAppRunnerStore((s) => s.reset)
  const executionStatus = useAppRunnerStore((s) => s.executionStatus)
  const nodeStates = useAppRunnerStore((s) => s.nodeStates)
  const completedNodes = useAppRunnerStore((s) => s.completedNodes)
  const totalNodes = useAppRunnerStore((s) => s.totalNodes)
  const storeExecutionId = useAppRunnerStore((s) => s.executionId)
  const appRun = useAppRunnerStore((s) => s.run)

  // Input nodes (for building empty input maps)
  const presNodes = usePresentationStore((s) => s.nodes)
  const inputNodes = useMemo(() => getInputNodes(presNodes, true), [presNodes])

  // Load app on mount
  useEffect(() => {
    if (!authLoading && slug) loadApp(slug)
    return () => { reset() }
  }, [authLoading, slug, loadApp, reset])

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

  // Load past runs from DB when app is ready and user is authenticated
  useEffect(() => {
    if (!app || !user || !slug || runsLoaded) return
    setRunsLoaded(true)

    getAppRuns(slug).then(({ data }) => {
      if (!data || data.length === 0) return
      const dbSlots: RunSlot[] = data.map((run) => ({
        id: run.id,
        inputValues: (run.inputValues ?? {}) as Record<string, Record<string, unknown>>,
        nodeStates: (run.nodeStates ?? {}) as Record<string, RunSlotNodeState>,
        executionId: run.executionId ?? null,
        executionStatus: dbStatusToSlotStatus(run.status),
        completedNodes: run.completedNodes ?? 0,
        totalNodes: run.totalNodes ?? 0,
        createdAt: new Date(run.createdAt).getTime(),
      }))
      setSlots(dbSlots)
    }).catch(() => {
      // silently fail — user may not be authenticated
    })
  }, [app, user, slug, runsLoaded])

  // Sync execution state: app runner store -> presentation store + active slot
  useEffect(() => {
    usePresentationStore.setState({ executionStatus, nodeStates, completedNodes, totalNodes })

    if (activeSlotId) {
      setSlots((prev) => prev.map((s) =>
        s.id === activeSlotId
          ? { ...s, nodeStates: nodeStates as Record<string, RunSlotNodeState>, executionStatus: toSlotStatus(executionStatus), completedNodes, totalNodes }
          : s,
      ))
    }
  }, [executionStatus, nodeStates, completedNodes, totalNodes, activeSlotId])

  // Sync executionId to active slot
  useEffect(() => {
    if (activeSlotId && storeExecutionId) {
      setSlots((prev) => prev.map((s) =>
        s.id === activeSlotId ? { ...s, executionId: storeExecutionId } : s,
      ))
    }
  }, [storeExecutionId, activeSlotId])

  // Wire run action — saves slot inputs before running, passes runId to backend
  const activeSlotIdRef = useRef(activeSlotId)
  activeSlotIdRef.current = activeSlotId

  useEffect(() => {
    const bridgedRun = createBridgedRun(
      () => usePresentationStore.getState().inputValues,
      () => activeSlotIdRef.current,
    )
    usePresentationStore.setState({
      run: async () => {
        const slotId = activeSlotIdRef.current
        if (slotId) {
          const inputs = usePresentationStore.getState().inputValues
          setSlots((prev) => prev.map((s) => s.id === slotId ? { ...s, inputValues: inputs } : s))
          // Save inputs to DB before running
          if (slug) {
            updateAppRunInputs(slug, slotId, inputs).catch(() => {})
          }
        }
        await bridgedRun()
      },
    })
  }, [appRun, slug])

  // Save current slot inputs from presentation store
  const saveCurrentSlotInputs = useCallback(() => {
    if (!activeSlotId) return
    const inputs = usePresentationStore.getState().inputValues
    setSlots((prev) => prev.map((s) => s.id === activeSlotId ? { ...s, inputValues: inputs } : s))
    // Persist to DB
    if (slug) {
      updateAppRunInputs(slug, activeSlotId, inputs).catch(() => {})
    }
  }, [activeSlotId, slug])

  // Create New — create a new empty slot (persisted to DB)
  const handleCreateNew = useCallback(async () => {
    saveCurrentSlotInputs()
    const emptyInputs = makeEmptyInputs(inputNodes)

    if (!slug || !user) return

    try {
      const dbRun = await createAppRun(slug, emptyInputs)
      const slot: RunSlot = {
        id: dbRun.id,
        inputValues: emptyInputs,
        nodeStates: {},
        executionId: null,
        executionStatus: "idle",
        completedNodes: 0,
        totalNodes: 0,
        createdAt: new Date(dbRun.createdAt).getTime(),
      }
      setSlots((prev) => [slot, ...prev])
      setActiveSlotId(slot.id)
      newRun()
      usePresentationStore.setState({
        inputValues: emptyInputs,
        nodeStates: {},
        executionStatus: "idle",
        completedNodes: 0,
        totalNodes: 0,
      })
    } catch {
      // Fallback: create local slot if DB fails
      const slot: RunSlot = {
        id: crypto.randomUUID(),
        inputValues: emptyInputs,
        nodeStates: {},
        executionId: null,
        executionStatus: "idle",
        completedNodes: 0,
        totalNodes: 0,
        createdAt: Date.now(),
      }
      setSlots((prev) => [slot, ...prev])
      setActiveSlotId(slot.id)
      newRun()
      usePresentationStore.setState({
        inputValues: emptyInputs,
        nodeStates: {},
        executionStatus: "idle",
        completedNodes: 0,
        totalNodes: 0,
      })
    }
  }, [saveCurrentSlotInputs, inputNodes, newRun, slug, user])

  // Clear — reset current slot's inputs
  const handleClear = useCallback(() => {
    if (!activeSlotId) return
    const emptyInputs = makeEmptyInputs(inputNodes)
    setSlots((prev) => prev.map((s) =>
      s.id === activeSlotId
        ? { ...s, inputValues: emptyInputs, nodeStates: {}, executionId: null, executionStatus: "idle" as const, completedNodes: 0, totalNodes: 0 }
        : s,
    ))
    newRun()
    usePresentationStore.setState({
      inputValues: emptyInputs,
      nodeStates: {},
      executionStatus: "idle",
      completedNodes: 0,
      totalNodes: 0,
    })
    // Persist cleared inputs to DB
    if (slug) {
      updateAppRunInputs(slug, activeSlotId, emptyInputs).catch(() => {})
    }
  }, [activeSlotId, inputNodes, newRun, slug])

  // Header button: "Clear" when editing idle slot, "Create New" otherwise
  const isSlotIdle = activeSlot?.executionStatus === "idle"
  const handleHeaderAction = useCallback(() => {
    if (isSlotIdle) handleClear()
    else handleCreateNew()
  }, [isSlotIdle, handleClear, handleCreateNew])
  const newRunLabel = isSlotIdle ? "Clear" : "Create New"

  // Select slot
  const handleSelectSlot = useCallback((slotId: string) => {
    if (slotId === activeSlotId) return
    saveCurrentSlotInputs()
    const slot = slots.find((s) => s.id === slotId)
    if (!slot) return

    setActiveSlotId(slotId)

    // Apply slot data to presentation store
    usePresentationStore.setState({
      inputValues: slot.inputValues,
      nodeStates: slot.nodeStates,
      executionStatus: slot.executionStatus === "running" ? "running" : slot.executionStatus,
      completedNodes: slot.completedNodes,
      totalNodes: slot.totalNodes,
    })

    // Handle app runner store execution state
    if (slot.executionId && slot.executionStatus === "running") {
      useAppRunnerStore.getState().resumeExecution(slot.executionId)
    } else {
      newRun() // clears poll timeout
      if (slot.executionId) {
        useAppRunnerStore.setState({
          executionId: slot.executionId,
          executionStatus: slot.executionStatus as "idle" | "running" | "completed" | "failed",
          nodeStates: slot.nodeStates,
          completedNodes: slot.completedNodes,
          totalNodes: slot.totalNodes,
        })
      }
    }
  }, [activeSlotId, saveCurrentSlotInputs, slots, newRun])

  // Delete slot (from DB too)
  const handleDeleteSlot = useCallback((slotId: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== slotId))
    if (activeSlotId === slotId) {
      setActiveSlotId(null)
      newRun()
      usePresentationStore.setState({
        inputValues: {},
        nodeStates: {},
        executionStatus: "idle",
        completedNodes: 0,
        totalNodes: 0,
      })
    }
    // Delete from DB
    if (slug) {
      deleteAppRun(slug, slotId).catch(() => {})
    }
  }, [activeSlotId, newRun, slug])

  // Derived state
  const isRunning = executionStatus === "running"
  const isTerminal = activeSlot?.executionStatus === "completed" || activeSlot?.executionStatus === "failed"
  const inputsReadOnlyValue = !activeSlotId || isRunning || isTerminal

  // Loading / error states
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
      {/* Run slots sidebar */}
      {user && showHistory && (
        <RunsSidebar
          slots={slots}
          activeSlotId={activeSlotId}
          onSelectSlot={handleSelectSlot}
          onCreateNew={handleCreateNew}
          onDeleteSlot={handleDeleteSlot}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Runs toggle button */}
        {user && slots.length > 0 && !showHistory && (
          <div className="absolute top-[3.75rem] left-3 z-20">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistory(true)}
              className="border-border bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Clock className="h-4 w-4 mr-1" />
              Runs ({slots.length})
            </Button>
          </div>
        )}

        <PresentationView
          mode="fullscreen"
          isOwner={false}
          onCancel={cancel}
          onNewRun={handleHeaderAction}
          newRunLabel={newRunLabel}
          inputsReadOnly={inputsReadOnlyValue}
          suppressOutputFallback={activeSlotId !== null}
        />
      </div>
    </div>
  )
}

// --- Sidebar ---

function RunsSidebar({
  slots,
  activeSlotId,
  onSelectSlot,
  onCreateNew,
  onDeleteSlot,
  onClose,
}: {
  slots: RunSlot[]
  activeSlotId: string | null
  onSelectSlot: (slotId: string) => void
  onCreateNew: () => void
  onDeleteSlot: (slotId: string) => void
  onClose: () => void
}) {
  return (
    <div className="w-72 border-r border-border bg-card flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 h-14 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Runs</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onCreateNew} title="New run">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} title="Close">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {slots.map((slot) => (
          <button
            key={slot.id}
            type="button"
            onClick={() => onSelectSlot(slot.id)}
            className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors group ${
              activeSlotId === slot.id ? "bg-muted/80" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {new Date(slot.createdAt).toLocaleTimeString()}
              </span>
              <div className="flex items-center gap-1">
                <SlotStatusBadge status={slot.executionStatus} />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteSlot(slot.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-all"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </button>
              </div>
            </div>
          </button>
        ))}
        {slots.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            Click + to create a new run
          </div>
        )}
      </div>
    </div>
  )
}

function SlotStatusBadge({ status }: { status: RunSlot["executionStatus"] }) {
  const config: Record<string, { label: string; className: string }> = {
    idle: { label: "draft", className: "bg-muted text-muted-foreground" },
    running: { label: "running", className: "bg-blue-500/10 text-blue-500" },
    completed: { label: "done", className: "bg-emerald-500/10 text-emerald-500" },
    failed: { label: "failed", className: "bg-red-500/10 text-red-500" },
  }
  const c = config[status] ?? config.idle
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.className}`}>
      {c.label}
    </span>
  )
}
