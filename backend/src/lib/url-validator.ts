import { z } from "zod"
import { isPrivateOrReservedIP } from "./safe-fetch.js"

/**
 * Syntactic SSRF gate — rejects URLs whose string form already targets
 * localhost, a private/reserved IP literal, or a non-http(s) protocol.
 *
 * **This is the first of two layers. It is NOT sufficient on its own.**
 * It cannot resolve DNS, so a hostname `attacker.example` that A-records
 * to `10.x`, `127.x`, `169.254.169.254`, etc. passes this schema. Any
 * server-side fetch of a URL accepted by this schema MUST go through
 * `safeFetch` in `./safe-fetch.ts`, which validates the resolved IP at
 * connection time (and re-validates each redirect hop).
 *
 * Pair:
 *   - Route boundary: `z.object({ url: safeUrlSchema })` — rejects the
 *     obvious attacks at Zod parse (fast-fail, cheap).
 *   - Network boundary: `safeFetch(url, init)` — rejects DNS-based
 *     attacks at connect time (authoritative).
 */
export const safeUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return false
        }
        const hostname = parsed.hostname.toLowerCase()
        if (hostname === "localhost" || hostname === "[::1]") {
          return false
        }
        // Hostnames from URL parsing retain brackets for IPv6. Strip them
        // before handing to the shared IP classifier so `::1`, `fe80::…`,
        // IPv4-mapped, etc. are all handled consistently with safeFetch.
        const ip = hostname.replace(/^\[|\]$/g, "")
        if (isPrivateOrReservedIP(ip)) return false
        return true
      } catch {
        return false
      }
    },
    { message: "URL must use http(s) and must not point to localhost or private networks" },
  )

/**
 * Canonical allowlist of social-video hosts that the yt-dlp / ffmpeg download
 * paths accept (youtube-audio, extract-youtube-audio, download-video, the
 * worker `downloadAudioToR2`, and `trimAudio`). Single source of truth — every
 * callsite imports this rather than keeping its own copy.
 */
export const SOCIAL_VIDEO_HOSTS = [
  "youtube.com", "youtu.be",
  "tiktok.com",
  "instagram.com",
  "twitter.com", "x.com",
  "facebook.com", "fb.watch", "fb.com",
] as const

/** YouTube-only subset (the extract-youtube-audio route accepts only YouTube). */
export const YOUTUBE_HOSTS = ["youtube.com", "youtu.be"] as const

/** Instagram-only subset (the download path's proxy-failover chain is
 *  Instagram-scoped — see yt-proxy's resolveAttemptChain). */
export const INSTAGRAM_HOSTS = ["instagram.com"] as const

/**
 * Exact registrable-domain match against an allowlist.
 *
 * **SSRF gate** — replaces the unanchored `hostname.includes(domain)` substring
 * check that previously guarded every yt-dlp callsite. A substring check let an
 * attacker-controlled host like `youtube.com.attacker.example` pass and then
 * resolve to an internal/metadata IP (yt-dlp does its own DNS+HTTP, bypassing
 * `safeFetch`). Exact-suffix matching admits only the domain itself or a true
 * subdomain (`www.youtube.com`, `m.youtu.be`), which the attacker cannot
 * DNS-control because the allowlist is fixed, reputable domains.
 */
export function hostnameMatchesAllowlist(hostname: string, domains: readonly string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "") // strip FQDN trailing dot
  return domains.some((d) => {
    const dom = d.toLowerCase()
    return h === dom || h.endsWith("." + dom)
  })
}

/** True when `url`'s host is on the social-video allowlist (exact-suffix match). */
export function isAllowedSocialVideoUrl(url: string, domains: readonly string[] = SOCIAL_VIDEO_HOSTS): boolean {
  try {
    return hostnameMatchesAllowlist(new URL(url).hostname, domains)
  } catch {
    return false
  }
}

/**
 * File extensions accepted as DIRECT video-file URLs (pathname suffix match).
 * Mirrors save-to-storage's video auto-detect set.
 */
export const DIRECT_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi"] as const

/**
 * True for a DIRECT video-file URL: http(s) whose PATHNAME ends in a video
 * extension — `https://cdn.nodaro.ai/uploads/videos/<id>.mp4` and any other
 * cdn-style link. Query/fragment are ignored (signed CDN URLs keep the
 * extension in the path); an extension that appears only in the query does not
 * qualify. Host-agnostic BY DESIGN, which is exactly why admission is not
 * sufficient on its own: yt-dlp does its own DNS+HTTP (no `safeFetch`), so the
 * download route must pre-resolve these hosts via
 * `resolvesOnlyToPublicAddresses` before fetching.
 */
export function isDirectVideoFileUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
    const path = parsed.pathname.toLowerCase()
    return DIRECT_VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext))
  } catch {
    return false
  }
}

/** True when the video-download paths accept `url`: a social host OR a direct
 *  video file. The provider's defense-in-depth guard uses this; the route layers
 *  the DNS pre-resolve on top for the direct (arbitrary-host) case. */
export function isAllowedVideoImportUrl(url: string): boolean {
  return isAllowedSocialVideoUrl(url) || isDirectVideoFileUrl(url)
}

/**
 * Bare origin URL — `https://example.com` (or `http://localhost`), no path /
 * query / fragment. Used for CORS allowlists and CSP `frame-ancestors` lists,
 * where any extra characters in the stored value would be either silently
 * ignored or — worse — interpreted as an allowlist-pollution / header-
 * directive injection vector when the value is later concatenated into a
 * response header.
 */
export const bareOriginSchema = z
  .string()
  .url()
  .refine(
    (v) => {
      try {
        const u = new URL(v)
        if (u.protocol !== "http:" && u.protocol !== "https:") return false
        return u.pathname === "/" && u.search === "" && u.hash === ""
      } catch {
        return false
      }
    },
    { message: "Must be a bare http(s) origin (no path, query, or fragment)" },
  )
