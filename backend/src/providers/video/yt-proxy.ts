import { YOUTUBE_HOSTS, isAllowedSocialVideoUrl } from "../../lib/url-validator.js"

/**
 * yt-dlp proxy support, scoped to YouTube — now with a tiered POOL + failover.
 *
 * YouTube bot-blocks the datacenter IP (Railway), so YouTube requests route
 * through a residential/ISP proxy (the pinned yt-dlp, base args and format
 * selector are all correct — the ONLY thing that matters is where the request
 * appears to come from).
 *
 * TWO env vars, both optional, both YouTube-ONLY, both no-ops when unset:
 *   - `YTDLP_PROXY_POOL` — a TIERED pool. Tiers are separated by "|"; proxies
 *     within a tier by "," or whitespace. A download tries every proxy in tier
 *     order (exhaust the cheap tier before escalating), and WITHIN a tier the
 *     start rotates per-download so no single IP is hammered — the point of
 *     buying several dedicated ISP IPs (a lone static IP flags fast under load).
 *     Example: `isp1,isp2,…,isp10 | gate.decodo.com:7000`
 *       tier 1 = 10 dedicated ISP IPs (main), tier 2 = rotating residential (fallback).
 *   - `YTDLP_PROXY` — the legacy single proxy. Still works alone (unchanged). When
 *     BOTH are set it is appended as the FINAL fallback after the pool.
 *
 * Non-YouTube hosts (TikTok/Instagram/X/Facebook) get NO proxy — they aren't
 * bot-blocked and must not burn paid residential/ISP bandwidth.
 */

// Round-robin cursor for within-tier rotation. Module-level: approximate load
// spread (per process, reset on redeploy) is all we need — it just varies which
// IP a download starts on so a dedicated-ISP tier shares load evenly.
let rrCursor = 0

/** Parse `YTDLP_PROXY_POOL` into ordered tiers. Empties dropped. Exported for tests. */
export function parseProxyPool(raw: string | undefined): string[][] {
  if (!raw || !raw.trim()) return []
  return raw
    .split("|")
    .map((tier) =>
      tier
        .split(/[,\s]+/)
        .map((p) => p.trim())
        .filter(Boolean),
    )
    .filter((tier) => tier.length > 0)
}

/**
 * The ordered proxy chain to try for `url`: every `YTDLP_PROXY_POOL` tier (in
 * order, rotated within-tier for load spread), then the legacy `YTDLP_PROXY` as
 * a final fallback if set. Returns `[]` for non-YouTube hosts or when nothing is
 * configured — i.e. the download runs with no proxy, exactly as before.
 *
 * Advances the round-robin cursor once per call (a harmless side effect — it
 * only changes which in-tier IP is tried first).
 */
export function resolveProxyChain(url: string): string[] {
  if (!isAllowedSocialVideoUrl(url, YOUTUBE_HOSTS)) return []
  const tiers = parseProxyPool(process.env.YTDLP_PROXY_POOL)
  const cursor = rrCursor++
  const chain: string[] = []
  for (const tier of tiers) {
    const off = tier.length > 1 ? cursor % tier.length : 0
    for (let k = 0; k < tier.length; k++) chain.push(tier[(off + k) % tier.length])
  }
  const legacy = process.env.YTDLP_PROXY?.trim()
  if (legacy && !chain.includes(legacy)) chain.push(legacy)
  return chain
}

/**
 * The single "main" proxy for `url` (first of the chain), or undefined. Every
 * single-proxy consumer — the metadata probe, the audio paths, the section
 * auth-shim — uses this, so they transparently get the main tier (rotated). Only
 * the video download loops over the full chain for tier failover.
 */
export function ytdlpProxyFor(url: string): string | undefined {
  return resolveProxyChain(url)[0]
}

/** `--proxy <url>` CLI args for the direct-spawn video path. Empty array when not applicable. */
export function ytProxyArgs(url: string): string[] {
  const proxy = ytdlpProxyFor(url)
  return proxy ? ["--proxy", proxy] : []
}

/** The `{ proxy }` option for the `youtube-dl-exec` audio paths. Empty object when not applicable. */
export function ytProxyOption(url: string): { proxy?: string } {
  const proxy = ytdlpProxyFor(url)
  return proxy ? { proxy } : {}
}
