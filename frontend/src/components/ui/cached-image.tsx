import { useEffect, useRef, useState } from "react"
import { optimizedImageUrl } from "@/lib/image"

// In-memory image cache — keeps decoded images in browser memory
// so <img> elements render synchronously without flash on remount.
const preloaded = new Set<string>()

function preloadImage(src: string) {
  if (!src || preloaded.has(src)) return
  preloaded.add(src)
  const img = new Image()
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

  return (
    <img
      ref={imgRef}
      src={effectiveSrc}
      alt={alt}
      className={className}
      onClick={onClick}
      draggable={draggable}
      onLoad={() => setLoaded(true)}
      onError={onError}
      style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.15s ease-in", ...props.style }}
      {...props}
    />
  )
}
