import { YOUTUBE_HOSTS, INSTAGRAM_HOSTS, isAllowedSocialVideoUrl } from "../../lib/url-validator.js"

/**
 * yt-dlp proxy support — a tiered POOL + failover, scoped per host class.
 *
 * YouTube bot-blocks the datacenter IP (Railway), so YouTube requests route
 * through a residential/ISP proxy (the pinned yt-dlp, base args and format
 * selector are all correct — the ONLY thing that matters is where the request
 * appears to come from).
 *
 * TWO env vars, both optional, both no-ops when unset:
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
 * Who gets proxied (see `resolveAttemptChain`):
 *   - YouTube: pool-FIRST — a direct attempt from the datacenter IP is a
 *     guaranteed 429, so it is never tried.
 *   - Instagram: direct-first, pool as FAILOVER. Instagram serves some
 *     datacenter IPs a degraded, audio-less format set per-post (measured
 *     2026-07-21: the same reel returns DASH audio + full formats through the
 *     ISP pool and an audio-less set to Railway) — most posts still fetch fine
 *     directly, so paid bandwidth burns only when the free attempt failed.
 *   - TikTok/X/Facebook and direct video-file urls: NO proxy — not (yet)
 *     bot-blocked; must not burn paid residential/ISP bandwidth.
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
 * The configured proxy chain, HOST-UNGATED: every `YTDLP_PROXY_POOL` tier (in
 * order, rotated within-tier for load spread), then the legacy `YTDLP_PROXY` as
 * a final fallback if set. `[]` when nothing is configured.
 *
 * Advances the round-robin cursor once per call (a harmless side effect — it
 * only changes which in-tier IP is tried first).
 */
function configuredProxyChain(): string[] {
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
 * The ordered proxy chain to try for `url` — `configuredProxyChain` gated to
 * YouTube. Returns `[]` for non-YouTube hosts or when nothing is configured —
 * i.e. the download runs with no proxy, exactly as before.
 */
export function resolveProxyChain(url: string): string[] {
  if (!isAllowedSocialVideoUrl(url, YOUTUBE_HOSTS)) return []
  return configuredProxyChain()
}

/**
 * The ordered DOWNLOAD ATTEMPTS for `url`: each entry is a proxy url, or `null`
 * for a direct (no-proxy) attempt.
 *
 *   - YouTube: the proxy chain verbatim when configured (never a direct
 *     attempt — the datacenter IP is hard-blocked, it would be a wasted 429),
 *     else one direct attempt. Byte-identical to the pre-existing behaviour.
 *   - Instagram: DIRECT FIRST (free — most posts fetch fine), then the pool as
 *     failover for the posts Instagram degrades for datacenter IPs (see the
 *     module header). Nothing configured → one direct attempt, unchanged.
 *   - Everything else: one direct attempt.
 */
export function resolveAttemptChain(url: string): (string | null)[] {
  if (isAllowedSocialVideoUrl(url, YOUTUBE_HOSTS)) {
    const chain = configuredProxyChain()
    return chain.length > 0 ? chain : [null]
  }
  if (isAllowedSocialVideoUrl(url, INSTAGRAM_HOSTS)) {
    return [null, ...configuredProxyChain()]
  }
  return [null]
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
