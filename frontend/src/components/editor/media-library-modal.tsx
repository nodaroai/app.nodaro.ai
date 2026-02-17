import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import {
  X,
  Search,
  Image as ImageIcon,
  Video,
  Music,
  Trash2,
  Download,
  Loader2,
  FileQuestion,
  Globe,
  Plus,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import {
  useLibraryInfinite,
  useDeleteLibraryAssetMutation,
} from "@/hooks/queries/use-assets-queries"
import {
  promoteToLibrary,
  demoteFromLibrary,
  type LibraryAsset,
} from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"

// ============================================================
// Types
// ============================================================

interface MediaLibraryModalProps {
  open: boolean
  onClose: () => void
  onAddToCanvas?: (asset: LibraryAsset) => void
}

type FilterType = "all" | "image" | "video" | "audio"

const FILTER_OPTIONS: ReadonlyArray<{ value: FilterType; label: string }> = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
]

// ============================================================
// Helpers
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function typeBadgeColor(type: string): string {
  switch (type) {
    case "image":
      return "bg-blue-500/20 text-blue-400"
    case "video":
      return "bg-purple-500/20 text-purple-400"
    case "audio":
      return "bg-amber-500/20 text-amber-400"
    default:
      return "bg-gray-500/20 text-gray-400"
  }
}

function typeIcon(type: string) {
  switch (type) {
    case "image":
      return <ImageIcon className="w-5 h-5 text-blue-400" />
    case "video":
      return <Video className="w-5 h-5 text-purple-400" />
    case "audio":
      return <Music className="w-5 h-5 text-amber-400" />
    default:
      return <FileQuestion className="w-5 h-5 text-gray-400" />
  }
}

// ============================================================
// Component
// ============================================================

