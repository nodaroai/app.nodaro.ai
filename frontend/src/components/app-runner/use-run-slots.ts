import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useAppRunnerStore, createBridgedRun } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { getInputNodes, getOutputNodes } from "@/lib/presentation-utils"
import { createAppRun, updateAppRunInputs, getAppRuns, deleteAppRun } from "@/lib/api"
import type { RunSlot, RunSlotNodeState } from "./types"
import { ORIGINAL_SLOT_ID, makeEmptyInputs, makeSnapshotInputs, makeSnapshotNodeStates, toSlotStatus, dbStatusToSlotStatus } from "./types"
import { isMediaUrl } from "./types"

/** Reset presentation store to idle state with given inputs */
function resetPresentationToIdle(inputValues: Record<string, Record<string, unknown>>) {
  usePresentationStore.setState({
    inputValues,
    nodeStates: {},
    executionStatus: "idle",
    completedNodes: 0,
    totalNodes: 0,
    errorMessage: null,
  })
}

/** Apply a slot's execution state to the presentation store */
function applySlotToPresentation(slot: Pick<RunSlot, "inputValues" | "nodeStates" | "executionStatus" | "completedNodes" | "totalNodes" | "hiddenNodes">) {
  const base = {
    inputValues: slot.inputValues,
    nodeStates: slot.nodeStates,
    executionStatus: slot.executionStatus,
    completedNodes: slot.completedNodes,
    totalNodes: slot.totalNodes,
    errorMessage: null as string | null,
  }
  // Seed hiddenNodes into presentationSettings so PresentationView picks them up
  if (slot.hiddenNodes && slot.hiddenNodes.length > 0) {
    const currentSettings = usePresentationStore.getState().presentationSettings
    usePresentationStore.setState({ ...base, presentationSettings: { ...currentSettings, hiddenNodes: slot.hiddenNodes } })
  } else {
    usePresentationStore.setState(base)
  }
}

interface UseRunSlotsOptions {
  slug: string | undefined
  user: { id: string } | null
  /** When false, skip DB calls (unauthenticated embed) */
  persistRuns: boolean
  /** Auto-select this run slot on load (from ?run= query param) */
  initialRunId?: string
  /** Override default sidebar state (from ?sidebar= query param) */
  initialSidebar?: "open" | "closed" | null
}

