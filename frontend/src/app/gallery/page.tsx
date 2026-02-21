import { useState, useEffect, useCallback, useRef } from "react"
import { Link, useLocation } from "react-router-dom"
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Maximize2, Minimize2, X, Image as ImageIcon, Video, Music, Loader2, Play, Pause, Copy, Check, Flag, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { CachedImage } from "@/components/ui/cached-image"
import { optimizedImageUrl } from "@/lib/image"
import { ThemeToggle } from "@/components/theme-toggle"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { useGalleryInfinite, useReportGalleryItemMutation, useDeleteGalleryItemMutation } from "@/hooks/queries/use-gallery-queries"
import type { GalleryItem } from "@/hooks/queries/use-gallery-queries"

type FilterType = "all" | "image" | "video" | "audio"

const FILTERS: readonly { readonly value: FilterType; readonly label: string; readonly icon: React.ComponentType<{ className?: string }> | null }[] = [
  { value: "all", label: "All", icon: null },
  { value: "image", label: "Images", icon: ImageIcon },
  { value: "video", label: "Videos", icon: Video },
  { value: "audio", label: "Audio", icon: Music },
]

const VIDEO_EXTENSIONS = /\.(mp4|webm|mov)(\?|$)/i

function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url)
}


const REPORT_REASONS = [
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "copyright", label: "Copyright violation" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
] as const

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffHours < 1) return "Just now"
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function TypeBadge({ type }: { readonly type: "image" | "video" | "audio" }) {
  const config = {
    image: { label: "Image", className: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
    video: { label: "Video", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
    audio: { label: "Audio", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  }
  const { label, className } = config[type]
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {label}
    </span>
  )
}

function AudioCard({ url }: { readonly url: string }) {
  const [playing, setPlaying] = useState(false)
  const [audio] = useState(() => {
    if (typeof window === "undefined") return null
    const a = new Audio(url)
    a.addEventListener("ended", () => setPlaying(false))
    return a
  })

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!audio) return
    if (playing) {
      audio.pause()
      audio.currentTime = 0
      setPlaying(false)
    } else {
      audio.play()
      setPlaying(true)
    }
  }

  useEffect(() => {
    return () => { audio?.pause() }
  }, [audio])

  return (
    <div className="w-full h-full bg-zinc-100 dark:bg-zinc-900 flex flex-col items-center justify-center gap-3">
      {/* Waveform bars */}
      <div className="flex items-end gap-[3px] h-8">
        {[0.4, 0.7, 1, 0.6, 0.85, 0.5, 0.9, 0.35, 0.75, 0.55].map((h, i) => (
          <div
            key={i}
            className={cn(
              "w-1 rounded-full bg-amber-500/60",
              playing && "animate-pulse",
            )}
            style={{ height: `${h * 100}%` }}
          />
        ))}
      </div>
      <button
        onClick={toggle}
        className="rounded-full bg-amber-500/10 p-2 hover:bg-amber-500/20 transition-colors"
        aria-label={playing ? "Pause audio" : "Play audio"}
      >
        {playing ? (
          <Pause className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        ) : (
          <Play className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        )}
      </button>
    </div>
  )
}

