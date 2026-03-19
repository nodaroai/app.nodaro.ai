/**
 * Zustand store for the Published App runner (consumer flow).
 * Pattern mirrors usePresentationStore but adds run history and app metadata.
 */

import { create } from "zustand"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import {
  getPublishedApp,
  runPublishedApp,
  getAppRuns,
  getAppExecutionStatus,
  deleteAppRun,
  cancelWorkflowExecution,
  InsufficientCreditsError,
  type PublishedApp,
  type AppRun,
  batchExecutionEstimates,
} from "@/lib/api"
import { buildProgressSegments, calculateCombinedProgress, type ProgressSegment, CATEGORY_DURATION_DEFAULTS } from "@nodaro-shared/progress-curve"
import { getOutputNodes } from "@nodaro-shared/presentation-utils"

export type AppRunnerStatus = "idle" | "loading" | "running" | "completed" | "failed"

interface NodeState {
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  output?: Record<string, unknown>
  error?: string
}

interface AppRunnerState {
  // App data
  app: PublishedApp | null
  slug: string | null
  loading: boolean

  // Versioning
  selectedVersion: number | null // null = latest

  // Run history
  runs: AppRun[]
  runsLoading: boolean
  activeRunId: string | null

  // Current execution
  executionId: string | null
  executionStatus: AppRunnerStatus
  nodeStates: Record<string, NodeState>
  inputValues: Record<string, Record<string, unknown>>
  completedNodes: number
  totalNodes: number
  errorMessage: string | null
  insufficientCredits: boolean
  progressSegments: Record<string, ProgressSegment[]>
  combinedProgress: Record<string, number>

  // Actions
  loadApp: (slug: string) => Promise<void>
  loadRuns: () => Promise<void>
  selectRun: (runId: string) => void
  newRun: () => void
  run: (runId?: string) => Promise<void>
  cancel: () => Promise<void>
  deleteRun: (runId: string) => Promise<void>
  updateInputValue: (nodeId: string, key: string, value: unknown) => void
  resumeExecution: (executionId: string) => void
  setSelectedVersion: (version: number | null) => void
  reset: () => void
}

let pollTimeoutId: ReturnType<typeof setTimeout> | null = null

function clearPollTimeout() {
  if (pollTimeoutId !== null) {
    clearTimeout(pollTimeoutId)
    pollTimeoutId = null
  }
}

