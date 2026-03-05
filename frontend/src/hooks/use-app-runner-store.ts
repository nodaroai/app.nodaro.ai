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
  type PublishedApp,
  type AppRun,
} from "@/lib/api"

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

  // Actions
  loadApp: (slug: string) => Promise<void>
  loadRuns: () => Promise<void>
  selectRun: (runId: string) => void
  newRun: () => void
  run: () => Promise<void>
  deleteRun: (runId: string) => Promise<void>
  updateInputValue: (nodeId: string, key: string, value: unknown) => void
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

  loadApp: async (slug: string) => {
    if (get().loading) return
    set({ loading: true, slug, errorMessage: null })
    try {
      const app = await getPublishedApp(slug)
      set({ app, loading: false })
    } catch (err) {
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
    }
  },

  newRun: () => {
    clearPollTimeout()
    set({
      activeRunId: null,
      executionId: null,
      executionStatus: "idle",
      nodeStates: {},
      completedNodes: 0,
      totalNodes: 0,
      errorMessage: null,
    })
  },

  run: async () => {
    const { slug, inputValues } = get()
    if (!slug) return

    clearPollTimeout()
    set({
      executionStatus: "running",
      errorMessage: null,
      nodeStates: {},
      completedNodes: 0,
    })

    try {
      const { executionId, runId } = await runPublishedApp(
        slug,
        Object.keys(inputValues).length > 0 ? inputValues : undefined,
      )
      set({ executionId, activeRunId: runId })
      startPolling(set, get)
    } catch (err) {
      set({
        executionStatus: "failed",
        errorMessage: err instanceof Error ? err.message : "Failed to run app",
      })
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
    })
  },
}))

function startPolling(
  set: (partial: Partial<AppRunnerState>) => void,
  get: () => AppRunnerState,
) {
  const poll = async () => {
    const { executionId, executionStatus } = get()
    if (!executionId || executionStatus !== "running") return

    try {
      const status = await getAppExecutionStatus(executionId)
      const nodeStates = (status.node_states ?? {}) as Record<string, NodeState>

      set({
        nodeStates,
        completedNodes: status.completed_nodes,
        totalNodes: status.total_nodes,
      })

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
      set({
        executionStatus: "failed",
        errorMessage: err instanceof Error ? err.message : "Connection lost",
      })
    }
  }

  pollTimeoutId = setTimeout(poll, 1000)
}
