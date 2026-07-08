import { useEffect, useRef } from "react"
import { optimizedImageUrl } from "@/lib/image"

/**
 * Hover-to-play preview video gated by an IntersectionObserver. A still frame is
 * ALWAYS visible (the card is never blank until hover):
 *   - With `poster`, that image is shown until the video actually plays.
 *   - Without `poster`, `preload="metadata"` makes the browser paint the video's
 *     own first frame — the same frame the gallery's ffmpeg poster (`-ss 0`)
 *     uses, so the two surfaces look identical.
 *
 * The src is only attached while the card is near the viewport, so offscreen
 * cards in an infinite-scroll grid never keep streaming. When `autoplay` is set,
 * the observer also drives play/pause (so accumulated cards don't all stream at
 * once); otherwise playback is hover-only.
 *
 * Shared by the app + template marketplace cards and the dashboard carousels.
 * Note: the gallery's VideoCard is intentionally NOT consolidated here — it has
 * a richer lifecycle (thumbnail crossfade, debounced preload, offscreen unload).
 */
export function PreviewVideo({
  src,
  poster,
  autoplay = false,
  className = "w-full h-full object-cover",
}: {
  readonly src: string
  /** Optional still-frame poster URL, shown until the video plays. Our CDN
   *  origins are transcoded/resized via `optimizedImageUrl`; other hosts pass
   *  through untouched. */
  readonly poster?: string
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
      preload="metadata"
      poster={poster ? optimizedImageUrl(poster, { width: 768, quality: 90 }) : undefined}
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
