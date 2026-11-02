/**
 * Asks Cloudflare to drop its copies of the guest trend reads (every answer
 * tagged {@link TRENDS_CATALOG_CACHE_TAG}) when this deployment configures it
 * (lib/edge-purge.ts: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID`).
 * Unconfigured, nothing happens, and the guest reads promise no shared cache
 * a day (`trendCatalogEdgeConfigured`): a copy no one can drop must not be
 * kept that long.
 *
 * TWICE per burst of changes: at once, and again `settleMs` after the burst's
 * last change. Until every process has read the new stamp (catalog-stamp.ts),
 * one may still answer from its kept copy and the edge may refill from it;
 * the second purge drops that refill. Read at call time (keys are live).
 * Never throws: a failure is logged.
 */
import { edgePurgeConfigured, purgeEdgeTags } from "../../../lib/edge-purge.js"

/** The tag every guest trend answer the edge may keep carries (`Cache-Tag`). */
export const TRENDS_CATALOG_CACHE_TAG = "trends-catalog"

let trailing: ReturnType<typeof setTimeout> | null = null

/** Whether this deployment can drop the edge's copies (and so may let it keep them a day). */
export function trendCatalogEdgeConfigured(): boolean {
  return edgePurgeConfigured()
}

async function purgeTrendCatalogEdge(): Promise<void> {
  const outcome = await purgeEdgeTags([TRENDS_CATALOG_CACHE_TAG])
  if (outcome.status === "failed") console.error("[trends] the edge did not drop the catalog's copies:", outcome.error)
}

/** Drop the edge's copies now (unless a burst is already running) and again `settleMs` after the last change. */
export function requestTrendCatalogEdgePurge(settleMs: number): void {
  if (!edgePurgeConfigured()) return
  if (trailing) clearTimeout(trailing)
  else void purgeTrendCatalogEdge()
  trailing = setTimeout(() => {
    trailing = null
    void purgeTrendCatalogEdge()
  }, settleMs)
  trailing.unref?.()
}

/** Test-only: forget a pending trailing purge. */
export function _resetTrendCatalogEdgePurgeForTests(): void {
  if (trailing) clearTimeout(trailing)
  trailing = null
}
