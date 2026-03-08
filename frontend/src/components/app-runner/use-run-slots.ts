import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useAppRunnerStore, createBridgedRun } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { getInputNodes } from "@/lib/presentation-utils"
import { createAppRun, updateAppRunInputs, getAppRuns, deleteAppRun } from "@/lib/api"
import type { WorkflowNode } from "@/types/nodes"
import type { RunSlot, RunSlotNodeState } from "./types"
import { makeEmptyInputs, toSlotStatus, dbStatusToSlotStatus } from "./types"

interface UseRunSlotsOptions {
  slug: string | undefined
  user: { id: string } | null
  /** When false, skip DB calls (unauthenticated embed) */
  persistRuns: boolean
}

export function useRunSlots({ slug, user, persistRuns }: UseRunSlotsOptions) {
  const [showHistory, setShowHistory] = useState(false)
  const [runsLoaded, setRunsLoaded] = useState(false)
  const [slots, setSlots] = useState<RunSlot[]>([])
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null)
  const activeSlot = useMemo(() => slots.find((s) => s.id === activeSlotId), [slots, activeSlotId])
  const [deleteConfirmSlotId, setDeleteConfirmSlotId] = useState<string | null>(null)

  // App runner store
  const executionStatus = useAppRunnerStore((s) => s.executionStatus)
  const nodeStates = useAppRunnerStore((s) => s.nodeStates)
  const completedNodes = useAppRunnerStore((s) => s.completedNodes)
  const totalNodes = useAppRunnerStore((s) => s.totalNodes)
  const storeExecutionId = useAppRunnerStore((s) => s.executionId)
  const appRun = useAppRunnerStore((s) => s.run)
  const newRun = useAppRunnerStore((s) => s.newRun)
  const app = useAppRunnerStore((s) => s.app)

  // Input nodes (for building empty input maps)
  const presNodes = usePresentationStore((s) => s.nodes)
  const inputNodes = useMemo(() => getInputNodes(presNodes, true), [presNodes])

  // Selected version for new runs
  const selectedVersion = useAppRunnerStore((s) => s.selectedVersion)
  const setSelectedVersion = useAppRunnerStore((s) => s.setSelectedVersion)
  const versions = app?.versions ?? []
  const latestVersion = versions.length > 0
    ? Math.max(...versions.map((v: { version: number }) => v.version))
    : app?.version ?? 1

  // Load past runs from DB when app is ready and user is authenticated
  useEffect(() => {
    if (!app || !user || !slug || runsLoaded || !persistRuns) return
    setRunsLoaded(true)

    getAppRuns(slug).then(({ data }) => {
      if (!data || data.length === 0) return
      const dbSlots: RunSlot[] = data.map((run) => ({
        id: run.id,
        name: run.name ?? null,
        inputValues: (run.inputValues ?? {}) as Record<string, Record<string, unknown>>,
        nodeStates: (run.nodeStates ?? {}) as Record<string, RunSlotNodeState>,
        executionId: run.executionId ?? null,
        executionStatus: dbStatusToSlotStatus(run.status),
        completedNodes: run.completedNodes ?? 0,
        totalNodes: run.totalNodes ?? 0,
        creditsUsed: run.creditsUsed ?? 0,
        createdAt: new Date(run.createdAt).getTime(),
        version: run.version ?? null,
        thumbnailUrl: run.thumbnailUrl ?? null,
      }))
      setSlots(dbSlots)
    }).catch(() => {
      // silently fail — user may not be authenticated
    })
  }, [app, user, slug, runsLoaded, persistRuns])

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
          if (slug && persistRuns) {
            updateAppRunInputs(slug, slotId, inputs).catch(() => {})
          }
        }
        await bridgedRun()
      },
    })
  }, [appRun, slug, persistRuns])

  // Save current slot inputs from presentation store
  const saveCurrentSlotInputs = useCallback(() => {
    if (!activeSlotId) return
    const inputs = usePresentationStore.getState().inputValues
    setSlots((prev) => prev.map((s) => s.id === activeSlotId ? { ...s, inputValues: inputs } : s))
    // Persist to DB
    if (slug && persistRuns) {
      updateAppRunInputs(slug, activeSlotId, inputs).catch(() => {})
    }
  }, [activeSlotId, slug, persistRuns])

  // Create New — create a new empty slot (persisted to DB if authenticated)
  const handleCreateNew = useCallback(async () => {
    saveCurrentSlotInputs()
    const emptyInputs = makeEmptyInputs(inputNodes)

    const runVersion = selectedVersion ?? undefined

    if (slug && user && persistRuns) {
      try {
        const dbRun = await createAppRun(slug, emptyInputs, runVersion)
        const slot: RunSlot = {
          id: dbRun.id,
          name: null,
          inputValues: emptyInputs,
          nodeStates: {},
          executionId: null,
          executionStatus: "idle",
          completedNodes: 0,
          totalNodes: 0,
          creditsUsed: 0,
          createdAt: new Date(dbRun.createdAt).getTime(),
          version: selectedVersion ?? latestVersion,
          thumbnailUrl: null,
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
        return
      } catch {
        // Fallback to local slot
      }
    }

    // Local-only slot (unauthenticated or DB fail)
    const slot: RunSlot = {
      id: crypto.randomUUID(),
      name: null,
      inputValues: emptyInputs,
      nodeStates: {},
      executionId: null,
      executionStatus: "idle",
      completedNodes: 0,
      totalNodes: 0,
      creditsUsed: 0,
      createdAt: Date.now(),
      version: selectedVersion ?? latestVersion,
      thumbnailUrl: null,
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
  }, [saveCurrentSlotInputs, inputNodes, newRun, slug, user, selectedVersion, latestVersion, persistRuns])

  // Clear — reset current slot's inputs
  const handleClear = useCallback(() => {
    if (!activeSlotId) return
    const emptyInputs = makeEmptyInputs(inputNodes)
    setSlots((prev) => prev.map((s) =>
      s.id === activeSlotId
        ? { ...s, inputValues: emptyInputs, nodeStates: {}, executionId: null, executionStatus: "idle" as const, completedNodes: 0, totalNodes: 0, version: s.version }
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
    if (slug && persistRuns) {
      updateAppRunInputs(slug, activeSlotId, emptyInputs).catch(() => {})
    }
  }, [activeSlotId, inputNodes, newRun, slug, persistRuns])

  // Retry — reset failed slot to idle (keep inputs), so Run becomes available
  const handleRetry = useCallback(() => {
    if (!activeSlotId) return
    setSlots((prev) => prev.map((s) =>
      s.id === activeSlotId
        ? { ...s, nodeStates: {}, executionId: null, executionStatus: "idle" as const, completedNodes: 0, totalNodes: 0 }
        : s,
    ))
    newRun()
    usePresentationStore.setState({
      inputValues: activeSlot?.inputValues ?? {},
      nodeStates: {},
      executionStatus: "idle",
      completedNodes: 0,
      totalNodes: 0,
    })
  }, [activeSlotId, activeSlot?.inputValues, newRun])

  // Duplicate — create a new draft with same inputs as given slot
  const handleDuplicateSlot = useCallback(async (slotId: string) => {
    const slot = slots.find((s) => s.id === slotId)
    if (!slot) return

    const runVersion = selectedVersion ?? undefined

    if (slug && user && persistRuns) {
      try {
        const dbRun = await createAppRun(slug, slot.inputValues, runVersion)
        const newSlot: RunSlot = {
          id: dbRun.id,
          name: null,
          inputValues: { ...slot.inputValues },
          nodeStates: {},
          executionId: null,
          executionStatus: "idle",
          completedNodes: 0,
          totalNodes: 0,
          creditsUsed: 0,
          createdAt: new Date(dbRun.createdAt).getTime(),
          version: selectedVersion ?? latestVersion,
          thumbnailUrl: null,
        }
        setSlots((prev) => [newSlot, ...prev])
        setActiveSlotId(newSlot.id)
        newRun()
        usePresentationStore.setState({
          inputValues: newSlot.inputValues,
          nodeStates: {},
          executionStatus: "idle",
          completedNodes: 0,
          totalNodes: 0,
        })
        return
      } catch {
        // silently fail
      }
    }

    // Local-only fallback
    const newSlot: RunSlot = {
      id: crypto.randomUUID(),
      name: null,
      inputValues: { ...slot.inputValues },
      nodeStates: {},
      executionId: null,
      executionStatus: "idle",
      completedNodes: 0,
      totalNodes: 0,
      creditsUsed: 0,
      createdAt: Date.now(),
      version: selectedVersion ?? latestVersion,
      thumbnailUrl: null,
    }
    setSlots((prev) => [newSlot, ...prev])
    setActiveSlotId(newSlot.id)
    newRun()
    usePresentationStore.setState({
      inputValues: newSlot.inputValues,
      nodeStates: {},
      executionStatus: "idle",
      completedNodes: 0,
      totalNodes: 0,
    })
  }, [slots, slug, user, newRun, selectedVersion, latestVersion, persistRuns])

  // Header button: "Clear" when idle, "Retry" when failed, "Create New" otherwise
  const isSlotIdle = activeSlot?.executionStatus === "idle"
  const isSlotFailed = activeSlot?.executionStatus === "failed"
  const handleHeaderAction = useCallback(() => {
    if (isSlotIdle) handleClear()
    else if (isSlotFailed) handleRetry()
    else handleCreateNew()
  }, [isSlotIdle, isSlotFailed, handleClear, handleRetry, handleCreateNew])
  const newRunLabel = isSlotIdle ? "Clear" : isSlotFailed ? "Retry" : "Create New"

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
      executionStatus: slot.executionStatus,
      completedNodes: slot.completedNodes,
      totalNodes: slot.totalNodes,
    })

    // Set app runner store — changing executionId causes poll guard to
    // discard any in-flight responses from a previous execution
    if (slot.executionId && slot.executionStatus === "running") {
      useAppRunnerStore.getState().resumeExecution(slot.executionId)
    } else {
      useAppRunnerStore.setState({
        activeRunId: slotId,
        executionId: slot.executionId ?? null,
        executionStatus: slot.executionStatus as "idle" | "running" | "completed" | "failed",
        nodeStates: slot.nodeStates,
        completedNodes: slot.completedNodes,
        totalNodes: slot.totalNodes,
        errorMessage: null,
      })
    }
  }, [activeSlotId, saveCurrentSlotInputs, slots])

  // Delete slot — request confirmation
  const handleRequestDelete = useCallback((slotId: string) => {
    setDeleteConfirmSlotId(slotId)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (!deleteConfirmSlotId) return
    const slotId = deleteConfirmSlotId
    setDeleteConfirmSlotId(null)

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
    if (slug && persistRuns) {
      deleteAppRun(slug, slotId).catch(() => {})
    }
  }, [deleteConfirmSlotId, activeSlotId, newRun, slug, persistRuns])

  // Rename slot
  const handleRenameSlot = useCallback((slotId: string, name: string | null) => {
    setSlots((prev) => prev.map((s) => s.id === slotId ? { ...s, name } : s))
    if (slug && persistRuns) {
      updateAppRunInputs(slug, slotId, undefined, name).catch(() => {})
    }
  }, [slug, persistRuns])

  // Navigate between runs with up/down arrow keys (global)
  useEffect(() => {
    if (slots.length === 0) return
    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return

      e.preventDefault()
      const currentIndex = activeSlotId ? slots.findIndex((s) => s.id === activeSlotId) : -1

      let nextIndex: number
      if (e.key === "ArrowDown") {
        nextIndex = currentIndex < slots.length - 1 ? currentIndex + 1 : 0
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : slots.length - 1
      }

      handleSelectSlot(slots[nextIndex].id)
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [slots, activeSlotId, handleSelectSlot])

  // Derived state
  const isRunning = executionStatus === "running"
  const isTerminal = activeSlot?.executionStatus === "completed" || activeSlot?.executionStatus === "failed"
  const inputsReadOnlyValue = !activeSlotId || isRunning || isTerminal

  return {
    // State
    slots,
    activeSlotId,
    activeSlot,
    showHistory,
    setShowHistory,
    deleteConfirmSlotId,
    setDeleteConfirmSlotId,

    // Callbacks
    handleCreateNew,
    handleClear,
    handleRetry,
    handleDuplicateSlot,
    handleHeaderAction,
    handleSelectSlot,
    handleRequestDelete,
    handleConfirmDelete,
    handleRenameSlot,

    // Derived
    newRunLabel,
    isRunning,
    inputsReadOnlyValue,

    // Version
    selectedVersion,
    setSelectedVersion,
    versions,
    latestVersion,
  }
}
