"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { ArrowLeft, Image as ImageIcon, Video, Music, Loader2, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"

const API_BASE = ""

interface GalleryItem {
  readonly id: string
  readonly type: "image" | "video" | "audio"
  readonly jobName: string
  readonly outputUrl: string
  readonly thumbnailUrl: string | null
  readonly createdAt: string
  readonly username: string
  readonly avatarUrl: string | null
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

export default function GalleryPage() {
  const [items, setItems] = useState<readonly GalleryItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<FilterType>("all")
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null)

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  const fetchGallery = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(ITEMS_PER_PAGE),
      })
      if (filter !== "all") {
        params.set("type", filter)
      }

      const response = await fetch(`${API_BASE}/v1/gallery?${params}`)
      if (!response.ok) throw new Error("Failed to fetch gallery")

      const json = (await response.json()) as GalleryResponse
      setItems(json.data)
      setTotal(json.total)
    } catch (err) {
      console.error("Gallery fetch failed:", err)
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, filter])

  useEffect(() => {
    fetchGallery()
  }, [fetchGallery])

  // Reset to page 1 when filter changes
  useEffect(() => {
    setPage(1)
  }, [filter])

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
                <button
                  key={item.id}
                  className="group relative aspect-square rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-card hover:ring-2 hover:ring-[#ff0073]/30 transition-all text-left"
                  onClick={() => setSelectedItem(item)}
                >
                  {item.type === "image" ? (
                    <img
                      src={item.outputUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : item.type === "video" ? (
                    <div className="w-full h-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                      <Video className="h-8 w-8 text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="w-full h-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                      <Music className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}

                  {/* Overlay */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-center justify-between">
                      <span className="text-white text-xs truncate">
                        {item.username}
                      </span>
                      <TypeBadge type={item.type} />
                    </div>
                    <span className="text-white/60 text-xs">
                      {formatDate(item.createdAt)}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground px-3">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Preview Dialog */}
      <Dialog open={selectedItem !== null} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
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
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{selectedItem.username}</span>
                  <TypeBadge type={selectedItem.type} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDate(selectedItem.createdAt)}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
