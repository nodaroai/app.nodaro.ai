import { safeFetch } from "../../lib/safe-fetch.js"
import { YOUTUBE_HOSTS, hostnameMatchesAllowlist } from "../../lib/url-validator.js"

/**
 * Metadata probe via the OFFICIAL YouTube Data API v3.
 *
 * WHY: the yt-dlp `--dump-json` probe hits the same datacenter-IP bot-block as
 * the download (it runs through the residential proxy and grinds the web→tv→
 * android client ladder, making "Checking video…" slow/flaky). The Data API is
 * a keyed Google endpoint — no proxy, no bot-block, no client ladder — so it
 * answers duration/title/live instantly and reliably.
 *
 * It is an ADD-ON, not a replacement: `ytDataApiProbe` returns null on any miss
 * (no key, unextractable id, API error, video not found) and the caller
 * (`ytMetadataProbe`) falls through to the existing yt-dlp probe. With no
 * `YOUTUBE_API_KEY` set it is a complete no-op — byte-for-byte the old behaviour.
 */

export interface YtProbeResult {
  durationSec: number | null
  title: string | null
  isLive: boolean
}

const API_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos"
const ID_RE = /^[A-Za-z0-9_-]{11}$/

/**
 * Extract the 11-char video ID from a YouTube URL. Returns null when the URL is
 * not a recognizable single-video YouTube link (playlists, channels, search,
 * non-YouTube hosts). Covers watch?v=, youtu.be/<id>, and /shorts|embed|v|live/<id>
 * across the www./m./music. subdomains.
 */
export function youtubeVideoId(rawUrl: string): string | null {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  if (!hostnameMatchesAllowlist(u.hostname, YOUTUBE_HOSTS)) return null

  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "")
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0]
    return ID_RE.test(id) ? id : null
  }
  const v = u.searchParams.get("v")
  if (v && ID_RE.test(v)) return v
  const m = u.pathname.match(/^\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/)
  return m ? m[1] : null
}

/**
 * Parse an ISO 8601 duration (YouTube's `contentDetails.duration`, e.g.
 * "PT4M13S", "PT1H2M3S", "P0D" for live) to whole seconds. Returns null on a
 * shape it doesn't recognize. Accepts an optional leading day component and an
 * optional time part so "P0D" (live/unknown) parses to 0.
 */
export function parseIso8601Duration(iso: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso)
  if (!m) return null
  const [, d, h, min, s] = m
  // Guard the all-empty match ("P", "PT") — those carry no duration.
  if (d === undefined && h === undefined && min === undefined && s === undefined) return null
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)
}

/**
 * Probe video metadata via the YouTube Data API v3. Returns null (→ caller falls
 * back to the yt-dlp probe) when: no API key, the URL has no extractable video
 * id, the request fails / returns non-2xx, or the video is not found (private /
 * deleted / bad id). Never throws — the API is best-effort, yt-dlp is the floor.
 */
export async function ytDataApiProbe(
  url: string,
  opts: { apiKey?: string; timeoutMs?: number } = {},
): Promise<YtProbeResult | null> {
  const apiKey = opts.apiKey ?? process.env.YOUTUBE_API_KEY?.trim()
  if (!apiKey) return null
  const videoId = youtubeVideoId(url)
  if (!videoId) return null

  const endpoint = new URL(API_ENDPOINT)
  endpoint.searchParams.set("part", "snippet,contentDetails")
  endpoint.searchParams.set("id", videoId)
  endpoint.searchParams.set("key", apiKey)

  try {
    const res = await safeFetch(endpoint.toString(), { timeoutMs: opts.timeoutMs ?? 10_000 })
    if (!res.ok) {
      // Log the status (never the URL — it carries the key) so a bad/exhausted
      // key is visible in ops instead of silently falling back every request.
      console.warn(`[youtube-data-api] probe returned HTTP ${res.status}; falling back to yt-dlp`)
      return null
    }
    const body = (await res.json()) as {
      items?: Array<{
        snippet?: { title?: string; liveBroadcastContent?: string }
        contentDetails?: { duration?: string }
      }>
    }
    const item = body.items?.[0]
    if (!item) return null // not found / private / deleted → let yt-dlp try

    const iso = item.contentDetails?.duration
    const live = item.snippet?.liveBroadcastContent
    return {
      durationSec: iso ? parseIso8601Duration(iso) : null,
      title: item.snippet?.title ?? null,
      isLive: live === "live" || live === "upcoming",
    }
  } catch {
    // Network/timeout/JSON error — swallow (never surface the key-bearing URL)
    // and fall back to the yt-dlp probe.
    return null
  }
}
