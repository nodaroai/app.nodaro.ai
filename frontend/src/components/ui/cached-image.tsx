import { useEffect, useRef, useState } from "react"
import { optimizedImageUrl } from "@/lib/image"

// In-memory image cache — keeps decoded images in browser memory
// so <img> elements render synchronously without flash on remount.
const preloaded = new Set<string>()

/** Track URLs that failed direct load and need proxy. */
const proxyNeeded = new Set<string>()

/** Default optimization for non-thumbnail (full-size) displays: cap width and
 *  transcode to AVIF/WebP via Cloudflare so the UI never ships a multi-MB
 *  original PNG. Downloads/originals don't use this component, so they're
 *  unaffected. Matches the "balanced" tier (~300–800KB on a 7MB source). */
const FULL_VIEW_OPTS = { width: 2048, quality: 85 } as const

/** External hosts known to set Cross-Origin-Resource-Policy, which blocks
 *  direct browser loading. Skip the direct preload entirely for these and
 *  route straight through our image-proxy to avoid the CORP error appearing
 *  in the console on every workflow refresh. */
const KNOWN_CORP_HOSTS = [
  "cdninstagram.com",
  "fbcdn.net",
  "cdninstagramcdn",
  "xx.fbcdn.net",
]

function isKnownCorpBlocked(url: string): boolean {
  return KNOWN_CORP_HOSTS.some((h) => url.includes(h))
}

/** Only our R2/CDN origins need CORS — external URLs (Instagram, etc.) break with crossOrigin. */
function isInternalUrl(url: string): boolean {
  return url.includes("cdn.nodaro.ai") || url.includes("r2.cloudflarestorage.com") || url.includes("nodaro-")
}

function proxyUrl(url: string): string {
  return `/v1/image-proxy?url=${encodeURIComponent(url)}`
}

export function CachedImage({
  src,
  alt,
  className,
  onClick,
  draggable,
  onError,
  onLoadDimensions,
  thumbnail,
  thumbnailWidth,
  raw,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  thumbnail?: boolean
  thumbnailWidth?: number
  /** Opt out of CDN optimization and load the untouched original. Use only when
   *  exact original pixels are required — downloads should not use this
   *  component at all. */
  raw?: boolean
  /** Fires once per successful load with the rendered image's natural pixel
   *  size. Used by media nodes to capture and persist aspect ratio on the
   *  GeneratedResult so result-switching is synchronous. */
  onLoadDimensions?: (dim: { width: number; height: number }) => void
}) {
  // Optimize by default: thumbnails get their explicit small width, everything
  // else is capped/transcoded for display. optimizedImageUrl only rewrites our
  // CDN URLs and skips already-transformed ones, so non-CDN/data/blob URLs and
  // pre-optimized srcs pass through untouched.
  const effectiveSrc = !src || raw
    ? src
    : thumbnail
      ? optimizedImageUrl(src, { width: thumbnailWidth })
      : optimizedImageUrl(src, FULL_VIEW_OPTS)

  // Progressive loading: for full-size CDN images (URL actually transformed, so
  // effectiveSrc !== src), show a small ~320px version first, then swap in the
  // capped 2048 version once it has decoded. The 320px width matches the common
  // grid thumbnail tier, so it's usually already cached and paints instantly.
  const placeholderSrc =
    src && effectiveSrc && effectiveSrc !== src && !thumbnail && !raw
      ? optimizedImageUrl(src, { width: 320 })
      : null

  const [hiReady, setHiReady] = useState(() => !!effectiveSrc && preloaded.has(effectiveSrc))
  const [loaded, setLoaded] = useState(() => preloaded.has(effectiveSrc ?? ""))
  const [useProxy, setUseProxy] = useState(() => {
    if (!effectiveSrc) return false
    return proxyNeeded.has(effectiveSrc) || isKnownCorpBlocked(effectiveSrc)
  })
  const imgRef = useRef<HTMLImageElement>(null)

  // Preload the hi-res target and flip hiReady once it has decoded, so the
  // placeholder can be swapped out. Skips CORP-blocked hosts (routed through the
  // proxy below) and resets to show the placeholder again on a new uncached src.
  useEffect(() => {
    if (!effectiveSrc) return
    if (preloaded.has(effectiveSrc)) { setHiReady(true); return }
    setHiReady(false)
    if (isKnownCorpBlocked(effectiveSrc)) return
    const img = new Image()
    if (isInternalUrl(effectiveSrc)) img.crossOrigin = "anonymous"
    else img.referrerPolicy = "no-referrer"
    img.onload = () => { preloaded.add(effectiveSrc); setHiReady(true) }
    img.onerror = () => {}
    img.src = effectiveSrc
  }, [effectiveSrc])

  // Check if already complete (memory cache hit)
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true)
    }
  }, [effectiveSrc])

  // Reset proxy state when src changes
  useEffect(() => {
    if (!effectiveSrc) { setUseProxy(false); return }
    setUseProxy(proxyNeeded.has(effectiveSrc) || isKnownCorpBlocked(effectiveSrc))
  }, [effectiveSrc])

  const internal = effectiveSrc ? isInternalUrl(effectiveSrc) : false
  // Show the placeholder until the hi-res has decoded; the placeholder is always
  // one of our CDN URLs, so it never needs the proxy.
  const showSrc = placeholderSrc && !hiReady ? placeholderSrc : effectiveSrc
  const displaySrc = useProxy && effectiveSrc ? proxyUrl(effectiveSrc) : showSrc

  return (
    <img
      ref={imgRef}
      src={displaySrc}
      crossOrigin={internal ? "anonymous" : undefined}
      referrerPolicy={internal ? undefined : "no-referrer"}
      alt={alt}
      className={className}
      onClick={onClick}
      draggable={draggable}
      onLoad={(e) => {
        setLoaded(true)
        const img = e.currentTarget
        // Report dimensions from the hi-res image, not the placeholder (same
        // aspect ratio, but consumers expect the real decoded size).
        if (onLoadDimensions && img.naturalWidth > 0 && (!placeholderSrc || hiReady)) {
          onLoadDimensions({ width: img.naturalWidth, height: img.naturalHeight })
        }
      }}
      onError={(e) => {
        // External image failed (CORP, hotlink protection, etc.) — retry via backend proxy
        if (effectiveSrc && !internal && !useProxy) {
          proxyNeeded.add(effectiveSrc)
          setUseProxy(true)
          return
        }
        onError?.(e)
      }}
      style={{ opacity: loaded ? 1 : 0, transition: "opacity 0s", ...props.style }}
      {...props}
    />
  )
}
