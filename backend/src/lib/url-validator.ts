import { z } from "zod"
import {
  SOCIAL_VIDEO_HOSTS,
  YOUTUBE_HOSTS,
  INSTAGRAM_HOSTS,
  hostnameMatchesAllowlist,
  hasUrlParserHazard,
  DIRECT_VIDEO_EXTENSIONS,
  isDirectVideoFileUrl,
  isLocalOrPrivateHostname,
} from "@nodaro/shared"
import { isConfiguredStorageUrl } from "./own-storage-url.js"

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
        // This install's own public-storage subtree (self-host MinIO behind
        // the app origin) is legitimately localhost — see safe-fetch.ts.
        if (isConfiguredStorageUrl(parsed)) return true
        // Hostnames from URL parsing retain brackets for IPv6; the shared rule
        // strips them and classifies `::1`, `fe80::…`, IPv4-mapped, etc.
        // consistently with safeFetch — and is the very rule the app runner's
        // link card applies, so the two cannot disagree on a literal host.
        if (isLocalOrPrivateHostname(parsed.hostname)) return false
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
 * worker `downloadAudioToR2`, and `trimAudio`), its YouTube-only and
 * Instagram-only subsets, and the exact-suffix matcher.
 *
 * They LIVE in `@nodaro/shared` (`video-link.ts`) and are re-exported here so
 * every backend callsite keeps importing them from this module. One list for
 * the server's SSRF gate AND the editor's "is this a link I should download"
 * decision: the editor must never offer a host this gate refuses, nor sit on
 * one it admits.
 *
 * **SSRF gate** — the matcher replaces the unanchored `hostname.includes(domain)`
 * substring check that previously guarded every yt-dlp callsite. A substring
 * check let an attacker-controlled host like `youtube.com.attacker.example`
 * pass and then resolve to an internal/metadata IP (yt-dlp does its own
 * DNS+HTTP, bypassing `safeFetch`). Exact-suffix matching admits only the
 * domain itself or a true subdomain (`www.youtube.com`, `m.youtu.be`), which
 * the attacker cannot DNS-control because the allowlist is fixed, reputable
 * domains.
 */
export { SOCIAL_VIDEO_HOSTS, YOUTUBE_HOSTS, INSTAGRAM_HOSTS, hostnameMatchesAllowlist }

/**
 * True when `url`'s host is on the social-video allowlist (exact-suffix match).
 *
 * A link carrying a backslash or a control character is refused BEFORE the host
 * is read (`hasUrlParserHazard`). This function parses the WHATWG way, where
 * `https://tiktok.com\@10.0.0.1/x` has host `tiktok.com`; yt-dlp is handed the
 * RAW string and parses it itself, and a parser that ends the authority at "/"
 * alone reads host `10.0.0.1`. The allowlist is only a gate if both readers
 * agree on what it admitted — so a string they can disagree on is not admitted.
 */
export function isAllowedSocialVideoUrl(url: string, domains: readonly string[] = SOCIAL_VIDEO_HOSTS): boolean {
  if (hasUrlParserHazard(url)) return false
  try {
    return hostnameMatchesAllowlist(new URL(url).hostname, domains)
  } catch {
    return false
  }
}

// The direct-file rule lives in `@nodaro/shared` too (`video-link.ts`): the app
// runner's card and the run-request lock apply the SAME rule this route does.
export { DIRECT_VIDEO_EXTENSIONS, isDirectVideoFileUrl }

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
