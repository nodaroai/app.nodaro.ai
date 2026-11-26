/**
 * The stored file a player's url names: `url` itself, or the file a
 * `/v1/image-proxy?url=…` link reads through the app's proxy.
 */
export function unproxiedUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://x.invalid")
    if (parsed.pathname.endsWith("/v1/image-proxy")) return parsed.searchParams.get("url") ?? url
  } catch {
    // Not a url: itself.
  }
  return url
}

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

/**
 * The file extension a video download is saved under: the stored file's own
 * (a kept original may be `.mov`, `.webm`, `.mkv`), read from the real key
 * even when the player's url is proxied or relative; else `.mp4`.
 */
export function videoDownloadExtension(url: string): string {
  try {
    const ext = /\.([a-z0-9]{2,4})$/i.exec(new URL(unproxiedUrl(url), "https://x.invalid").pathname)?.[1]?.toLowerCase()
    return ext && ["mp4", "mov", "webm", "mkv"].includes(ext) ? ext : "mp4"
  } catch {
    return "mp4"
  }
}

/** Download `url` through the app's download proxy, named `<label>.<its extension>`. */
export function downloadVideoFile(url: string, label: string): void {
  const a = document.createElement("a")
  a.href = `/v1/image-proxy?url=${encodeURIComponent(unproxiedUrl(url))}&download=1`
  a.download = `${label || "video"}.${videoDownloadExtension(url)}`
  a.click()
}