function VideoCard({ item, children }: { readonly item: GalleryItem; readonly children?: React.ReactNode }) {
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
            loading="lazy"
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

function CopyPromptButton({ prompt }: { readonly prompt: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    toast.success("Prompt copied to clipboard")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Copy Prompt"}
    </button>
  )
}

export default function GalleryPage() {
  const { user, isAdmin } = useAuth()
  const location = useLocation()
  const isEmbedded = location.pathname.startsWith("/_")
  const [filter, setFilter] = useState<FilterType>("all")
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // React Query hooks
  const { data, isLoading: loading, isFetchingNextPage: loadingMore, hasNextPage: hasMore, fetchNextPage } = useGalleryInfinite(filter)
  const reportMutation = useReportGalleryItemMutation()
  const deleteMutation = useDeleteGalleryItemMutation()

  // Derive flat items list from infinite query pages
  const items: readonly GalleryItem[] = data?.pages.flatMap((p) => p.data) ?? []

  const selectedItem = selectedIndex !== null ? items[selectedIndex] ?? null : null

  // Report dialog state
  const [reportItem, setReportItem] = useState<GalleryItem | null>(null)
  const [reportReason, setReportReason] = useState<string>("inappropriate")
  const [reportDetails, setReportDetails] = useState("")

  // Admin delete confirm state
  const [deleteItem, setDeleteItem] = useState<GalleryItem | null>(null)

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          fetchNextPage()
        }
      },
      { rootMargin: "800px" },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, fetchNextPage])

  async function handleReport() {
    if (!reportItem) return
    try {
      await reportMutation.mutateAsync({
        jobId: reportItem.id,
        reason: reportReason,
        details: reportDetails || undefined,
      })
      toast.success("Report submitted. Thank you!")
      setReportItem(null)
      setReportDetails("")
      setReportReason("inappropriate")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit report")
    }
  }

  async function handleAdminDelete() {
    if (!deleteItem || !user?.id) return
    try {
      await deleteMutation.mutateAsync({ itemId: deleteItem.id, userId: user.id })
      toast.success("Item removed from gallery")
      setDeleteItem(null)
      setSelectedIndex(null)
    } catch {
      toast.error("Failed to remove item from gallery")
    }
  }

  // Lightbox navigation
  const goToPrev = useCallback(() => {
    setReferenceViewIndex(null)
    setSelectedIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))
  }, [])

  const goToNext = useCallback(() => {
    setReferenceViewIndex(null)
    setSelectedIndex((prev) => (prev !== null && prev < items.length - 1 ? prev + 1 : prev))
  }, [items.length])

  // Download handler (backend proxy streams with Content-Disposition: attachment)
  const handleDownload = useCallback(() => {
    if (!selectedItem) return
    window.open(`/v1/download?url=${encodeURIComponent(selectedItem.outputUrl)}`, "_blank")
  }, [selectedItem])

  // Fullscreen (separate overlay div, completely independent of Dialog)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Reference image mini-lightbox
  const [referenceViewIndex, setReferenceViewIndex] = useState<number | null>(null)

  // Touch swipe for mobile navigation
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  // Keyboard navigation: arrows for gallery, ESC exits fullscreen
  useEffect(() => {
    if (selectedIndex === null || referenceViewIndex !== null) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        goToPrev()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        goToNext()
      } else if (e.key === "Escape" && isFullscreen) {
        e.preventDefault()
        e.stopPropagation()
        setIsFullscreen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [selectedIndex, goToPrev, goToNext, isFullscreen, referenceViewIndex])

  function handleTouchStart(e: React.TouchEvent) {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!touchStartRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      if (deltaX > 0) goToPrev()
      else goToNext()
    }
  }

  function openReportDialog(item: GalleryItem, e?: React.MouseEvent) {
    e?.stopPropagation()
    setReportItem(item)
    setReportReason("inappropriate")
    setReportDetails("")
  }

  function openDeleteDialog(item: GalleryItem, e?: React.MouseEvent) {
    e?.stopPropagation()
    setDeleteItem(item)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header — hidden when rendered inside DashboardLayout (/_gallery) */}
      {!isEmbedded && (
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
            <Link
              to="/projects"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to app
            </Link>
            <Link to="/" className="text-lg font-bold text-[#ff0073]">
              SceneNode
            </Link>
            <ThemeToggle />
          </div>
        </header>
      )}

      {/* Hero */}
      <section className="py-12 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Community Gallery
        </h1>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          Explore what people are creating with SceneNode
        </p>
      </section>

      {/* Filter Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-800 p-1 bg-card w-fit mx-auto">
          {FILTERS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5",
                filter === value
                  ? "bg-[#ff0073] text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setFilter(value)}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Gallery Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <p className="text-lg">No items yet</p>
            <p className="text-sm mt-1">Be the first to create something!</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {items.map((item, index) => {
                const overlay = (
                  <>
                    {/* Overlay */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8 opacity-0 group-hover:opacity-100 transition-opacity z-[3]">
                      <div className="flex items-center justify-between">
                        <TypeBadge type={item.type} />
                        <span className="text-white/60 text-xs">
                          {formatDate(item.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons (top-right corner on hover) */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-[3]">
                      <button
                        onClick={(e) => openReportDialog(item, e)}
                        className="rounded-full bg-black/50 p-1.5 hover:bg-black/70 transition-colors"
                        title="Report"
                      >
                        <Flag className="h-3.5 w-3.5 text-white" />
                      </button>
                      {isAdmin && (
                        <button
                          onClick={(e) => openDeleteDialog(item, e)}
                          className="rounded-full bg-red-500/70 p-1.5 hover:bg-red-500/90 transition-colors"
                          title="Remove from gallery"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-white" />
                        </button>
                      )}
                    </div>
                  </>
                )

                return (
                  <div
                    key={`${item.id}-${index}`}
                    role="button"
                    tabIndex={0}
                    className="group relative aspect-square rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-card hover:ring-2 hover:ring-[#ff0073]/30 transition-all cursor-pointer"
                    style={{ contentVisibility: "auto", containIntrinsicSize: "auto 200px" }}
                    onClick={() => { setReferenceViewIndex(null); setSelectedIndex(index) }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setReferenceViewIndex(null); setSelectedIndex(index) } }}
                  >
                    {item.type === "image" ? (
                      <>
                        <CachedImage
                          src={item.outputUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                          thumbnail
                        />
                        {overlay}
                      </>
                    ) : item.type === "video" ? (
                      <VideoCard item={item}>{overlay}</VideoCard>
                    ) : (
                      <>
                        <AudioCard url={item.outputUrl} />
                        {overlay}
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Skeleton placeholders while loading next page */}
            {loadingMore && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mt-4">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div
                    key={`skeleton-${i}`}
                    className="aspect-square rounded-lg bg-zinc-200 dark:bg-zinc-800 animate-pulse"
                  />
                ))}
              </div>
            )}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-1" />

            {!hasMore && items.length > 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                You've reached the end
              </p>
            )}
          </>
        )}
      </section>

      {/* Preview Dialog — full-screen on mobile, centered card on desktop */}
      <Dialog open={selectedIndex !== null && !isFullscreen} onOpenChange={(open) => { if (!open) { setSelectedIndex(null); setReferenceViewIndex(null) } }}>
        <DialogContent
          showCloseButton={false}
          className="p-0 overflow-hidden gap-0 top-0 left-0 translate-x-0 translate-y-0 max-w-full h-[100dvh] w-full rounded-none border-0 sm:top-[50%] sm:left-[50%] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-3xl sm:h-auto sm:rounded-lg sm:border"
        >
          <DialogTitle className="sr-only">Preview</DialogTitle>
          {selectedItem && selectedIndex !== null && (
            <div className="flex flex-col h-full sm:h-auto">
              {/* Media section with swipe support */}
              <div
                className="relative bg-black flex items-center justify-center flex-1 min-h-0 sm:flex-none sm:min-h-[300px] sm:max-h-[70vh]"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {selectedItem.type === "image" ? (
                  <CachedImage src={selectedItem.outputUrl} alt="" className="max-w-full max-h-full object-contain" />
                ) : selectedItem.type === "video" ? (
                  <video key={selectedItem.id} src={selectedItem.outputUrl} controls autoPlay playsInline className="max-w-full max-h-full" />
                ) : (
                  <div className="p-8 w-full">
                    <audio key={selectedItem.id} src={selectedItem.outputUrl} controls autoPlay className="w-full" />
                  </div>
                )}

                {/* Left arrow */}
                {selectedIndex > 0 && (
                  <button onClick={goToPrev} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 hover:bg-black/70 p-2.5 transition-colors z-10" aria-label="Previous">
                    <ChevronLeft className="h-6 w-6 text-white" />
                  </button>
                )}

                {/* Right arrow */}
                {selectedIndex < items.length - 1 && (
                  <button onClick={goToNext} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 hover:bg-black/70 p-2.5 transition-colors z-10" aria-label="Next">
                    <ChevronRight className="h-6 w-6 text-white" />
                  </button>
                )}

                {/* Top-right buttons: download, fullscreen, close */}
                <div className="absolute top-2 right-2 flex gap-2 z-10">
                  <button onClick={handleDownload} className="rounded-full bg-black/50 hover:bg-black/70 p-2 transition-colors" aria-label="Download">
                    <Download className="h-4 w-4 text-white" />
                  </button>
                  <button onClick={() => setIsFullscreen(true)} className="rounded-full bg-black/50 hover:bg-black/70 p-2 transition-colors" aria-label="Fullscreen">
                    <Maximize2 className="h-4 w-4 text-white" />
                  </button>
                  <button onClick={() => { setSelectedIndex(null); setReferenceViewIndex(null) }} className="rounded-full bg-black/50 hover:bg-black/70 p-2 transition-colors" aria-label="Close">
                    <X className="h-4 w-4 text-white" />
                  </button>
                </div>

                {/* Position indicator */}
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80 font-medium z-10">
                  {selectedIndex + 1} / {items.length}
                </span>
              </div>

              {/* Info section — scrollable on mobile, static on desktop */}
              <div className="flex-shrink-0 max-h-[40dvh] sm:max-h-none overflow-y-auto p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <TypeBadge type={selectedItem.type} />
                    {selectedItem.model && (
                      <span className="text-xs text-muted-foreground bg-zinc-100 dark:bg-zinc-800 rounded px-2 py-0.5">
                        {selectedItem.model}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openReportDialog(selectedItem)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      title="Report"
                    >
                      <Flag className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Report</span>
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => openDeleteDialog(selectedItem)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-300 dark:border-red-800 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="Remove from gallery"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Remove</span>
                      </button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatDate(selectedItem.createdAt)}
                    </span>
                  </div>
                </div>

                {(selectedItem.referenceImages ?? []).length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      References
                    </span>
                    <div className="flex items-center">
                      {(selectedItem.referenceImages ?? []).slice(0, 4).map((url, i) => (
                        <button
                          key={i}
                          onClick={() => setReferenceViewIndex(i)}
                          className="block rounded-full border-2 border-background dark:border-zinc-900 hover:scale-110 hover:z-10 transition-transform relative cursor-pointer"
                          style={{ marginLeft: i > 0 ? "-0.5rem" : 0, zIndex: 4 - i }}
                        >
                          {isVideoUrl(url) ? (
                            <video
                              src={url}
                              muted
                              playsInline
                              preload="metadata"
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <CachedImage
                              src={url}
                              alt={`Reference ${i + 1}`}
                              className="w-10 h-10 rounded-full object-cover"
                              thumbnail
                              thumbnailWidth={80}
                            />
                          )}
                        </button>
                      ))}
                      {(selectedItem.referenceImages ?? []).length > 4 && (
                        <button
                          onClick={() => setReferenceViewIndex(4)}
                          className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 border-2 border-background dark:border-zinc-900 text-xs font-medium text-muted-foreground relative cursor-pointer hover:scale-110 hover:z-10 transition-transform"
                          style={{ marginLeft: "-0.5rem", zIndex: 0 }}
                        >
                          +{(selectedItem.referenceImages ?? []).length - 4}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {selectedItem.prompt && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Prompt
                      </span>
                      <CopyPromptButton prompt={selectedItem.prompt} />
                    </div>
                    <p className="text-sm text-foreground leading-relaxed bg-zinc-50 dark:bg-zinc-900 rounded-md p-3 border border-zinc-200 dark:border-zinc-800">
                      {selectedItem.prompt}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Fullscreen overlay (completely separate from Dialog) */}
      {isFullscreen && selectedItem && selectedIndex !== null && (
        <div
          className="fixed inset-0 z-[9999] bg-black flex items-center justify-center"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {selectedItem.type === "image" ? (
            <CachedImage src={selectedItem.outputUrl} alt="" className="max-w-full max-h-full object-contain" />
          ) : selectedItem.type === "video" ? (
            <video key={selectedItem.id} src={selectedItem.outputUrl} controls autoPlay playsInline className="max-w-full max-h-full" />
          ) : (
            <audio key={selectedItem.id} src={selectedItem.outputUrl} controls autoPlay />
          )}

          {/* Left arrow */}
          {selectedIndex > 0 && (
            <button onClick={goToPrev} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 p-3 transition-colors" aria-label="Previous">
              <ChevronLeft className="h-7 w-7 text-white" />
            </button>
          )}

          {/* Right arrow */}
          {selectedIndex < items.length - 1 && (
            <button onClick={goToNext} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 p-3 transition-colors" aria-label="Next">
              <ChevronRight className="h-7 w-7 text-white" />
            </button>
          )}

          {/* Top-right buttons: download, minimize (back to dialog), close (back to gallery) */}
          <div className="absolute top-4 right-4 flex gap-2">
            <button onClick={handleDownload} className="rounded-full bg-white/10 hover:bg-white/20 p-2.5 transition-colors" aria-label="Download">
              <Download className="h-5 w-5 text-white" />
            </button>
            <button onClick={() => setIsFullscreen(false)} className="rounded-full bg-white/10 hover:bg-white/20 p-2.5 transition-colors" aria-label="Exit fullscreen">
              <Minimize2 className="h-5 w-5 text-white" />
            </button>
            <button onClick={() => { setIsFullscreen(false); setSelectedIndex(null); setReferenceViewIndex(null) }} className="rounded-full bg-white/10 hover:bg-white/20 p-2.5 transition-colors" aria-label="Close">
              <X className="h-5 w-5 text-white" />
            </button>
          </div>

          {/* Position indicator */}
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 font-medium">
            {selectedIndex + 1} / {items.length}
          </span>
        </div>
      )}

      {/* Reference image viewer Dialog */}
      <Dialog open={referenceViewIndex !== null} onOpenChange={() => setReferenceViewIndex(null)}>
        <DialogContent
          showCloseButton={false}
          className="p-0 overflow-hidden sm:max-w-lg bg-black border-zinc-800"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" && referenceViewIndex !== null && referenceViewIndex > 0) {
              e.preventDefault()
              setReferenceViewIndex(referenceViewIndex - 1)
            } else if (e.key === "ArrowRight" && referenceViewIndex !== null && selectedItem && referenceViewIndex < (selectedItem.referenceImages ?? []).length - 1) {
              e.preventDefault()
              setReferenceViewIndex(referenceViewIndex + 1)
            }
          }}
        >
          <DialogTitle className="sr-only">Reference</DialogTitle>
          {referenceViewIndex !== null && selectedItem && (selectedItem.referenceImages ?? []).length > 0 && (
            <div className="relative flex items-center justify-center min-h-[200px]">
              {isVideoUrl((selectedItem.referenceImages ?? [])[referenceViewIndex] ?? "") ? (
                <video
                  key={referenceViewIndex}
                  src={(selectedItem.referenceImages ?? [])[referenceViewIndex]}
                  controls
                  autoPlay
                  className="max-w-full max-h-[60vh] object-contain"
                />
              ) : (
                <CachedImage
                  src={(selectedItem.referenceImages ?? [])[referenceViewIndex]}
                  alt={`Reference ${referenceViewIndex + 1}`}
                  className="max-w-full max-h-[60vh] object-contain"
                />
              )}

              {/* Left arrow */}
              {referenceViewIndex > 0 && (
                <button
                  onClick={() => setReferenceViewIndex(referenceViewIndex - 1)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 hover:bg-black/70 p-2 transition-colors"
                  aria-label="Previous reference"
                >
                  <ChevronLeft className="h-5 w-5 text-white" />
                </button>
              )}

              {/* Right arrow */}
              {referenceViewIndex < (selectedItem.referenceImages ?? []).length - 1 && (
                <button
                  onClick={() => setReferenceViewIndex(referenceViewIndex + 1)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 hover:bg-black/70 p-2 transition-colors"
                  aria-label="Next reference"
                >
                  <ChevronRight className="h-5 w-5 text-white" />
                </button>
              )}

              {/* Position indicator */}
              {(selectedItem.referenceImages ?? []).length > 1 && (
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80 font-medium">
                  {referenceViewIndex + 1} / {(selectedItem.referenceImages ?? []).length}
                </span>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Report Dialog */}
      <Dialog open={reportItem !== null} onOpenChange={(open) => !open && setReportItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Report Content</DialogTitle>
          {reportItem && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Why are you reporting this item?
              </p>

              <div className="space-y-2">
                {REPORT_REASONS.map(({ value, label }) => (
                  <label
                    key={value}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors",
                      reportReason === value
                        ? "border-[#ff0073] bg-[#ff0073]/5"
                        : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900",
                    )}
                  >
                    <input
                      type="radio"
                      name="report-reason"
                      value={value}
                      checked={reportReason === value}
                      onChange={() => setReportReason(value)}
                      className="accent-[#ff0073]"
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>

              <textarea
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Additional details (optional)"
                maxLength={1000}
                rows={3}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#ff0073]/30 resize-none"
              />

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReportItem(null)}
                  disabled={reportMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleReport}
                  disabled={reportMutation.isPending}
                  className="bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
                >
                  {reportMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Submit Report"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Admin Delete Confirmation Dialog */}
      <Dialog open={deleteItem !== null} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>Remove from Gallery</DialogTitle>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will hide the item from the public gallery. The original job and files will not be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteItem(null)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAdminDelete}
                disabled={deleteMutation.isPending}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Remove"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
