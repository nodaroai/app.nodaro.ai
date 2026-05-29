import { useEffect, useRef } from "react"

/**
 * Hover-to-play preview video gated by an IntersectionObserver. With
 * `preload="none"`, the src is only attached while the card is near the
 * viewport, so offscreen cards in an infinite-scroll grid never stream video
 * data. When `autoplay` is set, the observer also drives play/pause (so
 * accumulated cards don't all stream at once); otherwise playback is hover-only.
 *
 * Shared by the app + template marketplace cards. Note: the gallery's VideoCard
 * is intentionally NOT consolidated here — it has a different lifecycle
 * (thumbnail crossfade, preload="metadata", debounced preload).
 */
export function PreviewVideo({
  src,
  autoplay = false,
  className = "w-full h-full object-cover",
}: {
  readonly src: string
  readonly autoplay?: boolean
  readonly className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          if (!video.src) video.src = src
          if (autoplay) video.play().catch(() => {})
        } else {
          video.pause()
          video.currentTime = 0
          video.removeAttribute("src")
          video.load()
        }
      },
      { rootMargin: "200px" },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [src, autoplay])

  return (
    <video
      ref={videoRef}
      className={className}
      muted
      loop
      playsInline
      preload="none"
      onMouseEnter={(e) => {
        const v = e.currentTarget
        if (!v.src) v.src = src
        v.play().catch(() => {})
      }}
      onMouseLeave={(e) => {
        if (!autoplay) {
          e.currentTarget.pause()
          e.currentTarget.currentTime = 0
        }
      }}
    />
  )
}
