import type { PassThrough } from "@nodaro/shared/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { serverNowIso } from "@/lib/server-clock"
import { isUgcFinishNode } from "@/lib/ugc-run-patch"
import { resultsRunMark } from "./triggered-run-follow"

/**
 * The canvas side of R14: write the input video as the node's result — no API
 * call, no job, no charge — exactly what the orchestrator's pass-through
 * outputs. `passThroughWarning` is the node's "Last run" note.
 *
 * A UGC video's join, overlay or captions (its finish nodes, by their place in
 * the chain) is stamped as every lane that lands one stamps it — this landing,
 * now, on the server's clock — so a reopen tells this video from an older or a
 * newer run's (lib/ugc-run-patch.ts).
 */
export function completeAsPassThrough(nodeId: string, pass: PassThrough): string {
  const timestamp = new Date().toISOString()
  const jobId = `pass-through-${timestamp}`
  const state = useWorkflowStore.getState()
  const type = state.nodes.find((n) => n.id === nodeId)?.type
  const ugcFinishStamp = isUgcFinishNode(nodeId, type, state) ? resultsRunMark(jobId, serverNowIso()) : {}
  state.updateNodeData(nodeId, {
    executionStatus: "completed",
    errorMessage: undefined,
    currentJobId: undefined,
    generatedVideoUrl: pass.videoUrl,
    generatedResults: [{ url: pass.videoUrl, timestamp, jobId }],
    activeResultIndex: 0,
    passThroughWarning: pass.warning,
    ...ugcFinishStamp,
  })
  return pass.videoUrl
}