export function MediaLibraryModal({ open, onClose, onAddToCanvas }: MediaLibraryModalProps) {
  const { user, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [filterType, setFilterType] = useState<FilterType>("all")
  const [searchText, setSearchText] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [previewAsset, setPreviewAsset] = useState<LibraryAsset | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const {
    data,
    isLoading: loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: loadingMore,
  } = useLibraryInfinite({
    userId: user?.id,
    type: filterType !== "all" ? filterType : undefined,
    search: debouncedSearch || undefined,
    limit: 40,
  })

  const assets = data?.pages.flatMap((p) => p.data) ?? []
  const deleteMutation = useDeleteLibraryAssetMutation()

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 300)
    return () => clearTimeout(timer)
  }, [searchText])

  // Focus search on open
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 100)
    }
  }, [open])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  const handleDelete = async (asset: LibraryAsset) => {
    if (!user?.id) return

    setDeletingId(asset.id)
    try {
      await deleteMutation.mutateAsync({ assetId: asset.id, userId: user.id })
      setConfirmDeleteId(null)
    } catch (err) {
      console.error("[media-library] Delete failed:", err)
    } finally {
      setDeletingId(null)
    }
  }

  const handleDownload = (asset: LibraryAsset) => {
    const a = document.createElement("a")
    a.href = asset.url
    a.download = asset.filename
    a.target = "_blank"
    a.rel = "noopener noreferrer"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handlePromote = async (asset: LibraryAsset) => {
    if (!user?.id) return
    try {
      await promoteToLibrary(asset.id, user.id)
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all })
    } catch (err) {
      console.error("[media-library] Promote failed:", err)
    }
  }

  const handleDemote = async (asset: LibraryAsset) => {
    if (!user?.id) return
    try {
      await demoteFromLibrary(asset.id, user.id)
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all })
    } catch (err) {
      console.error("[media-library] Demote failed:", err)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-4xl max-h-[85vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#ff0073]/10 flex items-center justify-center">
              <ImageIcon className="w-4 h-4 text-[#ff0073]" />
            </div>
            <h2 className="text-base font-semibold">Media Library</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + Filters */}
        <div className="px-5 py-3 border-b border-border space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <input
              ref={searchRef}
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by filename..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted/30 border border-border rounded-lg outline-none focus:border-[#ff0073]/50 transition-colors placeholder:text-muted-foreground/40"
            />
          </div>

          {/* Type filter pills */}
          <div className="flex gap-1.5">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilterType(opt.value)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                  filterType === opt.value
                    ? "bg-[#ff0073] text-white"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading assets...</p>
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <FileQuestion className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No files found</p>
              <p className="text-xs text-muted-foreground/60">
                Upload files via Upload Image, Video, or Audio nodes
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {assets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    isAdmin={isAdmin}
                    isDeleting={deletingId === asset.id}
                    isConfirmingDelete={confirmDeleteId === asset.id}
                    onDelete={() => handleDelete(asset)}
                    onConfirmDelete={() => setConfirmDeleteId(asset.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    onDownload={() => handleDownload(asset)}
                    onAddToCanvas={onAddToCanvas ? () => onAddToCanvas(asset) : undefined}
                    onPromote={() => handlePromote(asset)}
                    onDemote={() => handleDemote(asset)}
                    onPreview={() => setPreviewAsset(asset)}
                  />
                ))}
              </div>

              {/* Load more */}
              {hasNextPage && (
                <div className="flex justify-center mt-4">
                  <button
                    type="button"
                    onClick={() => fetchNextPage()}
                    disabled={loadingMore}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Loading...
                      </span>
                    ) : (
                      "Load More"
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground/60">
            {assets.length} file{assets.length !== 1 ? "s" : ""}
          </p>
          <p className="text-xs text-muted-foreground/40">
            Ctrl+M to toggle
          </p>
        </div>
      </div>
      {previewAsset && (previewAsset.type === "image" || previewAsset.type === "video") && (
        <MediaPreviewModal
          isOpen={Boolean(previewAsset)}
          onClose={() => setPreviewAsset(null)}
          type={previewAsset.type as "image" | "video"}
          url={previewAsset.url}
        />
      )}
    </div>,
    document.body,
  )
}

// ============================================================
// Asset Card
// ============================================================

interface AssetCardProps {
  asset: LibraryAsset
  isAdmin: boolean
  isDeleting: boolean
  isConfirmingDelete: boolean
  onDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onDownload: () => void
  onAddToCanvas?: () => void
  onPromote: () => void
  onDemote: () => void
  onPreview: () => void
}

function AssetCard({
  asset,
  isAdmin,
  isDeleting,
  isConfirmingDelete,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onDownload,
  onAddToCanvas,
  onPromote,
  onDemote,
  onPreview,
}: AssetCardProps) {
  return (
    <div className="group relative rounded-lg border border-border bg-muted/20 overflow-hidden hover:border-[#ff0073]/30 transition-colors">
      {/* Thumbnail area */}
      <div
        className="aspect-square bg-muted/30 flex items-center justify-center relative overflow-hidden cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          if ((asset.type === "image" || asset.type === "video") && asset.url) {
            onPreview()
          }
        }}
      >
        {asset.type === "image" && asset.thumbnailUrl ? (
          <img
            src={asset.thumbnailUrl}
            alt={asset.filename}
            className="w-full h-full object-cover"
          />
        ) : asset.type === "image" && asset.url ? (
          <img
            src={asset.url}
            alt={asset.filename}
            className="w-full h-full object-cover"
          />
        ) : asset.type === "video" && asset.thumbnailUrl ? (
          <div className="relative w-full h-full">
            <img
              src={asset.thumbnailUrl}
              alt={asset.filename}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                <Video className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>
        ) : asset.type === "video" && asset.url ? (
          <div className="relative w-full h-full">
            <video
              src={asset.url}
              preload="metadata"
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                <Video className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>
        ) : (
          typeIcon(asset.type)
        )}

        {/* Type badge */}
        <span
          className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded ${typeBadgeColor(asset.type)}`}
        >
          {asset.type}
        </span>

        {/* Shared library badge */}
        {asset.isLibraryItem && (
          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-[#ff0073]/20 text-[#ff0073] flex items-center gap-0.5">
            <Globe className="w-3 h-3" />
            Shared
          </span>
        )}

        {/* Hover actions overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {onAddToCanvas && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onAddToCanvas()
              }}
              className="w-8 h-8 rounded-lg bg-[#ff0073]/80 hover:bg-[#ff0073] flex items-center justify-center text-white transition-colors"
              title="Add to canvas"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDownload()
            }}
            className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </button>
          {isConfirmingDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
                disabled={isDeleting}
                className="px-2 py-1 text-[10px] font-medium rounded bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {isDeleting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  "Delete"
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCancelDelete()
                }}
                className="px-2 py-1 text-[10px] font-medium rounded bg-white/20 text-white hover:bg-white/30 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onConfirmDelete()
              }}
              className="w-8 h-8 rounded-lg bg-white/20 hover:bg-red-500/80 flex items-center justify-center text-white transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="px-2.5 py-2">
        <p className="text-xs text-foreground truncate" title={asset.filename}>
          {asset.filename}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground/60">
            {formatBytes(asset.sizeBytes)}
          </span>
          <span className="text-[10px] text-muted-foreground/40">
            {formatDate(asset.createdAt)}
          </span>
        </div>

        {/* Admin: Promote / Demote */}
        {isAdmin && (
          <div className="mt-1.5">
            {asset.isLibraryItem ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDemote()
                }}
                className="w-full px-2 py-1 text-[10px] font-medium rounded bg-muted/50 hover:bg-muted text-muted-foreground flex items-center justify-center gap-1 transition-colors"
              >
                <Globe className="w-3 h-3" />
                Remove from Shared
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onPromote()
                }}
                className="w-full px-2 py-1 text-[10px] font-medium rounded bg-[#ff0073]/10 hover:bg-[#ff0073]/20 text-[#ff0073] flex items-center justify-center gap-1 transition-colors"
              >
                <Globe className="w-3 h-3" />
                Add to Shared Library
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