export function useRunSlots({ slug, user, persistRuns, initialRunId, initialSidebar }: UseRunSlotsOptions) {
  const [showHistory, setShowHistory] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [runsLoaded, setRunsLoaded] = useState(false)
  const [runsFetchDone, setRunsFetchDone] = useState(false)
  const [slots, setSlots] = useState<RunSlot[]>([])
  const [pendingRunId, setPendingRunId] = useState<string | null>(initialRunId ?? null)
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null)
  // activeSlot is computed after allSlots is built (below)
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

  // Input/output nodes (for building empty input maps and original slot)
  const presNodes = usePresentationStore((s) => s.nodes)
  const presEdges = usePresentationStore((s) => s.edges)
  const inputNodes = useMemo(() => getInputNodes(presNodes, true), [presNodes])
  const outputNodes = useMemo(() => getOutputNodes(presNodes, presEdges, true), [presNodes, presEdges])

  // Selected version for new runs
  const selectedVersion = useAppRunnerStore((s) => s.selectedVersion)
  const setSelectedVersion = useAppRunnerStore((s) => s.setSelectedVersion)
  const versions = app?.versions ?? []
  const latestVersion = versions.length > 0
    ? Math.max(...versions.map((v: { version: number }) => v.version))
    : app?.version ?? 1

  // Build the synthetic "Original" slot from published snapshot data
  const originalSlot = useMemo<RunSlot | null>(() => {
    if (!app) return null
    const snapshotInputs = makeSnapshotInputs(inputNodes)
    const snapshotStates = makeSnapshotNodeStates(outputNodes)
    const hasOutputs = Object.keys(snapshotStates).length > 0

    // Find first output URL for thumbnail
    let thumbnailUrl: string | null = null
    for (const state of Object.values(snapshotStates)) {
      const url = state.output?.url as string | undefined
      if (url && isMediaUrl(url)) {
        thumbnailUrl = url
        break
      }
    }

    return {
      id: ORIGINAL_SLOT_ID,
      name: "Original",
      inputValues: snapshotInputs,
      nodeStates: snapshotStates,
      executionId: null,
      executionStatus: hasOutputs ? "completed" : "idle",
      completedNodes: hasOutputs ? outputNodes.length : 0,
      totalNodes: outputNodes.length,
      creditsUsed: 0,
      createdAt: new Date(app.createdAt).getTime(),
      version: app.version,
      thumbnailUrl,
    }
  }, [app, inputNodes, outputNodes])

  // Merge original slot (always first) with user slots
  const allSlots = useMemo(() => {
    if (!originalSlot) return slots
    return [originalSlot, ...slots]
  }, [originalSlot, slots])

  const activeSlot = useMemo(() => allSlots.find((s) => s.id === activeSlotId), [allSlots, activeSlotId])

  // Track whether initial params have been applied
  const initialAppliedRef = useRef(false)

  // Reset local state when slug changes (prevents stale slots from previous app)
  const prevSlugRef = useRef(slug)
  useEffect(() => {
    if (prevSlugRef.current === slug) return
    prevSlugRef.current = slug
    setSlots([])
    setActiveSlotId(null)
    setRunsLoaded(false)
    setRunsFetchDone(false)
    setPendingRunId(null)
    initialAppliedRef.current = false
  }, [slug])

  // Auto-open sidebar on desktop + apply initial run/sidebar params
  // Wait for presNodes to be seeded (otherwise originalSlot is built from empty nodes)
  useEffect(() => {
    if (!allSlots.length || initialAppliedRef.current) return
    if (presNodes.length === 0) return
    initialAppliedRef.current = true

    // Auto-select from URL param, or default to "original"
    const targetId = initialRunId ?? ORIGINAL_SLOT_ID
    const target = allSlots.find((s) => s.id === targetId)
    if (target) {
      // Apply slot data directly (handleSelectSlot checks activeSlotId which is null)
      setActiveSlotId(target.id)
      applySlotToPresentation(target)
      useAppRunnerStore.setState({
        activeRunId: target.id,
        executionId: target.executionId ?? null,
        executionStatus: target.executionStatus as "idle" | "running" | "completed" | "failed",
        nodeStates: target.nodeStates,
        completedNodes: target.completedNodes,
        totalNodes: target.totalNodes,
        errorMessage: null,
      })
    }

    // Sidebar: on desktop always visible (collapsed/expanded), on mobile overlay
    // ?sidebar=closed → collapse on desktop, hide on mobile
    // ?sidebar=open → expand on desktop, show on mobile
    const isDesktop = window.matchMedia("(min-width: 768px)").matches
    if (initialSidebar === "closed") {
      if (isDesktop) {
        setSidebarCollapsed(true)
      } else {
        setShowHistory(false)
      }
    } else if (initialSidebar === "open") {
      setShowHistory(true)
      setSidebarCollapsed(false)
    } else {
      // Default: read from localStorage, fall back to collapsed
      const stored = localStorage.getItem("app-sidebar-collapsed")
      const collapsed = stored !== null ? stored === "true" : true
      if (isDesktop) {
        setSidebarCollapsed(collapsed)
        setShowHistory(true)
      } else {
        setShowHistory(false)
      }
    }
  }, [allSlots.length, presNodes.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load past runs from DB when app is ready and user is authenticated
  useEffect(() => {
    if (!app || !user || !slug || runsLoaded || !persistRuns) return
    setRunsLoaded(true)

    getAppRuns(slug).then(({ data }) => {
      if (!data || data.length === 0) {
        setRunsFetchDone(true)
        setPendingRunId(null)
        return
      }
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
        hiddenNodes: run.hiddenNodes ?? undefined,
      }))
      setSlots(dbSlots)

      // If initialRunId targets a DB run that wasn't available during init, select it now
      if (initialRunId) {
        const target = dbSlots.find((s) => s.id === initialRunId)
        if (target) {
          setActiveSlotId(target.id)
          applySlotToPresentation(target)
          useAppRunnerStore.setState({
            activeRunId: target.id,
            executionId: target.executionId ?? null,
            executionStatus: target.executionStatus as "idle" | "running" | "completed" | "failed",
            nodeStates: target.nodeStates,
            completedNodes: target.completedNodes,
            totalNodes: target.totalNodes,
            errorMessage: null,
          })
        }
      }
      setRunsFetchDone(true)
      setPendingRunId(null)
    }).catch(() => {
      // silently fail — user may not be authenticated
      setRunsFetchDone(true)
      setPendingRunId(null)
    })
  }, [app, user, slug, runsLoaded, persistRuns]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync execution state: app runner store -> presentation store + active slot
  // Guard: skip entirely when Original slot is active — its data is static snapshot
  useEffect(() => {
    if (activeSlotId === ORIGINAL_SLOT_ID) return

    usePresentationStore.setState({ executionStatus, nodeStates, completedNodes, totalNodes })

    if (activeSlotId) {
      const mapped = toSlotStatus(executionStatus)
      // Extract thumbnail when execution completes — prefer thumbnailNodeId, fall back to first media
      let thumbnailUrl: string | null = null
      if (mapped === "completed" && nodeStates) {
        const thumbNodeId = app?.thumbnailNodeId
        const extractUrl = (output: Record<string, unknown> | undefined): string | null => {
          const url = (output?.url ?? output?.imageUrl ?? output?.videoUrl ?? output?.audioUrl ?? output?.resultUrl) as string | undefined
          return url && isMediaUrl(url) ? url : null
        }
        if (thumbNodeId && nodeStates[thumbNodeId]) {
          thumbnailUrl = extractUrl(nodeStates[thumbNodeId].output)
        }
        if (!thumbnailUrl) {
          for (const state of Object.values(nodeStates)) {
            thumbnailUrl = extractUrl(state.output)
            if (thumbnailUrl) break
          }
        }
      }
      setSlots((prev) => prev.map((s) => {
        if (s.id !== activeSlotId) return s
        // Skip update when nothing changed to avoid unnecessary re-renders
        if (s.nodeStates === nodeStates && s.executionStatus === mapped && s.completedNodes === completedNodes && s.totalNodes === totalNodes && !thumbnailUrl) return s
        return { ...s, nodeStates: nodeStates as Record<string, RunSlotNodeState>, executionStatus: mapped, completedNodes, totalNodes, ...(thumbnailUrl ? { thumbnailUrl } : {}) }
      }))
    }
  }, [executionStatus, nodeStates, completedNodes, totalNodes, activeSlotId])

  // Sync executionId to active slot (guard: skip Original)
  useEffect(() => {
    if (activeSlotId && activeSlotId !== ORIGINAL_SLOT_ID && storeExecutionId) {
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

  // Create a fresh idle draft slot (DB-persisted when authenticated, else
  // local-only) seeded with the given inputs. Prepends it and returns it.
  const createDraftSlot = useCallback(
    async (inputValues: Record<string, Record<string, unknown>>): Promise<RunSlot> => {
      const runVersion = selectedVersion ?? undefined
      if (slug && user && persistRuns) {
        try {
          const dbRun = await createAppRun(slug, inputValues, runVersion)
          const newSlot: RunSlot = {
            id: dbRun.id, name: null, inputValues: { ...inputValues }, nodeStates: {},
            executionId: null, executionStatus: "idle", completedNodes: 0, totalNodes: 0,
            creditsUsed: 0, createdAt: new Date(dbRun.createdAt).getTime(),
            version: selectedVersion ?? latestVersion, thumbnailUrl: null,
          }
          setSlots((prev) => [newSlot, ...prev])
          return newSlot
        } catch {
          // fall through to a local-only slot
        }
      }
      const newSlot: RunSlot = {
        id: crypto.randomUUID(), name: null, inputValues: { ...inputValues }, nodeStates: {},
        executionId: null, executionStatus: "idle", completedNodes: 0, totalNodes: 0,
        creditsUsed: 0, createdAt: Date.now(),
        version: selectedVersion ?? latestVersion, thumbnailUrl: null,
      }
      setSlots((prev) => [newSlot, ...prev])
      return newSlot
    },
    [slug, user, persistRuns, selectedVersion, latestVersion],
  )

  // Create New — create a new empty draft slot and make it the active draft.
  const handleCreateNew = useCallback(async () => {
    saveCurrentSlotInputs()
    const emptyInputs = makeEmptyInputs(inputNodes)
    const slot = await createDraftSlot(emptyInputs)
    setActiveSlotId(slot.id)
    newRun()
    resetPresentationToIdle(emptyInputs)
    // Update URL for deep-linking on refresh
    const url = new URL(window.location.href)
    url.searchParams.set("run", slot.id)
    window.history.replaceState({}, "", url.toString())
  }, [saveCurrentSlotInputs, inputNodes, createDraftSlot, newRun])

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
    resetPresentationToIdle(emptyInputs)
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
    resetPresentationToIdle(activeSlot?.inputValues ?? {})
  }, [activeSlotId, activeSlot?.inputValues, newRun])

  // Duplicate — create a new draft with same inputs as given slot, made active.
  const handleDuplicateSlot = useCallback(async (slotId: string) => {
    const slot = allSlots.find((s) => s.id === slotId)
    if (!slot) return
    const newSlot = await createDraftSlot(slot.inputValues)
    setActiveSlotId(newSlot.id)
    newRun()
    resetPresentationToIdle(newSlot.inputValues)
  }, [allSlots, createDraftSlot, newRun])

  // Launch (chat composer) — snapshot the persistent draft (presentation-store
  // inputValues) into a NEW run slot and execute it WITHOUT clearing the draft,
  // so the user can tweak and fire again immediately. The new slot becomes
  // active so the single live execution mirrors onto its thread message.
  const launch = useCallback(async () => {
    const snapshot = usePresentationStore.getState().inputValues
    const newSlot = await createDraftSlot(snapshot)
    setActiveSlotId(newSlot.id)
    // Deep-link parity with the other slot actions.
    const url = new URL(window.location.href)
    url.searchParams.set("run", newSlot.id)
    window.history.replaceState({}, "", url.toString())
    // Run the new slot, merging the draft inputs into the runner store. The
    // runId is threaded explicitly (not via activeSlotIdRef), and the
    // presentation store is NOT reset — the draft persists for the next run.
    await createBridgedRun(
      () => usePresentationStore.getState().inputValues,
      () => newSlot.id,
    )()
  }, [createDraftSlot])

  // Header button: "Clear" when idle, "Retry" when failed, "Create New" otherwise
  // Original slot always shows "New Run" (can't clear/retry a snapshot)
  const isOriginal = activeSlotId === ORIGINAL_SLOT_ID
  const isSlotIdle = activeSlot?.executionStatus === "idle"
  const isSlotFailed = activeSlot?.executionStatus === "failed"
  const handleHeaderAction = useCallback(() => {
    if (isOriginal) handleCreateNew()
    else if (isSlotIdle) handleClear()
    else if (isSlotFailed) handleRetry()
    else handleCreateNew()
  }, [isOriginal, isSlotIdle, isSlotFailed, handleClear, handleRetry, handleCreateNew])
  const newRunLabel = isOriginal ? "New Run" : isSlotIdle ? "Clear" : isSlotFailed ? "Retry" : "New Run"

  // Select slot
  const handleSelectSlot = useCallback((slotId: string) => {
    if (slotId === activeSlotId) return
    // Don't save inputs when switching away from Original (it's read-only)
    if (activeSlotId !== ORIGINAL_SLOT_ID) {
      saveCurrentSlotInputs()
    }
    const slot = allSlots.find((s) => s.id === slotId)
    if (!slot) return

    setActiveSlotId(slotId)

    // Apply slot data to presentation store
    applySlotToPresentation(slot)

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

    // Update URL for deep-linking (replaceState, no navigation)
    const url = new URL(window.location.href)
    if (slotId === ORIGINAL_SLOT_ID) {
      url.searchParams.delete("run")
    } else {
      url.searchParams.set("run", slotId)
    }
    window.history.replaceState({}, "", url.toString())
  }, [activeSlotId, saveCurrentSlotInputs, allSlots])

  // Delete slot — request confirmation (guard: skip Original)
  const handleRequestDelete = useCallback((slotId: string) => {
    if (slotId === ORIGINAL_SLOT_ID) return
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
      resetPresentationToIdle({})
    }
    // Delete from DB
    if (slug && persistRuns) {
      deleteAppRun(slug, slotId).catch(() => {})
    }
  }, [deleteConfirmSlotId, activeSlotId, newRun, slug, persistRuns])

  // Rename slot (guard: skip Original)
  const handleRenameSlot = useCallback((slotId: string, name: string | null) => {
    if (slotId === ORIGINAL_SLOT_ID) return
    setSlots((prev) => prev.map((s) => s.id === slotId ? { ...s, name } : s))
    if (slug && persistRuns) {
      updateAppRunInputs(slug, slotId, undefined, name).catch(() => {})
    }
  }, [slug, persistRuns])

  // (Run navigation via up/down arrows lives in FullscreenView only — see
  // fullscreen-view.tsx. A global handler here hijacked the chat composer.)

  // Smart close: desktop=collapse, mobile=hide
  const handleCloseSidebar = useCallback(() => {
    const isDesktop = window.matchMedia("(min-width: 768px)").matches
    if (isDesktop) {
      setSidebarCollapsed((prev) => {
        const next = !prev
        localStorage.setItem("app-sidebar-collapsed", String(next))
        return next
      })
    } else {
      setShowHistory(false)
    }
  }, [])

  // Derived state
  const isRunning = executionStatus === "running"
  const isTerminal = activeSlot?.executionStatus === "completed" || activeSlot?.executionStatus === "failed"
  const inputsReadOnlyValue = !activeSlotId || isRunning || isTerminal || activeSlotId === ORIGINAL_SLOT_ID
  // True while waiting for DB runs to load a specific run from URL.
  // pendingRunId is set on mount from initialRunId, cleared after DB fetch completes.
  const isLoadingRun = !!pendingRunId
  // True while DB runs are being fetched (sidebar spinner, regardless of initialRunId)
  const isLoadingRuns = persistRuns && runsLoaded && !runsFetchDone && !!user

  return {
    // State (allSlots includes the synthetic Original slot)
    slots: allSlots,
    activeSlotId,
    activeSlot,
    showHistory,
    setShowHistory,
    sidebarCollapsed,
    setSidebarCollapsed,
    deleteConfirmSlotId,
    setDeleteConfirmSlotId,

    // Callbacks
    handleCreateNew,
    handleClear,
    handleRetry,
    handleDuplicateSlot,
    launch,
    handleHeaderAction,
    handleSelectSlot,
    handleRequestDelete,
    handleConfirmDelete,
    handleRenameSlot,
    handleCloseSidebar,

    // Derived
    newRunLabel,
    isRunning,
    inputsReadOnlyValue,
    isLoadingRun,
    isLoadingRuns,

    // Version
    selectedVersion,
    setSelectedVersion,
    versions,
    latestVersion,
  }
}
