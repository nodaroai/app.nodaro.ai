import { useState, useEffect, useRef } from "react"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"
import { CachedImage } from "@/components/ui/cached-image"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { optimizedImageUrl } from "@/lib/image"
import type { GalleryItem } from "@/hooks/queries/use-gallery-queries"
import { useT, tx, type MessageKey } from "@/lib/i18n"
import { uiLocale } from "@/lib/i18n/format"

export const TYPE_LABEL_KEY: Record<"image" | "video" | "audio", MessageKey> = {
  image: "common.image",
  video: "common.video",
  audio: "out.audio",
}

export function formatGalleryDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffHours < 1) return tx("time.justNow")
  if (diffHours < 24) return tx("time.hrAgo", { n: diffHours })
  if (diffDays < 7) return tx("time.dayAgo", { n: diffDays })
  return date.toLocaleDateString(uiLocale(), { month: "short", day: "numeric" })
}

export function TypeBadge({ type }: { readonly type: "image" | "video" | "audio" }) {
  const t = useT()
  const config = {
    image: { className: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
    video: { className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
    audio: { className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  }
  const { className } = config[type]
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {t(TYPE_LABEL_KEY[type])}
    </span>
  )
}

export function AudioCard({ url }: { readonly url: string }) {
  // The real waveform player in the grid cell. Clicks on the player itself
  // play/seek (stopPropagation) without opening the preview; clicking the
  // surrounding cell still opens it. Only one player plays at a time app-wide.
  return (
    <div className="w-full h-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center p-3">
      <div
        className="w-full"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <WaveformAudioPlayer url={url} variant="mini" className="w-full" />
      </div>
    </div>
  )
}

export function VideoCard({ item, children, priority }: { readonly item: GalleryItem; readonly children?: React.ReactNode; readonly priority?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasThumbnail = !!item.thumbnailUrl

  // Preload video when card scrolls into view (debounced), unload when it leaves
  useEffect(() => {
    const container = containerRef.current
    const video = videoRef.current
    if (!container || !video) return

    let preloadTimer: ReturnType<typeof setTimeout> | null = null

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          // Debounce: only preload if card stays visible for 300ms (skip during fast scroll)
          preloadTimer = setTimeout(() => {
            if (!video.src || video.src === "") {
              video.src = item.outputUrl
            }
            video.preload = "metadata"
            video.load()
          }, 300)
        } else {
          // Cancel pending preload if user scrolled past quickly
          if (preloadTimer) {
            clearTimeout(preloadTimer)
            preloadTimer = null
          }
          // Out of view — stop buffering to free memory
          video.pause()
          video.currentTime = 0
          video.preload = "none"
          video.removeAttribute("src")
          video.load()
          setVideoReady(false)
          setHovered(false)
        }
      },
      { rootMargin: "200px" },
    )
    observer.observe(container)
    return () => {
      if (preloadTimer) clearTimeout(preloadTimer)
      observer.disconnect()
    }
  }, [])

  function handleMouseEnter() {
    setHovered(true)
    const video = videoRef.current
    if (!video) return
    // Restore src if it was cleared when out of view
    if (!video.src || video.src === "") {
      video.src = item.outputUrl
      video.preload = "auto"
    }
    video.play().catch(() => {})
  }

  function handleMouseLeave() {
    const video = videoRef.current
    if (video) {
      video.pause()
      video.currentTime = 0
    }
    setVideoReady(false)
    setHovered(false)
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {hasThumbnail ? (
        <>
          {/* Thumbnail stays visible until video is actually playing */}
          <CachedImage
            src={optimizedImageUrl(item.thumbnailUrl!, { width: 768, quality: 90 })}
            alt=""
            className={cn(
              "w-full h-full object-cover absolute inset-0 z-[1]",
              hovered && videoReady && "invisible",
            )}
            {...(priority ? { fetchPriority: "high" } : { loading: "lazy" })}
          />
          <video
            ref={videoRef}
            src={item.outputUrl}
            muted
            loop
            playsInline
            preload="none"
            onPlaying={() => setVideoReady(true)}
            className="w-full h-full object-cover absolute inset-0"
          />
        </>
      ) : (
        <video
          ref={videoRef}
          src={item.outputUrl}
          muted
          loop
          playsInline
          preload="metadata"
          onPlaying={() => setVideoReady(true)}
          className="w-full h-full object-cover"
        />
      )}
      {/* Play icon hint */}
      {!hovered && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[2]">
          <div className="rounded-full bg-black/40 p-2">
            <Play className="h-4 w-4 text-white fill-white" />
          </div>
        </div>
      )}
      {children}
    </div>
  )
}
