/**
 * A use-case run's estimate before it starts (POST /v1/<use-case>/estimate and
 * the run route's balance check): its built graph priced by the workflow
 * estimator, plus the node's per-run fee (decided 2026-10-13). Loaded by core
 * routes through a dynamic import under hasCredits() (no credits → no estimate).
 */
import { initialRunNodeIds, usecaseFeeCreditId, type UseCaseGraph } from "@nodaro/render-rules"
import { estimateWorkflowCreditsDetailed, getChargedPriceTable, usecaseFeeCredits, type EstimateEdge, type EstimateNode } from "./credits.js"

export interface UseCaseEstimate {
  readonly stepsCredits: number
  readonly feeCredits: number
  readonly totalCredits: number
  /** A step is a metered LLM call's estimate (spec §8.5), so the total is one (`~`). Absent otherwise. */
  readonly estimate?: true
}

export async function estimateUseCaseCredits(graph: UseCaseGraph): Promise<UseCaseEstimate> {
  const nodes: EstimateNode[] = graph.nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n.data } }))
  const edges: EstimateEdge[] = graph.edges.map((e) => ({ ...e }))
  // A review-on run is quoted up to its proxy render; what follows it is its Render final's quote, with no fee.
  const firstRun = initialRunNodeIds(graph)
  const steps = await estimateWorkflowCreditsDetailed(nodes, edges, firstRun ? { runNodeIds: new Set(firstRun) } : undefined)
  const stepsCredits = steps.credits
  const feeCredits = usecaseFeeCredits(await getChargedPriceTable(), usecaseFeeCreditId(graph.nodeType))
  return { stepsCredits, feeCredits, totalCredits: stepsCredits + feeCredits, ...(steps.estimate ? { estimate: true as const } : {}) }
}
