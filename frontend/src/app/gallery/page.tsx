"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { ArrowLeft, Image as ImageIcon, Video, Music, Loader2, Play, Pause, Copy, Check, Flag, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/theme-toggle"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"

const API_BASE = ""

interface GalleryItem {
  readonly id: string
  readonly type: "image" | "video" | "audio"
  readonly jobName: string
  readonly outputUrl: string
  readonly thumbnailUrl: string | null
  readonly createdAt: string
  readonly prompt: string | null
  readonly model: string | null
}

interface GalleryResponse {
  readonly data: readonly GalleryItem[]
  readonly total: number
  readonly page: number
  readonly limit: number
}

type FilterType = "all" | "image" | "video" | "audio"

const FILTERS: readonly { readonly value: FilterType; readonly label: string; readonly icon: React.ComponentType<{ className?: string }> | null }[] = [
  { value: "all", label: "All", icon: null },
  { value: "image", label: "Images", icon: ImageIcon },
  { value: "video", label: "Videos", icon: Video },
  { value: "audio", label: "Audio", icon: Music },
]

const ITEMS_PER_PAGE = 20

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
  const [items, setItems] = useState<readonly GalleryItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<FilterType>("all")
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const hasMore = items.length < total

  // Report dialog state
  const [reportItem, setReportItem] = useState<GalleryItem | null>(null)
  const [reportReason, setReportReason] = useState<string>("inappropriate")
  const [reportDetails, setReportDetails] = useState("")
  const [reportSubmitting, setReportSubmitting] = useState(false)

  // Admin delete confirm state
  const [deleteItem, setDeleteItem] = useState<GalleryItem | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  const fetchGallery = useCallback(async (pageNum: number, append: boolean) => {
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: String(ITEMS_PER_PAGE),
      })
      if (filter !== "all") {
        params.set("type", filter)
      }

      const response = await fetch(`${API_BASE}/v1/gallery?${params}`)
      if (!response.ok) throw new Error("Failed to fetch gallery")

      const json = (await response.json()) as GalleryResponse
      if (append) {
        setItems((prev) => [...prev, ...json.data])
      } else {
        setItems(json.data)
      }
      setTotal(json.total)
    } catch (err) {
      console.error("Gallery fetch failed:", err)
      if (!append) {
        setItems([])
        setTotal(0)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filter])

  // Initial load
  useEffect(() => {
    setPage(1)
    fetchGallery(1, false)
  }, [fetchGallery])

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          const nextPage = page + 1
          setPage(nextPage)
          fetchGallery(nextPage, true)
        }
      },
      { rootMargin: "200px" },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, page, fetchGallery])

  async function handleReport() {
    if (!reportItem) return
    setReportSubmitting(true)
    try {
      const response = await fetch(`${API_BASE}/v1/gallery/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: reportItem.id,
          reason: reportReason,
          details: reportDetails || undefined,
        }),
      })

      if (response.status === 429) {
        toast.error("You already reported this item recently")
        return
      }

      if (!response.ok) throw new Error("Failed to submit report")

      toast.success("Report submitted. Thank you!")
      setReportItem(null)
      setReportDetails("")
      setReportReason("inappropriate")
    } catch {
      toast.error("Failed to submit report")
    } finally {
      setReportSubmitting(false)
    }
  }

  async function handleAdminDelete() {
    if (!deleteItem || !user?.id) return
    setDeleteSubmitting(true)
    try {
      const response = await fetch(`${API_BASE}/v1/gallery/${deleteItem.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      })

      if (!response.ok) throw new Error("Failed to remove item")

      toast.success("Item removed from gallery")
      setItems((prev) => prev.filter((i) => i.id !== deleteItem.id))
      setDeleteItem(null)
      setSelectedItem(null)
    } catch {
      toast.error("Failed to remove item from gallery")
    } finally {
      setDeleteSubmitting(false)
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
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link
            href="/projects"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to app
          </Link>
          <Link href="/" className="text-lg font-bold text-[#ff0073]">
            SceneNode
          </Link>
          <ThemeToggle />
        </div>
      </header>

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
              {items.map((item) => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className="group relative aspect-square rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-card hover:ring-2 hover:ring-[#ff0073]/30 transition-all cursor-pointer"
                  onClick={() => setSelectedItem(item)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedItem(item) }}
                >
                  {item.type === "image" ? (
                    <img
                      src={item.outputUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : item.type === "video" ? (
                    <video
                      src={item.outputUrl}
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover"
                      onMouseEnter={(e) => { e.currentTarget.play().catch(() => {}) }}
                      onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
                    />
                  ) : (
                    <AudioCard url={item.outputUrl} />
                  )}

                  {/* Overlay */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-center justify-between">
                      <TypeBadge type={item.type} />
                      <span className="text-white/60 text-xs">
                        {formatDate(item.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons (top-right corner on hover) */}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                </div>
              ))}
            </div>

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-1" />

            {loadingMore && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!hasMore && items.length > 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                You've reached the end
              </p>
            )}
          </>
        )}
      </section>

      {/* Preview Dialog */}
      <Dialog open={selectedItem !== null} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">Preview</DialogTitle>
          {selectedItem && (
            <div>
              {/* Preview */}
              <div className="bg-black flex items-center justify-center min-h-[300px] max-h-[70vh]">
                {selectedItem.type === "image" ? (
                  <img
                    src={selectedItem.outputUrl}
                    alt=""
                    className="max-w-full max-h-[70vh] object-contain"
                  />
                ) : selectedItem.type === "video" ? (
                  <video
                    src={selectedItem.outputUrl}
                    controls
                    autoPlay
                    className="max-w-full max-h-[70vh]"
                  />
                ) : (
                  <div className="p-8">
                    <audio src={selectedItem.outputUrl} controls autoPlay className="w-full" />
                  </div>
                )}
              </div>

              {/* Meta */}
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
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
                      Report
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => openDeleteDialog(selectedItem)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-300 dark:border-red-800 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="Remove from gallery"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatDate(selectedItem.createdAt)}
                    </span>
                  </div>
                </div>

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
                  disabled={reportSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleReport}
                  disabled={reportSubmitting}
                  className="bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
                >
                  {reportSubmitting ? (
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
                disabled={deleteSubmitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAdminDelete}
                disabled={deleteSubmitting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteSubmitting ? (
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
