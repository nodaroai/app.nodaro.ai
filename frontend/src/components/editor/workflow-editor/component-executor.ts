import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { executeComponent as executeComponentApi, getJobStatus } from "@/lib/api"
import { mergeExposedSettings } from "@nodaro-shared/component-types"
import type { ComponentMetadata } from "@nodaro-shared/component-types"
import type { WorkflowNode, ComponentNodeData, GeneratedResult } from "@/types/nodes"
import type { ExecutionContext } from "./types"
import type { FrontendResolvedInputs } from "./node-input-resolver"

const POLL_INTERVAL_MS = 2_500
const TIMEOUT_MS = 30 * 60 * 1000

/**
 * Execute a component node via POST /v1/component/execute.
 * Creates a wrapper job (black box) and polls it to completion.
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

  // Build inputOverrides from resolved upstream inputs (handle-aware)
  const inputOverrides: Record<string, Record<string, unknown>> = {}

  for (const handle of metadata.inputs) {
    const value =
      inputs.componentInputMap?.[handle.id] ??
      inputs[handle.fieldKey as keyof FrontendResolvedInputs] ??
      (handle.type === "image" ? inputs.imageUrl : undefined) ??
      (handle.type === "video" ? inputs.videoUrl : undefined) ??
      (handle.type === "audio" ? inputs.audioUrl : undefined) ??
      (handle.type === "text" ? inputs.prompt : undefined)

    if (value !== undefined) {
      inputOverrides[handle.id] = { ...inputOverrides[handle.id], [handle.fieldKey]: value }
    }
  }

  // Pick up config-panel input values (stored in exposedSettings as "nodeId:fieldKey")
  // for input handles that weren't supplied by wired connections above.
  for (const handle of metadata.inputs) {
    if (inputOverrides[handle.id]?.[handle.fieldKey] !== undefined) continue // already wired
    const settingKey = `${handle.id}:${handle.fieldKey}`
    const settingVal = exposedSettings[settingKey]
    if (settingVal !== undefined && settingVal !== "") {
      inputOverrides[handle.id] = { ...inputOverrides[handle.id], [handle.fieldKey]: settingVal }
    }
  }

  const merged = mergeExposedSettings(inputOverrides, exposedSettings, metadata)

  // Mark running — keep previous results for history
  updateNodeData(node.id, {
    executionStatus: "running",
    errorMessage: undefined,
    currentJobId: undefined,
    currentJobProgress: 0,
  })

  try {
    // Get current workflow ID for job tagging
    const workflowId = useWorkflowStore.getState().workflowId

    const { jobId } = await executeComponentApi({
      appSlug: data.appSlug,
      inputOverrides: merged,
      pinnedVersion: data.pinnedVersion || undefined,
      workflowId: workflowId || undefined,
    })

    // Store job ID so cancel + resume-after-refresh can find it
    updateNodeData(node.id, { currentJobId: jobId })

    // Poll wrapper job
    const startTime = Date.now()
    let lastProgress = -1

    while (Date.now() - startTime < TIMEOUT_MS) {
      if (ctx.isWorkflowStale()) throw new Error("Workflow changed during execution")

      const job = await getJobStatus(jobId)

      if (job.status === "completed") {
        const outputData = (job.output_data ?? {}) as Record<string, string>
        const outputResults: Record<string, string> = {}

        for (const handle of metadata.outputs) {
          if (outputData[handle.id]) {
            outputResults[handle.id] = outputData[handle.id]
          }
        }

        // Prepend new result to history (like generate-image)
        const firstOutput = Object.values(outputResults)[0]
        const existingResults = ((node.data as ComponentNodeData).generatedResults ?? []) as GeneratedResult[]
        const newResults = firstOutput
          ? [{ url: firstOutput, timestamp: new Date().toISOString(), jobId }, ...existingResults]
          : existingResults

        updateNodeData(node.id, {
          executionStatus: "completed",
          outputResults,
          generatedResults: newResults,
          activeResultIndex: 0,
          currentJobId: undefined,
          currentJobProgress: 100,
        })

        return firstOutput ?? ""
      }

      if (job.status === "failed") {
        throw new Error(job.error_message ?? "Component execution failed")
      }

      // Update progress from job progress field
      const progress = typeof job.progress === "number" ? job.progress : 0
      if (progress !== lastProgress) {
        updateNodeData(node.id, { currentJobProgress: progress })
        lastProgress = progress
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }

    throw new Error("Component execution timed out")
  } catch (err) {
    updateNodeData(node.id, {
      executionStatus: "failed",
      errorMessage: err instanceof Error ? err.message : "Unknown error",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
    throw err
  }
}
