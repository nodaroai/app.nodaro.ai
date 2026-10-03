/**
 * The LIVE credit estimate for running a presented workflow / published app —
 * the one computation every app-runner surface prices from, so the desktop
 * runner and the mobile runner cannot quote different numbers for one run.
 *
 * It matters because this number GATES the run: the runner refuses to start
 * when the spendable balance is below it. The mobile shell used to gate on the
 * store's seeded figure alone — the server's static, edge-less
 * `estimateWorkflowCredits`, which prices a per-output-minute render (Apply
 * EDL) as ONE minute and knows nothing about fan-out — while only the desktop
 * `PresentationView` ever computed the live figure. A podcast app on a phone
 * passed the precheck, charged Transcribe and Edit Plan, then had its render
 * reserve refused.
 *
 * What it prices: run-time input values are merged over the snapshot nodes
 * through `mergeNodeInputOverrides` (a swapped media input also drops the
 * saved media-bound `metadata`, so a publisher's recorded length can't price a
 * caller's file); every executable node re-runs, so `rerunIds` is the whole
 * set and any upstream planner re-plans; each node costs its live model price
 * (or the static fallback) × `getCostMultiplier` (fan-out × repeat × output
 * minutes). Uncached model prices are prefetched, then the total recomputes.
 *
 * Returns the BASE figure (0 until the first compute). Callers apply the app's
 * monetization markup — and fall back to the seeded server figure, which is
 * ALREADY marked up, so that fallback must not be marked up again.
 *
 * Core, on purpose: the live price cache lives under `@/ee`, so the two cache
 * functions are INJECTED rather than imported (the `estimate-run-credits.ts`
 * pattern) — the already-allowlisted callers pass them in.
 */
import { useEffect, useRef, useState } from "react"
import { isExpandedClone, mergeNodeInputOverrides } from "@nodaro/shared"
import { estimateNodeCredits, isExecutableNode, getCostMultiplier } from "@/components/editor/workflow-editor/types"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

export interface LiveRunEstimateDeps {
  /** The cached live price for a model identifier, or undefined when not yet fetched. */
  readonly getCachedCredits: (modelId: string) => number | undefined
  /** Fetch the live prices for these identifiers into the cache. */
  readonly prefetchModelCredits: (modelIds: string[]) => Promise<void>
}

export interface LiveRunEstimateArgs {
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
  /** Run-time input values keyed by node id (a published app's inputs). */
  readonly inputValues?: Record<string, Record<string, unknown>>
  /** False on editions without credits — nothing is computed and 0 is returned. */
  readonly enabled: boolean
}

/** Debounce for input changes — a plain text keystroke must not trigger the
 *  O(N²·E) fan-out recompute. The first compute runs immediately. */
export const LIVE_ESTIMATE_DEBOUNCE_MS = 300

/**
 * The nodes as the run will see them: run-time inputs merged over the
 * snapshot. Exported so a caller that needs the same view (e.g. to read a
 * merged node) does not re-derive it differently.
 */
export function applyRunInputValues(
  nodes: WorkflowNode[],
  inputValues: Record<string, Record<string, unknown>> | undefined,
): WorkflowNode[] {
  if (!inputValues) return nodes
  return nodes.map((n) => {
    const vals = inputValues[n.id]
    return vals
      ? { ...n, data: mergeNodeInputOverrides(n.type, n.data as Record<string, unknown>, vals) as typeof n.data }
      : n
  })
}

/** One synchronous pass over the graph with whatever prices are cached. */
export function computeLiveRunEstimate(
  args: Omit<LiveRunEstimateArgs, "enabled">,
  getCachedCredits: LiveRunEstimateDeps["getCachedCredits"],
): { total: number; uncachedModelIds: string[] } {
  const effectiveNodes = applyRunInputValues(args.nodes, args.inputValues)
  const executable = effectiveNodes.filter((n) => isExecutableNode(n) && !isExpandedClone(n))
  // A presented run executes every node, so any upstream planner re-plans.
  const rerunIds = new Set(executable.map((n) => n.id))
  const modelIds = [...new Set(executable.map((n) => getModelIdentifier(n, args.edges, effectiveNodes)).filter(Boolean))]
  const uncachedModelIds = modelIds.filter((m) => getCachedCredits(m) === undefined)
  const total = executable.reduce((sum, node) => {
    const cached = getCachedCredits(getModelIdentifier(node, args.edges, effectiveNodes))
    const cost =
      cached !== undefined
        ? cached
        : estimateNodeCredits({ id: node.id, type: node.type, data: node.data as Record<string, unknown> }, args.edges, effectiveNodes)
    return sum + cost * getCostMultiplier(node, effectiveNodes, args.edges, rerunIds)
  }, 0)
  return { total, uncachedModelIds }
}

export function useLiveRunEstimate(args: LiveRunEstimateArgs, deps: LiveRunEstimateDeps): number {
  const { nodes, edges, inputValues, enabled } = args
  const [estimate, setEstimate] = useState(0)
  const firstRunRef = useRef(true)
  // Read through a ref so a caller passing fresh function identities each
  // render does not re-trigger the effect (only the graph and inputs should).
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const compute = () => {
      const { getCachedCredits, prefetchModelCredits } = depsRef.current
      const first = computeLiveRunEstimate({ nodes, edges, inputValues }, getCachedCredits)
      if (first.uncachedModelIds.length === 0) {
        setEstimate(first.total)
        return
      }
      // Quote what is known now, then the exact figure once prices land.
      setEstimate(first.total)
      prefetchModelCredits(first.uncachedModelIds).then(() => {
        if (cancelled) return
        setEstimate(computeLiveRunEstimate({ nodes, edges, inputValues }, getCachedCredits).total)
      })
    }

    // The very first estimate runs immediately so the initial render is not
    // blank; later input changes coalesce behind the debounce.
    if (firstRunRef.current) {
      firstRunRef.current = false
      compute()
      return () => {
        cancelled = true
      }
    }
    const timer = setTimeout(compute, LIVE_ESTIMATE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [nodes, edges, inputValues, enabled])

  return estimate
}
