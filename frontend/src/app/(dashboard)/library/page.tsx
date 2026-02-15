"use client"

import { Suspense } from "react"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  HardDrive,
  Trash2,
  Loader2,
  ImageIcon,
  Film,
  Music,
  ArrowUpRight,
  FolderOpen,
  CheckSquare,
  Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { createClient } from "@/lib/supabase"
import {
  getLibraryAssets,
  deleteLibraryAsset,
  type LibraryAsset,
} from "@/lib/api"

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

export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-96"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <LibraryPageContent />
    </Suspense>
  )
}

function LibraryPageContent() {
  const { user } = useAuth()
  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [filter, setFilter] = useState<TypeFilter>("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [storageUsed, setStorageUsed] = useState(0)
  const [storageLimit, setStorageLimit] = useState(0)

  const loadStorage = useCallback(async () => {
    if (!user?.id) return
    const supabase = createClient()
    const { data } = await supabase
      .from("profiles")
      .select("storage_used_bytes, storage_limit_bytes")
      .eq("id", user.id)
      .single()
    if (data) {
      setStorageUsed(data.storage_used_bytes ?? 0)
      setStorageLimit(data.storage_limit_bytes ?? 0)
    }
  }, [user?.id])

  const loadAssets = useCallback(async (cursor?: string) => {
    if (!user?.id) return
    if (!cursor) setLoading(true)
    else setLoadingMore(true)

    try {
      const result = await getLibraryAssets({
        userId: user.id,
        type: filter === "all" ? undefined : filter,
        limit: 40,
        cursor: cursor ?? undefined,
        owned: true,
      })
      const items = result.data ?? result as unknown as LibraryAsset[]
      if (cursor) {
        setAssets((prev) => [...prev, ...(Array.isArray(items) ? items : [])])
      } else {
        setAssets(Array.isArray(items) ? items : [])
      }
      setNextCursor(result.nextCursor ?? null)
    } catch (err) {
      toast.error("Failed to load files", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [user?.id, filter])

  useEffect(() => {
    setAssets([])
    setNextCursor(null)
    setSelected(new Set())
    loadAssets()
    loadStorage()
  }, [loadAssets, loadStorage])

  const handleDelete = useCallback(async (assetId: string) => {
    if (!user?.id) return
    try {
      await deleteLibraryAsset(assetId, user.id)
      setAssets((prev) => prev.filter((a) => a.id !== assetId))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(assetId)
        return next
      })
      toast.success("File deleted")
      loadStorage()
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }, [user?.id, loadStorage])

  const handleDeleteSelected = useCallback(async () => {
    if (!user?.id || selected.size === 0) return
    setDeleting(true)
    const ids = [...selected]
    let deletedCount = 0

    for (const id of ids) {
      try {
        await deleteLibraryAsset(id, user.id)
        deletedCount++
      } catch {
        // continue deleting others
      }
    }

    setAssets((prev) => prev.filter((a) => !selected.has(a.id)))
    setSelected(new Set())
    setDeleting(false)
    toast.success(`Deleted ${deletedCount} file${deletedCount !== 1 ? "s" : ""}`)
    loadStorage()
  }, [user?.id, selected, loadStorage])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === assets.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(assets.map((a) => a.id)))
    }
  }

  const usagePercent = storageLimit > 0 ? Math.min(100, Math.round((storageUsed / storageLimit) * 100)) : 0

  const TypeIcon = ({ type }: { type: string }) => {
    if (type === "image") return <ImageIcon className="h-4 w-4 text-blue-400" />
    if (type === "video") return <Film className="h-4 w-4 text-purple-400" />
    return <Music className="h-4 w-4 text-green-400" />
  }

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
            <Link href="/pricing">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {assets.map((asset) => {
            const isSelected = selected.has(asset.id)
            return (
              <div
                key={asset.id}
                className={`group relative rounded-lg border transition-colors overflow-hidden ${
                  isSelected
                    ? "border-[#ff0073] bg-[#ff0073]/5"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                }`}
              >
                {/* Thumbnail / Preview */}
                <div
                  className="h-32 bg-muted/30 flex items-center justify-center cursor-pointer"
                  onClick={() => toggleSelect(asset.id)}
                >
                  {asset.type === "image" && asset.url ? (
                    <img
                      src={asset.thumbnailUrl ?? asset.url}
                      alt={asset.filename}
                      className="w-full h-full object-cover"
                    />
                  ) : asset.type === "video" ? (
                    <Film className="h-10 w-10 text-muted-foreground/30" />
                  ) : (
                    <Music className="h-10 w-10 text-muted-foreground/30" />
                  )}

                  {/* Checkbox overlay */}
                  <div className={`absolute top-2 left-2 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                    {isSelected ? (
                      <CheckSquare className="h-5 w-5 text-[#ff0073]" />
                    ) : (
                      <Square className="h-5 w-5 text-muted-foreground/60" />
                    )}
                  </div>
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
                        handleDelete(asset.id)
                      }}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Load More */}
      {nextCursor && !loading && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => loadAssets(nextCursor)}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Load More
          </Button>
        </div>
      )}
    </div>
  )
}
