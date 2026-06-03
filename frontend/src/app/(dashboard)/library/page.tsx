import { useCallback, useEffect, useMemo, useState, memo } from "react"
import { Link } from "react-router-dom"
import {
  HardDrive,
  Trash2,
  Loader2,
  ImageIcon,
  Film,
  Music,
  Play,
  ArrowUpRight,
  FolderOpen,
  CheckSquare,
  Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import {
  useLibraryInfinite,
  useDeleteLibraryAssetMutation,
} from "@/hooks/queries/use-assets-queries"
import { useStorageProfile } from "@/ee/hooks/queries/use-billing-queries"
import { CachedImage } from "@/components/ui/cached-image"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { useBackToClose } from "@/hooks/use-back-to-close"
import { useVirtualGrid, rowItems, GRID_BREAKPOINTS } from "@/hooks/use-virtual-grid"
import type { LibraryAsset } from "@/lib/api"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

const TYPE_FILTERS = ["all", "image", "video", "audio"] as const
type TypeFilter = (typeof TYPE_FILTERS)[number]

function TypeIcon({ type }: { type: string }) {
  if (type === "image") return <ImageIcon className="h-4 w-4 text-blue-400" />
  if (type === "video") return <Film className="h-4 w-4 text-purple-400" />
  return <Music className="h-4 w-4 text-green-400" />
}

interface LibraryAssetCardProps {
  readonly asset: LibraryAsset
  readonly index: number
  readonly isSelected: boolean
  readonly onOpenPreview: (index: number) => void
  readonly onToggleSelect: (id: string) => void
  readonly onDelete: (id: string) => void
}

// Memoized so toggling one card's selection re-renders only that card, not the
// entire (non-virtualized, growing) "My Files" grid.
const LibraryAssetCard = memo(function LibraryAssetCard({
  asset,
  index,
  isSelected,
  onOpenPreview,
  onToggleSelect,
  onDelete,
}: LibraryAssetCardProps) {
  return (
    <div
      className={`group relative rounded-lg border transition-colors overflow-hidden ${
        isSelected
          ? "border-[#ff0073] bg-[#ff0073]/5"
          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
      }`}
    >
      {/* Thumbnail / Preview */}
      <div
        className="h-32 bg-muted/30 flex items-center justify-center cursor-pointer relative"
        onClick={() => asset.url && onOpenPreview(index)}
      >
        {asset.type === "image" && asset.url ? (
          <CachedImage
            src={asset.thumbnailUrl ?? asset.url}
            alt={asset.filename}
            className="w-full h-full object-cover"
            thumbnail
            thumbnailWidth={320}
          />
        ) : asset.type === "video" ? (
          asset.thumbnailUrl ? (
            <div className="relative w-full h-full">
              <CachedImage
                src={asset.thumbnailUrl}
                alt={asset.filename}
                className="w-full h-full object-cover"
                thumbnail
                thumbnailWidth={320}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-full bg-black/50 p-2">
                  <Play className="h-5 w-5 text-white" fill="white" />
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex items-center justify-center">
              <Film className="h-10 w-10 text-muted-foreground/30" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Play className="h-4 w-4 text-muted-foreground/50" />
              </div>
            </div>
          )
        ) : (
          <div className="relative flex items-center justify-center">
            <Music className="h-10 w-10 text-muted-foreground/30" />
            <div className="absolute inset-0 flex items-center justify-center mt-6">
              <Play className="h-4 w-4 text-muted-foreground/50" />
            </div>
          </div>
        )}

        {/* Checkbox overlay */}
        <button
          type="button"
          className={`absolute top-2 left-2 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(asset.id)
          }}
        >
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-[#ff0073]" />
          ) : (
            <Square className="h-5 w-5 text-muted-foreground/60" />
          )}
        </button>
      </div>

      {/* Info */}
      <div className="p-3 space-y-1.5">
        <p className="text-xs font-medium truncate" title={asset.filename}>
          {asset.filename || "Untitled"}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 capitalize flex items-center gap-1">
              <TypeIcon type={asset.type} />
              {asset.type}
            </Badge>
            {asset.sizeBytes > 0 && (
              <span className="text-[10px] text-muted-foreground">{formatBytes(asset.sizeBytes)}</span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">{formatDate(asset.createdAt)}</span>
        </div>

        {/* Delete button */}
        <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(asset.id)
            }}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
})

export default function LibraryPage() {
  const { user } = useAuth()
  const [filter, setFilter] = useState<TypeFilter>("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const closePreview = useCallback(() => setPreviewIndex(null), [])
  useBackToClose(previewIndex !== null, closePreview)

  // Storage profile (auto-refreshes after delete via query invalidation)
  const { data: storageData } = useStorageProfile(user?.id)
  const storageUsed = storageData?.storageUsed ?? 0
  const storageLimit = storageData?.storageLimit ?? 0

  // Infinite asset list (auto-refetches when filter changes via query key)
  const {
    data,
    isLoading: loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: loadingMore,
  } = useLibraryInfinite({
    userId: user?.id,
    type: filter !== "all" ? filter : undefined,
    owned: true,
    limit: 40,
  })

  // Memoized so selection toggles don't re-derive the whole list and force the
  // (non-virtualized, growing) grid to reconcile every card.
  const assets: LibraryAsset[] = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data],
  )
  const totalCount = data?.pages[0]?.totalCount ?? assets.length
  const previewAsset = previewIndex !== null ? assets[previewIndex] ?? null : null

  // Auto-fetch next page when previewing near the end of loaded items
  useEffect(() => {
    if (previewIndex !== null && previewIndex >= assets.length - 3 && hasNextPage && !loadingMore) {
      fetchNextPage()
    }
  }, [previewIndex, assets.length, hasNextPage, loadingMore, fetchNextPage])

  const handlePreviewPrev = useCallback(() => {
    setPreviewIndex((i) => (i !== null && i > 0 ? i - 1 : i))
  }, [])

  const handlePreviewNext = useCallback(() => {
    setPreviewIndex((i) => {
      if (i === null) return i
      // Allow navigating up to the last loaded item; auto-fetch effect handles loading more
      return i < assets.length - 1 ? i + 1 : i
    })
  }, [assets.length])

  // Reset selection when filter changes
  useEffect(() => {
    setSelected(new Set())
  }, [filter])

  const deleteMutation = useDeleteLibraryAssetMutation()

  const handleDelete = useCallback(async (assetId: string) => {
    if (!user?.id) return
    try {
      await deleteMutation.mutateAsync({ assetId, userId: user.id })
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(assetId)
        return next
      })
      toast.success("File deleted")
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }, [user?.id, deleteMutation])

  const handleDeleteSelected = useCallback(async () => {
    if (!user?.id || selected.size === 0) return
    setDeleting(true)
    const ids = [...selected]
    let deletedCount = 0

    for (const id of ids) {
      try {
        await deleteMutation.mutateAsync({ assetId: id, userId: user.id })
        deletedCount++
      } catch {
        // continue deleting others
      }
    }

    setSelected(new Set())
    setDeleting(false)
    toast.success(`Deleted ${deletedCount} file${deletedCount !== 1 ? "s" : ""}`)
  }, [user?.id, selected, deleteMutation])

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => (prev.size === assets.length ? new Set() : new Set(assets.map((a) => a.id))))
  }, [assets])

  // Stable preview-open callback for memoized cards
  const handleOpenPreview = useCallback((index: number) => {
    setPreviewIndex(index)
  }, [])

  // Row-virtualize the (window-scrolled) "My Files" grid. The hook auto-fetches
  // the next page when the last rendered row nears the end, so the "Load More"
  // button below is kept only as a manual fallback. The flat `assets` array
  // stays complete — preview indexing into assets[i] is unaffected.
  const {
    gridRef,
    virtualRows,
    totalSize,
    columns,
    scrollMargin,
    gridTemplateColumns,
  } = useVirtualGrid({
    itemCount: assets.length,
    breakpoints: GRID_BREAKPOINTS.library,
    // Fixed-height cards: h-32 thumbnail + info/actions section.
    estimateRowHeight: 224,
    gap: 12, // gap-3
    overscan: 3,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: loadingMore,
  })

  const usagePercent = storageLimit > 0 ? Math.min(100, Math.round((storageUsed / storageLimit) * 100)) : 0

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderOpen className="h-6 w-6 text-[#ff0073]" />
          <h1 className="text-2xl font-bold">My Files</h1>
        </div>
      </div>

      {/* Storage Summary */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5 text-[#ff0073]" />
          <h2 className="text-lg font-semibold">Storage</h2>
          <span className="text-sm text-muted-foreground ml-auto">
            {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${usagePercent}%`,
                backgroundColor: usagePercent >= 90 ? "#ef4444" : usagePercent >= 70 ? "#f59e0b" : "#3b82f6",
              }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{usagePercent}% used</span>
            <span>{formatBytes(Math.max(0, storageLimit - storageUsed))} available</span>
          </div>
        </div>

        {usagePercent > 70 && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {usagePercent >= 90 ? "Storage almost full! Upgrade for more space." : "Running low on storage. Consider upgrading."}
            </p>
            <Link to="/_pricing">
              <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400">
                <ArrowUpRight className="h-3 w-3 mr-1" />
                Upgrade
              </Button>
            </Link>
          </div>
        )}
      </section>

      {/* Filter Tabs + Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                filter === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {assets.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
              className="text-xs"
            >
              {selected.size === assets.length ? "Deselect All" : "Select All"}
            </Button>
          )}
          {selected.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelected}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              )}
              Delete {selected.size} Selected
            </Button>
          )}
        </div>
      </div>

      {/* File Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <FolderOpen className="h-10 w-10 opacity-40" />
          <p className="text-sm">No files found</p>
          {filter !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => setFilter("all")}>
              Show all types
            </Button>
          )}
        </div>
      ) : (
        // Windowed grid: only rows in (viewport + overscan) are mounted.
        <div ref={gridRef} style={{ height: totalSize, position: "relative" }}>
          {virtualRows.map((virtualRow) => (
            <div
              key={virtualRow.key}
              className="absolute top-0 left-0 w-full"
              style={{
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                display: "grid",
                gridTemplateColumns,
                gap: 12,
              }}
            >
              {rowItems(assets, virtualRow.index, columns).map(({ item: asset, index: assetIndex }) => (
                <LibraryAssetCard
                  key={asset.id}
                  asset={asset}
                  index={assetIndex}
                  isSelected={selected.has(asset.id)}
                  onOpenPreview={handleOpenPreview}
                  onToggleSelect={toggleSelect}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {hasNextPage && !loading && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Load More
          </Button>
        </div>
      )}

      <MediaPreviewModal
        isOpen={previewAsset !== null}
        onClose={closePreview}
        type={previewAsset?.type ?? "image"}
        url={previewAsset?.url ?? ""}
        currentIndex={previewIndex ?? 0}
        totalCount={totalCount}
        onPrev={previewIndex !== null && previewIndex > 0 ? handlePreviewPrev : undefined}
        onNext={previewIndex !== null && previewIndex < totalCount - 1 ? handlePreviewNext : undefined}
      />
    </div>
  )
}
