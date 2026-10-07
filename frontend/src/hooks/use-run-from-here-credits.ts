/**
 * What "Run from here" on a node will charge, for the price its button
 * quotes. It is the run's own estimate, not a second one: the same node set
 * the run's confirm gate prices (`runFromHereExecutable`) and the same
 * estimate the Execute button and that gate use (`estimateRunCredits` — the
 * price of the id each node will reserve, × fan-out × per-unit units). A Text
 * node's button used to sum its own static fallback figures instead: no
 * markup, and blind to a downstream node's tier (it quoted Pro's ten-minute
 * Video Analysis row for a Fast run).
 *
 * Prices not cached yet are fetched, then the figure is recomputed. Mount it
 * only while the button shows — it recomputes on every graph change.
 */
import { useEffect, useMemo, useState } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getCachedModelCredits, prefetchModelCreditCosts } from "@/hooks/use-model-credit-cost"
import { estimateRunCredits, runModelIds } from "@/components/editor/workflow-editor/estimate-run-credits"
import { runFromHereExecutable } from "@/components/editor/workflow-editor/run-from-here-set"
import { hasCredits } from "@/lib/edition"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The price of running `executable` — the run's own estimate — with its prices
 * fetched when cold. `nodes` is the graph the run executes: for a run with
 * input overrides (Render final), the OVERRIDDEN graph, never the canvas. Any
 * run-set price (Run from here, Render final, Update preview) is this hook
 * over its own set.
 */
export function useRunSetCredits(
  executable: WorkflowNode[],
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): number {
  const [pricesLoaded, setPricesLoaded] = useState(0)

  useEffect(() => {
    if (!hasCredits() || executable.length === 0) return
    // Every id the run is priced at: each of several providers' own too.
    const ids = runModelIds(executable, nodes, edges)
    const missing = ids.filter((id) => getCachedModelCredits(id) === undefined)
    if (missing.length === 0) return
    let cancelled = false
    void prefetchModelCreditCosts(missing).then(() => {
      if (!cancelled) setPricesLoaded((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [executable, nodes, edges])

  return useMemo(
    () => (hasCredits() ? estimateRunCredits(executable, nodes, edges, getCachedModelCredits) : 0),
    // `pricesLoaded` re-reads the cache once fetched prices land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [executable, nodes, edges, pricesLoaded],
  )
}

export function useRunFromHereCredits(startId: string): number {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const executable = useMemo(() => runFromHereExecutable(startId, nodes, edges), [startId, nodes, edges])
  return useRunSetCredits(executable, nodes, edges)
}
