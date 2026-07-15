import { YOUTUBE_HOSTS, isAllowedSocialVideoUrl } from "../../lib/url-validator.js"

/**
 * yt-dlp `--proxy` support, scoped to YouTube.
 *
 * YouTube bot-blocks the datacenter IP (Railway) — "Sign in to confirm you're not a bot" —
 * across every client rung (web/tv/android) AND the metadata probe, which took YouTube video
 * imports down ("Couldn't fetch this video"). The pinned yt-dlp, the base args, and the format
 * selector are all correct: they work verbatim from a residential IP and fail only from the
 * datacenter one. The single difference is the source IP, so routing the YouTube requests
 * through a RESIDENTIAL proxy (`YTDLP_PROXY`, e.g. Decodo) fixes the root cause — nothing about
 * "how we call yt-dlp" other than WHERE the request appears to come from.
 *
 * Two deliberate scopings:
 *   - YOUTUBE ONLY. TikTok/Instagram/X/Facebook are not bot-blocked, so they must not burn
 *     (paid, per-GB) residential proxy bandwidth. Non-YouTube urls get no proxy — byte-for-byte
 *     the pre-existing behaviour.
 *   - NO-OP WHEN UNSET. With `YTDLP_PROXY` absent (local dev, any un-provisioned environment)
 *     this adds nothing at all, so the download/probe args are unchanged until the secret lands.
 */
export function ytdlpProxyFor(url: string): string | undefined {
  const proxy = process.env.YTDLP_PROXY?.trim()
  if (!proxy) return undefined
  return isAllowedSocialVideoUrl(url, YOUTUBE_HOSTS) ? proxy : undefined
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
