/**
 * The credits a Tighten Episode run reserves, for its pill and Run button: the
 * run set of this node alone priced by the run's own estimate — its chain on
 * its real source plus its fee (`usecaseNodeCredits`, estimate-run-credits.ts)
 * — the very figure the Execute badge, the confirm and the precheck add for
 * it. Prices not cached yet are fetched, then the figure is recomputed.
 */
import { useMemo } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useRunSetCredits } from "@/hooks/use-run-from-here-credits"
import type { WorkflowNode } from "@/types/nodes"

const NONE: WorkflowNode[] = []

export function useTightenEpisodeCredits(id: string): number {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const executable = useMemo(() => {
    const node = nodes.find((n) => n.id === id)
    return node ? [node] : NONE
  }, [id, nodes])
  return useRunSetCredits(executable, nodes, edges)
}