export const useAppRunnerStore = create<AppRunnerState>((set, get) => ({
  app: null,
  slug: null,
  loading: false,
  selectedVersion: null,
  runs: [],
  runsLoading: false,
  activeRunId: null,
  executionId: null,
  executionStatus: "idle",
  nodeStates: {},
  inputValues: {},
  completedNodes: 0,
  totalNodes: 0,
  errorMessage: null,
  insufficientCredits: false,
  progressSegments: {},
  combinedProgress: {},

  loadApp: async (slug: string) => {
    if (get().loading) return
    // Clear stale app from previous navigation to prevent flash of old data
    set({ loading: true, slug, errorMessage: null, app: null })
    try {
      const app = await getPublishedApp(slug)
      // Guard: discard response if slug changed during fetch (navigation race)
      if (get().slug !== slug) { set({ loading: false }); return }
      set({ app, loading: false })
    } catch (err) {
      if (get().slug !== slug) { set({ loading: false }); return }
      set({
        loading: false,
        errorMessage: err instanceof Error ? err.message : "Failed to load app",
      })
    }
  },

  loadRuns: async () => {
    const { slug } = get()
    if (!slug) return
    set({ runsLoading: true })
    try {
      const { data } = await getAppRuns(slug)
      set({ runs: data, runsLoading: false })
    } catch {
      set({ runsLoading: false })
    }
  },

  selectRun: (runId: string) => {
    const { runs } = get()
    const run = runs.find((r) => r.id === runId)
    if (!run?.execution) return

    clearPollTimeout()

    const nodeStates = (run.execution.nodeStates ?? {}) as Record<string, NodeState>
    const isTerminal = run.execution.status === "completed" || run.execution.status === "failed" || run.execution.status === "cancelled"

    set({
      activeRunId: runId,
      executionId: run.executionId,
      nodeStates,
      completedNodes: run.execution.completedNodes,
      totalNodes: run.execution.totalNodes,
      executionStatus: isTerminal
        ? (run.execution.status === "completed" ? "completed" : "failed")
        : "running",
      errorMessage: run.execution.errorMessage ?? null,
    })

    // If still running, resume polling
    if (!isTerminal) {
      startPolling(set, get)
      computeProgressSegments(set, get).catch(() => {})
    }
  },

  newRun: () => {
    clearPollTimeout()
    set({
      activeRunId: null,
      executionId: null,
      executionStatus: "idle",
      nodeStates: {},
      inputValues: {},
      completedNodes: 0,
      totalNodes: 0,
      errorMessage: null,
      insufficientCredits: false,
      progressSegments: {},
      combinedProgress: {},
    })
  },

  run: async (existingRunId?: string) => {
    const { slug, inputValues, selectedVersion } = get()
    if (!slug) return

    clearPollTimeout()
    set({
      executionStatus: "running",
      errorMessage: null,
      insufficientCredits: false,
      nodeStates: {},
      completedNodes: 0,
    })

    try {
      const { executionId, runId } = await runPublishedApp(
        slug,
        Object.keys(inputValues).length > 0 ? inputValues : undefined,
        existingRunId,
        selectedVersion ?? undefined,
      )
      set({ executionId, activeRunId: runId })
      startPolling(set, get)
      computeProgressSegments(set, get).catch(() => {})
    } catch (err) {
      const isInsufficientCredits = err instanceof InsufficientCreditsError
      set({
        executionStatus: "failed",
        errorMessage: err instanceof Error ? err.message : "Failed to run app",
        insufficientCredits: isInsufficientCredits,
      })
    }
  },

  cancel: async () => {
    const { executionId } = get()
    if (!executionId) return
    clearPollTimeout()
    set({ executionStatus: "failed", errorMessage: "Cancelled" })
    try {
      await cancelWorkflowExecution(executionId)
    } catch {
      // best effort
    }
  },

  deleteRun: async (runId: string) => {
    const { slug, runs, activeRunId } = get()
    if (!slug) return
    try {
      await deleteAppRun(slug, runId)
      set({ runs: runs.filter((r) => r.id !== runId) })
      if (activeRunId === runId) {
        get().newRun()
      }
    } catch {
      // silently fail
    }
  },

  resumeExecution: (executionId: string) => {
    clearPollTimeout()
    set({ executionId, executionStatus: "running", errorMessage: null })
    startPolling(set, get)
    computeProgressSegments(set, get).catch(() => {})
  },

  setSelectedVersion: (version: number | null) => {
    set({ selectedVersion: version })
  },

  updateInputValue: (nodeId: string, key: string, value: unknown) => {
    const { inputValues } = get()
    set({
      inputValues: {
        ...inputValues,
        [nodeId]: { ...inputValues[nodeId], [key]: value },
      },
    })
  },

  reset: () => {
    clearPollTimeout()
    set({
      app: null,
      slug: null,
      loading: false,
      selectedVersion: null,
      runs: [],
      runsLoading: false,
      activeRunId: null,
      executionId: null,
      executionStatus: "idle",
      nodeStates: {},
      inputValues: {},
      completedNodes: 0,
      totalNodes: 0,
      errorMessage: null,
      insufficientCredits: false,
      progressSegments: {},
      combinedProgress: {},
    })
  },
}))

/**
 * Creates a bridged run function that syncs input values from the presentation store
 * to the app runner store (batched) before triggering the run.
 * Used by both app-runner-page and embed-page.
 */
export function createBridgedRun(
  getPresentationInputs: () => Record<string, Record<string, unknown>>,
  getRunId?: () => string | null,
): () => Promise<void> {
  return async () => {
    const presInputs = getPresentationInputs()
    const current = useAppRunnerStore.getState().inputValues
    const merged: Record<string, Record<string, unknown>> = { ...current }
    for (const [nodeId, values] of Object.entries(presInputs)) {
      merged[nodeId] = { ...merged[nodeId], ...values }
    }
    useAppRunnerStore.setState({ inputValues: merged })
    const runId = getRunId?.() ?? undefined
    await useAppRunnerStore.getState().run(runId)
  }
}

