/**
 * Asks Cloudflare to drop its copies of the guest trend reads (every answer
 * tagged {@link TRENDS_CATALOG_CACHE_TAG}) when this deployment configures it:
 * `CLOUDFLARE_API_TOKEN` (a token allowed to purge the zone's cache) and
 * `CLOUDFLARE_ZONE_ID`. Unconfigured, nothing happens, and the guest reads
 * promise no shared cache a day (`trendCatalogEdgeConfigured`): a copy no one
 * can drop must not be kept that long.
 *
 * TWICE per burst of changes: at once, and again `settleMs` after the burst's
 * last change. Until every process has read the new stamp (catalog-stamp.ts),
 * one may still answer from its kept copy and the edge may refill from it;
 * the second purge drops that refill. Read at call time (keys are live).
 * Never throws: a failure is logged.
 */

/** The tag every guest trend answer the edge may keep carries (`Cache-Tag`). */
export const TRENDS_CATALOG_CACHE_TAG = "trends-catalog"

const PURGE_TIMEOUT_MS = 10_000

let trailing: ReturnType<typeof setTimeout> | null = null

function edgeConfig(): { token: string; zone: string } | null {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
  const zone = process.env.CLOUDFLARE_ZONE_ID?.trim()
  return token && zone ? { token, zone } : null
}

/** Whether this deployment can drop the edge's copies (and so may let it keep them a day). */
export function trendCatalogEdgeConfigured(): boolean {
  return edgeConfig() !== null
}

async function purgeTrendCatalogEdge(): Promise<void> {
  const config = edgeConfig()
  if (!config) return
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.zone)}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tags: [TRENDS_CATALOG_CACHE_TAG] }),
      signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
    })
    if (!res.ok) console.error(`[trends] the edge refused to drop the catalog's copies (${res.status}):`, (await res.text()).slice(0, 300))
  } catch (e) {
    console.error("[trends] could not ask the edge to drop the catalog's copies:", e)
  }
}

/** Drop the edge's copies now (unless a burst is already running) and again `settleMs` after the last change. */
export function requestTrendCatalogEdgePurge(settleMs: number): void {
  if (!edgeConfig()) return
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
