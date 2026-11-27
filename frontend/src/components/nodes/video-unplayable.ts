import { unproxiedUrl } from "@/lib/video-result-download"

// The stored file a player's url names (one spelling for every reader of it).
export { unproxiedUrl }

/**
 * Whether a result's url is a kept original standing in for a preview that
 * could not be made (decided 2026-11-22). The job says so with
 * `videoPreviewUnavailable`; its `videoUrl` is then the original, the one
 * object stored as `videos/<id>-master.<ext>` (lib/video-original-keys.ts),
 * and no other result url ever names that key — so the url carries the job's
 * flag to every player, whatever shape its results take, a proxied one too.
 */
export function isPreviewUnavailableUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    return /\/videos\/[^/]+-master\.(mp4|mov|webm|mkv)$/i.test(new URL(unproxiedUrl(url), "https://x.invalid").pathname)
  } catch {
    return false
  }
}

/** MediaError codes for a file the browser read but cannot play: MEDIA_ERR_DECODE (3), MEDIA_ERR_SRC_NOT_SUPPORTED (4). */
const CANNOT_PLAY_CODES: ReadonlySet<number> = new Set([3, 4])

/**
 * Whether a `<video>` error on `url` should show the "can't play in your
 * browser" notice: only for a result flagged as having no preview copy
 * (`isPreviewUnavailableUrl`), and only when the browser could not decode or
 * does not support the file (codes 3 and 4). An aborted load (1) or a network
 * failure (2), and any failure on an ordinary preview, keep the node's own
 * failed-to-load handling.
 *
 * A file the server does not have (HTTP 404) is also reported as code 4 by
 * the browsers, and the element exposes nothing that tells the two apart; so
 * the notice is worded to be true in both cases (it could not be played here;
 * try downloading it).
 */
export function showsUnplayableNotice(error: { readonly code: number } | null | undefined, url: string | undefined): boolean {
  return error != null && CANNOT_PLAY_CODES.has(error.code) && isPreviewUnavailableUrl(url)
}