function startPolling(
  set: (partial: Partial<AppRunnerState>) => void,
  get: () => AppRunnerState,
) {
  const poll = async () => {
    const { executionId, executionStatus } = get()
    if (!executionId || executionStatus !== "running") return

    try {
      const status = await getAppExecutionStatus(executionId)

      // Guard: if the execution changed while the request was in flight, discard
      if (get().executionId !== executionId) return

      const nodeStates = (status.node_states ?? {}) as Record<string, NodeState>

      set({
        nodeStates,
        completedNodes: status.completed_nodes,
        totalNodes: status.total_nodes,
      })

      // Calculate combined progress for each visible output node
      const { progressSegments } = get()
      if (Object.keys(progressSegments).length > 0) {
        const combined: Record<string, number> = {}
        for (const [visibleId, segs] of Object.entries(progressSegments)) {
          combined[visibleId] = calculateCombinedProgress(
            segs,
            nodeStates as Record<string, { status: "pending" | "running" | "completed" | "failed" | "skipped"; startedAt?: string }>,
          )
        }
        set({ combinedProgress: combined })
      }

      if (status.status === "completed") {
        set({ executionStatus: "completed" })
        // Refresh runs list
        const { slug } = get()
        if (slug) {
          getAppRuns(slug).then(({ data }) => set({ runs: data })).catch(() => {})
        }
        return
      }
      if (status.status === "failed" || status.status === "cancelled") {
        set({
          executionStatus: "failed",
          errorMessage: status.error_message ?? "Execution failed",
        })
        return
      }

      pollTimeoutId = setTimeout(poll, 2000)
    } catch (err) {
      // Guard: if the execution changed, don't report error for stale request
      if (get().executionId !== executionId) return
      set({
        executionStatus: "failed",
        errorMessage: err instanceof Error ? err.message : "Connection lost",
      })
    }
  }

  pollTimeoutId = setTimeout(poll, 1000)
}

async function computeProgressSegments(
  set: (partial: Partial<AppRunnerState>) => void,
  get: () => AppRunnerState,
) {
  const { app } = get()
  if (!app) return

  const nodes = app.snapshotNodes as WorkflowNode[]
  const edges = app.snapshotEdges as WorkflowEdge[]

  const visibleOutputs = getOutputNodes(nodes, edges, true)
  if (visibleOutputs.length === 0) return

  // Build edge map: targetId -> sourceIds
  const edgeMap = new Map<string, string[]>()
  for (const edge of edges) {
    const sources = edgeMap.get(edge.target) ?? []
    sources.push(edge.source)
    edgeMap.set(edge.target, sources)
  }

  const allAncestorIds = new Set<string>()
  const segmentNodeIds: Record<string, string[]> = {}

  for (const outputNode of visibleOutputs) {
    const ancestors: string[] = []
    const visited = new Set<string>()
    const queue = [outputNode.id]

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      ancestors.push(nodeId)
      allAncestorIds.add(nodeId)

      const parents = edgeMap.get(nodeId) ?? []
      for (const p of parents) {
        if (!visited.has(p)) queue.push(p)
      }
    }

    ancestors.reverse()
    segmentNodeIds[outputNode.id] = ancestors
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const estimateRequests = Array.from(allAncestorIds).map(nodeId => {
    const node = nodeMap.get(nodeId)
    const data = (node?.data ?? {}) as Record<string, unknown>
    return {
      nodeId,
      model: (data.provider as string) ?? (data.ttsModel as string) ?? (data.llmModel as string) ?? node?.type ?? "unknown",
      aspectRatio: (data.aspect_ratio as string) ?? (data.aspectRatio as string),
      quality: (data.resolution as string) ?? (data.quality as string),
      duration: Number(data.duration) || undefined,
    }
  })

  const estimates = await batchExecutionEstimates(estimateRequests)

  const segments: Record<string, ProgressSegment[]> = {}
  for (const [visibleId, ancestorIds] of Object.entries(segmentNodeIds)) {
    const nodeEstimates = ancestorIds.map(id => ({
      nodeId: id,
      estimatedMs: estimates[id]?.estimatedMs ?? CATEGORY_DURATION_DEFAULTS.image!,
    }))
    segments[visibleId] = buildProgressSegments(nodeEstimates)
  }

  set({ progressSegments: segments })
}
