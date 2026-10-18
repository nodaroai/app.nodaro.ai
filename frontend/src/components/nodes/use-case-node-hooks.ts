// frontend/src/components/nodes/use-case-node-hooks.ts — store reads a use-case node's canvas
// component needs beyond useUnitNodeKit (G5: a unit never imports the workflow store).
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { usecaseListDriven } from "@/components/editor/workflow-editor/use-case-render-final-set"

/** A List drives this use-case node (one run per item): Render final is not offered. */
export function useUseCaseListDriven(nodeId: string): boolean {
  return useWorkflowStore((s) => {
    const self = s.nodes.find((n) => n.id === nodeId)
    return self ? usecaseListDriven(self, s.nodes, s.edges) : false
  })
}

/**
 * Continue this use-case node's failed run `jobId` (its finished steps kept). The
 * continuation is the run's option, never node data: a click that never starts
 * leaves nothing behind, and the next Run is a fresh run.
 */
export function useUseCaseContinue(nodeId: string): (jobId: string) => void {
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  return (jobId) => { runSingleNode?.(nodeId, { usecaseContinue: { mode: "from-failed", jobId } }) }
}
