/**
 * Lightweight Zustand store for presentation mode (shared/viewer flow).
 * Separate from useWorkflowStore to avoid polluting the editor state.
 */

import { create } from "zustand"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "./use-workflow-store"
import {
  getSharedWorkflow,
  runSharedWorkflow,
  getSharedExecutionStatus,
} from "@/lib/api"

export type PresentationStatus = "idle" | "loading" | "running" | "completed" | "failed"

interface NodeState {
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  output?: Record<string, unknown>
  error?: string
}

interface PresentationState {
  // Workflow data
  workflowId: string | null
  workflowName: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  shareToken: string | null
  isOwner: boolean

  // Presentation config (from workflow settings)
  estimatedCost: number
  presentationSettings: PresentationSettings

  // Viewer input overrides (ephemeral, never saved)
  inputValues: Record<string, Record<string, unknown>>

  // Execution state
  executionId: string | null
  executionStatus: PresentationStatus
  nodeStates: Record<string, NodeState>
  completedNodes: number
  totalNodes: number
  errorMessage: string | null

  // Actions
  loadSharedWorkflow: (token: string) => Promise<void>
  updateInputValue: (nodeId: string, key: string, value: unknown) => void
  run: () => Promise<void>
  reset: () => void
}

// Track poll timeout outside Zustand state to avoid triggering re-renders
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null

function clearPollTimeout() {
  if (pollTimeoutId !== null) {
    clearTimeout(pollTimeoutId)
    pollTimeoutId = null
  }
}

export const usePresentationStore = create<PresentationState>((set, get) => ({
  workflowId: null,
  workflowName: "",
  nodes: [],
  edges: [],
  shareToken: null,
  isOwner: false,
  estimatedCost: 0,
  presentationSettings: DEFAULT_PRESENTATION_SETTINGS,
  inputValues: {},
  executionId: null,
  executionStatus: "idle",
  nodeStates: {},
  completedNodes: 0,
  totalNodes: 0,
  errorMessage: null,

  loadSharedWorkflow: async (token: string) => {
    // Guard against duplicate concurrent loads
    if (get().executionStatus === "loading") return
    set({ executionStatus: "loading", shareToken: token })
    try {
      const data = await getSharedWorkflow(token)
      set({
        workflowId: data.workflowId,
        workflowName: data.name,
        nodes: data.nodes as WorkflowNode[],
        edges: data.edges as WorkflowEdge[],
        isOwner: data.isOwner,
        estimatedCost: data.estimatedCost ?? 0,
        presentationSettings: data.presentationSettings ?? DEFAULT_PRESENTATION_SETTINGS,
        executionStatus: "idle",
      })
    } catch (err) {
      set({
        executionStatus: "failed",
        errorMessage: err instanceof Error ? err.message : "Failed to load workflow",
      })
    }
  },

  updateInputValue: (nodeId: string, key: string, value: unknown) => {
    const { inputValues } = get()
    set({
      inputValues: {
        ...inputValues,
        [nodeId]: {
          ...inputValues[nodeId],
          [key]: value,
        },
      },
    })
  },

  run: async () => {
    const { shareToken, inputValues, presentationSettings } = get()
    if (!shareToken) return

    clearPollTimeout()

    set({
      executionStatus: "running",
      errorMessage: null,
      nodeStates: {},
      completedNodes: 0,
    })

    try {
      const { executionId } = await runSharedWorkflow(
        shareToken,
        Object.keys(inputValues).length > 0 ? inputValues : undefined,
        presentationSettings.runTarget !== "workflow" ? presentationSettings : undefined,
      )
      set({ executionId })

      const poll = async () => {
        const { shareToken: token, executionId: execId, executionStatus: currentStatus } = get()
        if (!token || !execId || currentStatus !== "running") return

        try {
          const status = await getSharedExecutionStatus(token, execId)
          const nodeStates = (status.node_states ?? {}) as Record<string, NodeState>

          set({
            nodeStates,
            completedNodes: status.completed_nodes,
            totalNodes: status.total_nodes,
          })

          if (status.status === "completed") {
            set({ executionStatus: "completed" })
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
    } catch (err) {
      set({
        executionStatus: "failed",
        errorMessage: err instanceof Error ? err.message : "Failed to run workflow",
      })
    }
  },

  reset: () => {
    clearPollTimeout()
    set({
      executionId: null,
      executionStatus: "idle",
      nodeStates: {},
      completedNodes: 0,
      totalNodes: 0,
      errorMessage: null,
    })
  },
}))
