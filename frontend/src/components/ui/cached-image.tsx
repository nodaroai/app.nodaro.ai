import { useEffect, useRef, useState } from "react"

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
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(() => preloaded.has(src ?? ""))
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (src) preloadImage(src)
  }, [src])

  // Check if already complete (memory cache hit)
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true)
    }
  }, [src])

  return (
    <img
      ref={imgRef}
      src={src}
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
