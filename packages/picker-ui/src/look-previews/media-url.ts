const CF_MEDIA_PREFIX = "/cdn-cgi/media/"

/** Hosts whose Cloudflare zone serves `/cdn-cgi/media/` (same set as the image transform). */
const MEDIA_HOSTS: ReadonlySet<string> = new Set(["cdn.nodaro.ai", "assets.nodaro.ai"])

/** A render that is a clip rather than a still (the camera-motion set). */
export function isVideoPreview(url: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(new URL(url, "https://x.invalid").pathname)
}

/**
 * A small derivative of a CDN video via Cloudflare Media Transformations:
 * `frame` is a still (the poster, taken 1s in — the shortest clip runs 3s),
 * `video` a silent re-encode at the given width. Both are generated once and
 * cached at the edge, so a tile never downloads the multi-MB original.
 * Off the CDN, the original URL is returned unchanged.
 */
export function cdnVideoUrl(url: string, opts: { readonly mode: "frame" | "video"; readonly width: number }): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (!MEDIA_HOSTS.has(parsed.hostname) || parsed.pathname.startsWith(CF_MEDIA_PREFIX)) return url
  const params = opts.mode === "frame"
    ? `mode=frame,time=1s,width=${opts.width}`
    : `mode=video,width=${opts.width},audio=false`
  return `${parsed.origin}${CF_MEDIA_PREFIX}${params}${parsed.pathname}`
}
