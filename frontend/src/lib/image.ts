const CF_TRANSFORM_PREFIX = "/cdn-cgi/image/"

/**
 * Hosts where Cloudflare's `/cdn-cgi/image/` transform is available.
 * Includes the canonical CDN domain plus the R2-public-bucket alias —
 * both currently point at the same Cloudflare-fronted origin, but the
 * `R2_PUBLIC_URL` env var on the backend can legitimately be configured
 * to either. Keep this set narrow: a too-broad match wraps URLs whose
 * origin doesn't actually serve the transform and silently 404s the
 * image. To add a new host, verify the `/cdn-cgi/image/` path is enabled
 * on that origin's Cloudflare zone first.
 */
const TRANSFORMABLE_HOSTS: ReadonlySet<string> = new Set([
  "cdn.nodaro.ai",
  "assets.nodaro.ai",
])

type OptimizeOpts = { width?: number; quality?: number }

/**
 * Files the resizer must not touch: a GIF would lose its animation (the
 * transform re-encodes it to one still frame) and an SVG is a vector, drawn
 * sharp at any size by the browser as it is.
 */
const UNTRANSFORMED_EXTENSIONS: ReadonlySet<string> = new Set(["gif", "svg"])

/** The extension of a URL's path, lower case ("" when it has none). */
function pathExtension(pathname: string): string {
  const name = pathname.slice(pathname.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/** The image extensions a result can carry, each kept as it is in a download's name. */
const DOWNLOAD_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"])

/**
 * The extension to save an image result under: the one its URL carries when it
 * is an image's (GPT Image 2.6 writes PNG, JPEG, WebP, GIF or SVG), else `png`.
 */
export function imageDownloadExtension(url: string | undefined | null): string {
  if (!url) return "png"
  let pathname: string
  try {
    pathname = new URL(url, "https://x.invalid").pathname
  } catch {
    return "png"
  }
  const ext = pathExtension(pathname)
  return DOWNLOAD_IMAGE_EXTENSIONS.has(ext) ? ext : "png"
}

// Overloads: a `string` in always yields a `string` out (existing callers are
// unchanged), but an optional URL passes through as `undefined` so call sites
// with possibly-missing URLs don't each need a `url ? optimizedImageUrl(url) :
// undefined` guard. An empty string stays `""` (keeps the string overload
// sound); `null`/`undefined` collapse to `undefined` so React omits the
// img `src` attribute rather than requesting the current page.
export function optimizedImageUrl(url: string, opts?: OptimizeOpts): string
export function optimizedImageUrl(url: string | undefined | null, opts?: OptimizeOpts): string | undefined
export function optimizedImageUrl(
  url: string | undefined | null,
  opts: OptimizeOpts = {},
): string | undefined {
  if (!url) return url ?? undefined
  // Already transformed — don't double-wrap
  if (url.includes(CF_TRANSFORM_PREFIX)) return url

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  // Use `hostname` not `host` so URLs with explicit non-default ports
  // (e.g., `cdn.nodaro.ai:8443` from local dev / staging variants) still
  // match. Production R2 URLs don't carry ports, but the strict-match
  // would silently skip the transform for any that ever do.
  if (!TRANSFORMABLE_HOSTS.has(parsed.hostname)) return url
  // A GIF keeps its animation and an SVG stays a vector: served as they are.
  if (UNTRANSFORMED_EXTENSIONS.has(pathExtension(parsed.pathname))) return url

  const { width = 480, quality = 80 } = opts
  const params = `width=${width},format=auto,quality=${quality}`
  return `${parsed.origin}${CF_TRANSFORM_PREFIX}${params}${parsed.pathname}`
}
