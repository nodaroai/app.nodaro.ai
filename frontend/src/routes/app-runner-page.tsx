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

// --- Component ---

export default function AppRunnerPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user, loading: authLoading } = useAuth()
  const [showHistory, setShowHistory] = useState(false)

  // Run slots (local, within session)
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

  // Wire run action — saves slot inputs before running
  const activeSlotIdRef = useRef(activeSlotId)
  activeSlotIdRef.current = activeSlotId

  useEffect(() => {
    const bridgedRun = createBridgedRun(() => usePresentationStore.getState().inputValues)
    usePresentationStore.setState({
      run: async () => {
        const slotId = activeSlotIdRef.current
        if (slotId) {
          const inputs = usePresentationStore.getState().inputValues
          setSlots((prev) => prev.map((s) => s.id === slotId ? { ...s, inputValues: inputs } : s))
        }
        await bridgedRun()
      },
    })
  }, [appRun])

  // Save current slot inputs from presentation store
  const saveCurrentSlotInputs = useCallback(() => {
    if (!activeSlotId) return
    const inputs = usePresentationStore.getState().inputValues
    setSlots((prev) => prev.map((s) => s.id === activeSlotId ? { ...s, inputValues: inputs } : s))
  }, [activeSlotId])

  // Create New — create a new empty slot
  const handleCreateNew = useCallback(() => {
    saveCurrentSlotInputs()
    const emptyInputs = makeEmptyInputs(inputNodes)
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
  }, [saveCurrentSlotInputs, inputNodes, newRun])

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
  }, [activeSlotId, inputNodes, newRun])

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

  // Delete slot
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
  }, [activeSlotId, newRun])

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
