import type { PassThrough } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

/**
 * The canvas side of R14: write the input video as the node's result — no API
 * call, no job, no charge — exactly what the orchestrator's pass-through
 * outputs. `passThroughWarning` is the node's "Last run" note.
 */
export function completeAsPassThrough(nodeId: string, pass: PassThrough): string {
  const timestamp = new Date().toISOString()
  useWorkflowStore.getState().updateNodeData(nodeId, {
    executionStatus: "completed",
    errorMessage: undefined,
    currentJobId: undefined,
    generatedVideoUrl: pass.videoUrl,
    generatedResults: [{ url: pass.videoUrl, timestamp, jobId: `pass-through-${timestamp}` }],
    activeResultIndex: 0,
    passThroughWarning: pass.warning,
  })
  return pass.videoUrl
}
