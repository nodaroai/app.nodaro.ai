import { useEffect, useRef, useState } from "react"
import { optimizedImageUrl } from "@/lib/image"

// In-memory image cache — keeps decoded images in browser memory
// so <img> elements render synchronously without flash on remount.
const preloaded = new Set<string>()

/** Track URLs that failed direct load and need proxy. */
const proxyNeeded = new Set<string>()

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

function preloadImage(src: string) {
  if (!src || preloaded.has(src)) return
  preloaded.add(src)
  const img = new Image()
  if (isInternalUrl(src)) {
    img.crossOrigin = "anonymous"
  } else {
    img.referrerPolicy = "no-referrer"
  }
  // Suppress console noise from failed preloads — the <img> onError handler
  // below already falls back to the proxy for user-visible rendering.
  img.onerror = () => {}
  img.src = src
}

export function CachedImage({
  src,
  alt,
  className,
  onClick,
  draggable,
  onError,
  thumbnail,
  thumbnailWidth,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  thumbnail?: boolean
  thumbnailWidth?: number
}) {
  const effectiveSrc = thumbnail && src
    ? optimizedImageUrl(src, { width: thumbnailWidth })
    : src

  const [loaded, setLoaded] = useState(() => preloaded.has(effectiveSrc ?? ""))
  const [useProxy, setUseProxy] = useState(() => {
    if (!effectiveSrc) return false
    return proxyNeeded.has(effectiveSrc) || isKnownCorpBlocked(effectiveSrc)
  })
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    // Skip direct preload for hosts we know will be CORP-blocked — they'd
    // just generate console noise and never succeed. The <img> below routes
    // them through the proxy.
    if (effectiveSrc && !isKnownCorpBlocked(effectiveSrc)) preloadImage(effectiveSrc)
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
  const displaySrc = useProxy && effectiveSrc ? proxyUrl(effectiveSrc) : effectiveSrc

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
      onLoad={() => setLoaded(true)}
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
