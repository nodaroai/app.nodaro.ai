import { useWorkflowStore } from "@/hooks/use-workflow-store"

/** True when the in-flight result for `jobId` should be DISCARDED rather than
 *  written to the canvas — because the user discarded the run (the node's
 *  `currentJobId` was cleared) or started a new run (it points at a new job),
 *  or the node was deleted. The backend job still completes → My Library; we
 *  just don't apply it to the canvas. Call this at the top of every single-node
 *  poll loop's result/completion write. */
export function shouldAbandonNode(nodeId: string, jobId: string | undefined): boolean {
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
  if (!node) return true
  const data = node.data as Record<string, unknown> | undefined
  // During a list fan-out, N iterations run concurrently and share one
  // `currentJobId` slot, so the single-job match is meaningless — never
  // abandon mid-fan-out. Fan-out teardown is handled by the batch orchestrator
  // (ctx staleness / cancelRef), and fan-out result-detach is a documented
  // Phase-1 limitation. This exemption lives in the guard so every poll loop
  // inherits it and a missed call site can't reintroduce the parallel-fan-out
  // drop bug.
  if (data?.__listRunning) return false
  return data?.currentJobId !== jobId
}
