/**
 * The run that finishes what the newest generation of a continue-from-failed
 * lineage stopped at for a Preview review (`continuation_preview_pending`,
 * decided 2026-10-18), worked out by the server so a caller never assembles
 * it: ONE run continuing that generation, of every held Apply EDL render at
 * Final and every held review-on use-case node continuing
 * the run that made its Preview — each with every node after it, as their own
 * Render finals run them (`renderFinalRunSet`, `usecaseFinalRunSet`).
 *
 * One run, not one Render final per hold: `renderFinal` takes one render,
 * and with two Previews feeding the same node, the final of either runs that
 * node on the other's Preview and is held there again. A use-case node has
 * no `renderFinal` on `/run` at all (`render_final_not_a_render`); its own
 * continue route (`mode: "render-final"`) renders its final result but runs
 * nothing after it in the workflow, so the lineage would stay held. The run
 * below continues the node's run through that same route — at Final, no fee —
 * and it joins the lineage (a subset continuation of its newest generation),
 * so the next continue-from-failed builds on it.
 *
 * It is sent as `POST /v1/workflows/:id/run` with these three fields (no
 * `continueMode`). Reads only.
 */
import { isUseCaseNodeType, renderFinalRunSet, usecaseFinalRunSet, usecaseRenderFinalOverrides } from "@nodaro/render-rules"
import { isPreviewHoldingType } from "@nodaro/shared/nodes"
import { loadContinuationSource } from "../services/workflow-engine/run-continuation.js"
import { usecasePreviewTargetIn } from "./use-case/preview-target.js"

export interface HeldFinalRun {
  readonly continueFromExecutionId: string
  /** The nodes it runs, in canvas order. */
  readonly nodeIds: string[]
  /** Each held render at Final; each held use-case node continuing its Preview's run (`useCaseContinue`). For this run only. */
  readonly inputOverrides: Record<string, Record<string, unknown>>
}

type GraphNode = { readonly id: string; readonly type?: string | null; readonly data?: unknown; readonly parentId?: string | null }
type GraphEdge = { readonly source: string; readonly target: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null; readonly data?: unknown }

/**
 * The run finishing every hold of generation `at`, or null when one of them
 * cannot be named: a node no longer on the workflow, or a use-case node whose
 * Preview's run is not found in `at` (or the executions it was seeded from).
 * Throws on a read error.
 */
export async function heldFinalRun(input: {
  readonly at: string
  readonly renderNodeIds: readonly string[]
  readonly reviewNodeIds: readonly string[]
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly userId: string
}): Promise<HeldFinalRun | null> {
  const { nodes, edges } = input
  const typeOf = new Map(nodes.map((n) => [n.id, n.type ?? ""]))
  const runs = new Set<string>()
  const inputOverrides: Record<string, Record<string, unknown>> = {}
  for (const id of input.renderNodeIds) {
    const set = renderFinalRunSet(id, nodes, edges)
    if (!set.has(id)) return null
    for (const n of set) runs.add(n)
    inputOverrides[id] = { quality: "final" }
  }
  if (input.reviewNodeIds.length > 0) {
    const isRenderNode = (id: string) => isPreviewHoldingType(typeOf.get(id))
    const source = await loadContinuationSource(input.at, { withStates: true, isRenderNode })
    if (!source || source.userId !== input.userId) return null
    for (const id of input.reviewNodeIds) {
      const type = typeOf.get(id)
      if (!isUseCaseNodeType(type)) return null
      const target = await usecasePreviewTargetIn(source, id, type, input.userId, isRenderNode)
      if (!target) return null
      for (const n of usecaseFinalRunSet(id, nodes, edges)) runs.add(n)
      Object.assign(inputOverrides, usecaseRenderFinalOverrides(id, target))
    }
  }
  if (runs.size === 0) return null
  return { continueFromExecutionId: input.at, nodeIds: nodes.filter((n) => runs.has(n.id)).map((n) => n.id), inputOverrides }
}
