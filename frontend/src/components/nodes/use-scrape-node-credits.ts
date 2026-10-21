import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useModelCreditCost } from "@/hooks/use-model-credit-cost"
import { scrapeAnalysisPriceIds, scrapeAnalysisRunCredits } from "@/lib/llm-price-ids"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { estimateNodeCredits } from "@/components/editor/workflow-editor/types"
import type { WorkflowNode } from "@/types/nodes"
import type { ScrapeNodeType } from "@/lib/scrape-node-types"
// @registry-lookup estimates the one node it is given (NODE_CREDIT_COSTS / estimateNodeCredits)

/**
 * The price on a scraper's Run button — what the run is CHARGED.
 *
 * The three scrapers were the only nodes that fed their Run button from
 * `estimateNodeCredits`, the static base table, while every other node and
 * every other surface on the same screen (the panel's Run button, the
 * Execute-workflow total, the confirm dialog) asks the server. The server's
 * figure is the final one; the table's is not. A site crawl read "Run (50 CR)"
 * on the node beside "Run This Node (55 credits)" in the panel, and 55 is what
 * was charged.
 *
 * The identifier comes from `getModelIdentifier` — the SAME mapping the panel
 * and the pre-run estimate use — so the two buttons cannot quote different
 * rows. The table stays as the fallback: while the price loads, and on an
 * edition with no credits at all (where the button hides the figure anyway).
 */
export function useScrapeNodeCredits(
  id: string,
  type: ScrapeNodeType,
  data: Record<string, unknown>,
): number {
  const node = { id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
  return useModelCredits(getModelIdentifier(node), estimateNodeCredits({ type, data }))
}

/**
 * A Meta Ads or Instagram scrape WITH AI analysis while metered LLM pricing is
 * on: its fixed scrape plus the whole analysis's quote (`quoteId`, the server's
 * own figure for the items' analysis at the analysis model's estimate), so the
 * Run button and the server estimate cannot price it apart — shown `~`.
 * Undefined until the server has answered the analysis key as an estimate (and
 * under the tier-pricing rollback, or without analysis): the node then shows
 * `useScrapeNodeCredits`' figure, as before.
 */
export function useScrapeAnalysisCredits(
  type: ScrapeNodeType,
  data: Record<string, unknown>,
): { readonly credits: number; readonly estimate: true } | undefined {
  const ids = scrapeAnalysisPriceIds({ type, data })
  const fixed = useModelCreditCost(ids?.fixedId).data
  const analysis = useModelCreditCost(ids?.quoteId).data
  const credits = ids ? scrapeAnalysisRunCredits({ type, data }, (id) => (id === ids.fixedId ? fixed : id === ids.quoteId ? analysis : undefined)) : undefined
  return credits === undefined ? undefined : { credits, estimate: true }
}
