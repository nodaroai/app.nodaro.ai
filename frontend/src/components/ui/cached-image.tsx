import { useEffect, useRef, useState } from "react"
import { optimizedImageUrl } from "@/lib/image"

// In-memory image cache — keeps decoded images in browser memory
// so <img> elements render synchronously without flash on remount.
const preloaded = new Set<string>()

/** Track URLs that failed direct load and need proxy. */
const proxyNeeded = new Set<string>()

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
  const [useProxy, setUseProxy] = useState(() => effectiveSrc ? proxyNeeded.has(effectiveSrc) : false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (effectiveSrc) preloadImage(effectiveSrc)
  }, [effectiveSrc])

  // Check if already complete (memory cache hit)
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true)
    }
  }, [effectiveSrc])

  // Reset proxy state when src changes
  useEffect(() => {
    setUseProxy(effectiveSrc ? proxyNeeded.has(effectiveSrc) : false)
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
