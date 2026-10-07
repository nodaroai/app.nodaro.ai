/**
 * The LIVE credit estimate for running a presented workflow / published app —
 * the one computation every app-runner surface prices from, so the desktop
 * runner and the mobile runner cannot quote different numbers for one run.
 *
 * It matters because this number GATES the run: the runner refuses to start
 * when the spendable balance is below it. The mobile shell used to gate on the
 * store's seeded figure alone — the server's `estimateWorkflowCredits`, which
 * then priced a per-output-minute render (Apply EDL) as ONE minute and knew
 * nothing about fan-out (it reads the shared rules since decided 2026-10-07,
 * but knows nothing of the user's inputs) — while only the desktop
 * `PresentationView` ever computed the live figure. A podcast app on a phone
 * passed the precheck, charged Transcribe and Edit Plan, then had its render
 * reserve refused.
 *
 * What it prices: run-time input values are merged over the snapshot nodes
 * through `mergeNodeInputOverrides` (a swapped media input also drops the
 * saved media-bound `metadata`, so a publisher's recorded length can't price a
 * caller's file); every executable node re-runs, so `rerunIds` is the whole
 * set and any upstream planner re-plans; the graph is then priced by the
 * editor's own whole-run estimate (`estimateWholeRun`): each node — each of
 * several providers at its own price — at its live model price (or the
 * cold-cache fallback) × fan-out × repeat × output minutes. Uncached model
 * prices (every provider's) are prefetched, then the total recomputes.
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
import { EDIT_PLAN_MAX_MINUTES, mergeNodeInputOverrides } from "@nodaro/shared"
import { estimateWholeRun } from "@/components/editor/workflow-editor/estimate-run-credits"
import { chosenRecordingUrl } from "@/lib/run-price"
import { withoutMediaLength } from "@nodaro/render-rules"
import { useEditPlanModes } from "@/lib/edit-plan-modes"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

export interface LiveRunEstimateDeps {
  /** The cached live price for a model identifier, or undefined when not yet fetched. */
  readonly getCachedCredits: (modelId: string) => number | undefined
  /** Fetch the live prices for these identifiers into the cache. */
  readonly prefetchModelCredits: (modelIds: string[]) => Promise<void>
  /** The server has reported this id priced nowhere (not asked again). Absent = never. */
  readonly isModelUnpriced?: (modelId: string) => boolean
}

export interface LiveRunEstimateArgs {
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
  /** Run-time input values keyed by node id (a published app's inputs). */
  readonly inputValues?: Record<string, Record<string, unknown>>
  /** False on editions without credits — nothing is computed and 0 is returned. */
  readonly enabled: boolean
  /**
   * The lengths (seconds) read for the recordings the user chose, by url
   * (`useChosenRecordingLengths`): a chosen recording is priced at its own
   * length, never at the creator's sample's (decided 2026-10-07).
   */
  readonly mediaLengths?: ReadonlyMap<string, number>
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
  mediaLengths?: ReadonlyMap<string, number>,
): WorkflowNode[] {
  if (!inputValues) return nodes
  return nodes.map((n) => {
    const vals = inputValues[n.id]
    if (!vals) return n
    const merged = mergeNodeInputOverrides(n.type, n.data as Record<string, unknown>, vals)
    // A recording the user chose replaces the creator's sample: no length the
    // sample carried describes it (`withoutMediaLength`), only the one read for
    // this very file, stamped with its url so the reader trusts it for that url alone.
    const chosen = chosenRecordingUrl(n, inputValues)
    if (chosen === undefined || chosen === (n.data as Record<string, unknown>).url) return { ...n, data: merged as typeof n.data }
    // A length not known (the browser cannot read the file, or the read is
    // still pending) is the longest recording (decision #3) for EVERY length
    // reader — not only Edit Plan and Apply EDL, which take that ceiling on
    // their own, but a Trim / Loop / Combine / Video SFX on the recording, which
    // would otherwise price their 8-second fallback while the server reserves
    // the probed length (review round F2, decided 2026-10-07). Video SFX caps
    // itself at its longest row.
    const length = mediaLengths?.get(chosen) ?? EDIT_PLAN_MAX_MINUTES * 60
    const data = withoutMediaLength(merged)
    // Both places a length is read from: `duration` (the Trim / Loop / Combine
    // estimators, `extractVideoDurationFromNode`) and the url-bound `metadata`
    // (Edit Plan and Apply EDL, `mediaLengthSecOf`).
    data.duration = length
    data.metadata = { ...((data.metadata as Record<string, unknown> | undefined) ?? {}), durationSeconds: length, mediaUrl: chosen }
    return { ...n, data: data as typeof n.data }
  })
}

/**
 * One synchronous pass over the graph with whatever prices are cached: the
 * run-time inputs merged in, then the editor's own whole-run estimate
 * (`estimateWholeRun` — the Execute-workflow badge, the run's confirm and
 * precheck), so the runner prices each of several providers, each run and
 * each output minute exactly as they do, and asks for every provider's price.
 */
export function computeLiveRunEstimate(
  args: Omit<LiveRunEstimateArgs, "enabled">,
  getCachedCredits: LiveRunEstimateDeps["getCachedCredits"],
  isModelUnpriced: NonNullable<LiveRunEstimateDeps["isModelUnpriced"]> = () => false,
): { total: number; uncachedModelIds: string[] } {
  const effectiveNodes = applyRunInputValues(args.nodes, args.inputValues, args.mediaLengths)
  return estimateWholeRun(effectiveNodes, args.edges, getCachedCredits, isModelUnpriced)
}

export function useLiveRunEstimate(args: LiveRunEstimateArgs, deps: LiveRunEstimateDeps): number {
  const { nodes, edges, inputValues, enabled, mediaLengths } = args
  const [estimate, setEstimate] = useState(0)
  // Edit Plan's id follows the server's per-minute answer, which can land after
  // the nodes (the runner seeds it from the app detail, the dashboard asks the
  // capabilities route): recompute when it does.
  const editPlanModesVersion = useEditPlanModes()
  const firstRunRef = useRef(true)
  // Read through a ref so a caller passing fresh function identities each
  // render does not re-trigger the effect (only the graph and inputs should).
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const compute = () => {
      const { getCachedCredits, prefetchModelCredits, isModelUnpriced } = depsRef.current
      const first = computeLiveRunEstimate({ nodes, edges, inputValues, mediaLengths }, getCachedCredits, isModelUnpriced)
      if (first.uncachedModelIds.length === 0) {
        setEstimate(first.total)
        return
      }
      // Quote what is known now, then the exact figure once prices land.
      setEstimate(first.total)
      prefetchModelCredits(first.uncachedModelIds).then(() => {
        if (cancelled) return
        setEstimate(computeLiveRunEstimate({ nodes, edges, inputValues, mediaLengths }, getCachedCredits, isModelUnpriced).total)
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
  }, [nodes, edges, inputValues, enabled, mediaLengths, editPlanModesVersion])

  return estimate
}
