import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { runPublishedApp, getAppExecutionStatus } from "@/lib/api"
import { mergeExposedSettings, OUTPUT_FIELD_MAP } from "@nodaro-shared/component-types"
import type { ComponentMetadata } from "@nodaro-shared/component-types"
import type { WorkflowNode, ComponentNodeData, GeneratedResult } from "@/types/nodes"
import type { ExecutionContext } from "./types"
import type { FrontendResolvedInputs } from "./node-input-resolver"

/**
 * Execute a component node by calling the published app runner API and
 * polling for completion. Mirrors the sub-workflow-executor pattern but
 * delegates execution entirely to the backend orchestrator.
 */
export async function executeComponent(
  node: WorkflowNode,
  inputs: FrontendResolvedInputs,
  ctx: ExecutionContext,
): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState()
  const data = node.data as ComponentNodeData

  if (!data.appSlug) {
    updateNodeData(node.id, { executionStatus: "failed", errorMessage: "Component not configured — no appSlug" })
    throw new Error("Component not configured — no appSlug")
  }

  const metadata = data.componentMetadata as ComponentMetadata | undefined
  if (!metadata) {
    updateNodeData(node.id, { executionStatus: "failed", errorMessage: "Component metadata missing" })
    throw new Error("Component metadata missing")
  }

  const exposedSettings = (data.exposedSettings as Record<string, unknown>) ?? {}

  // Build inputOverrides from resolved upstream inputs.
  // Each handle maps to a node ID in the underlying app; the fieldKey
  // tells us which field on that node should receive the value.
  const inputOverrides: Record<string, Record<string, unknown>> = {}

  for (const handle of metadata.inputs) {
    const value =
      inputs[handle.fieldKey as keyof FrontendResolvedInputs] ??
      (handle.type === "image" ? inputs.imageUrl : undefined) ??
      (handle.type === "video" ? inputs.videoUrl : undefined) ??
      (handle.type === "audio" ? inputs.audioUrl : undefined) ??
      (handle.type === "text" ? inputs.prompt : undefined)

    if (value !== undefined) {
      inputOverrides[handle.id] = { ...inputOverrides[handle.id], [handle.fieldKey]: value }
    }
  }

  // Merge user-configured exposed settings into the overrides
  const merged = mergeExposedSettings(inputOverrides, exposedSettings, metadata)

  // Mark running
  updateNodeData(node.id, {
    executionStatus: "running",
    errorMessage: undefined,
    outputResults: undefined,
    generatedResults: [],
    currentJobProgress: 0,
  })

  try {
    const { executionId } = await runPublishedApp(
      data.appSlug,
      merged,
      undefined,
      data.pinnedVersion || undefined,
      true, // headless
    )

    // Poll for completion
    const maxWaitMs = 30 * 60 * 1000
    const pollIntervalMs = 3000
    const startTime = Date.now()
    let lastProgress = -1

    while (Date.now() - startTime < maxWaitMs) {
      if (ctx.isWorkflowStale()) throw new Error("Workflow changed during execution")

      const status = await getAppExecutionStatus(executionId)

      if (status.status === "completed") {
        const nodeStates = status.node_states as Record<string, { output?: Record<string, unknown> }>
        const outputResults: Record<string, string> = {}

        for (const handle of metadata.outputs) {
          const nodeState = nodeStates[handle.id]
          // Try the handle's fieldKey first, then fall back to the OUTPUT_FIELD_MAP lookup
          const fieldKey = handle.fieldKey || OUTPUT_FIELD_MAP[handle.type] || handle.type
          const value = nodeState?.output?.[fieldKey]
          if (value && typeof value === "string") {
            outputResults[handle.id] = value
          }
        }

        // Build generatedResults from the first media output for display
        const generatedResults: GeneratedResult[] = []
        const firstOutput = Object.values(outputResults)[0]
        if (firstOutput) {
          generatedResults.push({ url: firstOutput, timestamp: new Date().toISOString(), jobId: "" })
        }

        updateNodeData(node.id, {
          executionStatus: "completed",
          outputResults,
          generatedResults,
          activeResultIndex: 0,
          currentJobProgress: 100,
        })

        return firstOutput ?? ""
      }

      if (status.status === "failed") {
        throw new Error(status.error_message ?? "Component execution failed")
      }

      // Update progress only when changed to avoid unnecessary re-renders
      if (status.total_nodes > 0) {
        const progress = Math.round((status.completed_nodes / status.total_nodes) * 100)
        if (progress !== lastProgress) {
          updateNodeData(node.id, { currentJobProgress: progress })
          lastProgress = progress
        }
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs))
    }

    throw new Error("Component execution timed out")
  } catch (err) {
    updateNodeData(node.id, {
      executionStatus: "failed",
      errorMessage: err instanceof Error ? err.message : "Unknown error",
      currentJobProgress: undefined,
    })
    throw err
  }
}
