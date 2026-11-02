/**
 * Asks Cloudflare to drop copies it keeps, when this deployment configures
 * it: `CLOUDFLARE_API_TOKEN` (a token allowed to purge the zone's cache) and
 * `CLOUDFLARE_ZONE_ID`. Two questions share it: the guest trend catalog's
 * copies, by tag (ee/lib/trends/edge-purge.ts), and a restricted file's
 * address, by URL (lib/content-restriction-bytes.ts).
 *
 * Read at call time (keys are live). Never throws: the answer says what
 * happened — done, not configured, or failed with the reason — and the
 * caller records it, so an edge that still answers is never a surprise.
 */

const PURGE_TIMEOUT_MS = 10_000
/** Cloudflare takes this many URLs per purge call. */
export const PURGE_URLS_PER_CALL = 30

export type EdgePurgeOutcome =
  | { readonly status: "done" }
  | { readonly status: "not_configured" }
  | { readonly status: "failed"; readonly error: string }

function edgeConfig(): { token: string; zone: string } | null {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
  const zone = process.env.CLOUDFLARE_ZONE_ID?.trim()
  return token && zone ? { token, zone } : null
}

/** Whether this deployment can ask the edge to drop its copies. */
export function edgePurgeConfigured(): boolean {
  return edgeConfig() !== null
}

async function purgeOnce(body: Record<string, readonly string[]>): Promise<EdgePurgeOutcome> {
  const config = edgeConfig()
  if (!config) return { status: "not_configured" }
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.zone)}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
    })
    if (!res.ok) return { status: "failed", error: `${res.status}: ${(await res.text()).slice(0, 300)}` }
    return { status: "done" }
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) }
  }
}

/** Drop every copy tagged with one of `tags`. */
export function purgeEdgeTags(tags: readonly string[]): Promise<EdgePurgeOutcome> {
  return purgeOnce({ tags })
}

/**
 * Drop the copies of these addresses, `PURGE_URLS_PER_CALL` at a time. Every
 * call is made; the answer is the first failure, if any. The addresses must
 * be on hosts of the configured zone: the edge answers success for a host
 * it does not serve, and purges nothing.
 */
export async function purgeEdgeUrls(urls: readonly string[]): Promise<EdgePurgeOutcome> {
  const unique = [...new Set(urls)]
  if (unique.length === 0) return edgePurgeConfigured() ? { status: "done" } : { status: "not_configured" }
  let failed: EdgePurgeOutcome | null = null
  for (let i = 0; i < unique.length; i += PURGE_URLS_PER_CALL) {
    const outcome = await purgeOnce({ files: unique.slice(i, i + PURGE_URLS_PER_CALL) })
    if (outcome.status === "not_configured") return outcome
    if (outcome.status === "failed" && !failed) failed = outcome
  }
  return failed ?? { status: "done" }
}
