import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { estimateNodeCredits } from "@/components/editor/workflow-editor/types"
import type { WorkflowNode } from "@/types/nodes"

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
  type: "web-scrape" | "meta-ads-scrape" | "instagram-scrape" | "social-search",
  data: Record<string, unknown>,
): number {
  const node = { id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
  return useModelCredits(getModelIdentifier(node), estimateNodeCredits({ type, data }))
}
