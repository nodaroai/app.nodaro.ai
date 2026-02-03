"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { X, Loader2, AlertCircle, Search, UserCircle, Package, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getCharacters, getObjects, getLocations, type DbCharacter, type DbObject, type DbLocation } from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { cn } from "@/lib/utils"

type AssetType = "all" | "character" | "object" | "location"

export interface SelectedAsset {
  id: string
  name: string
  type: "character" | "object" | "location"
  thumbnailUrl?: string
  description?: string
}

interface AssetSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (asset: SelectedAsset) => void
  title?: string
  excludeIds?: readonly string[]
}

interface UnifiedAsset {
  id: string
  name: string
  type: "character" | "object" | "location"
  thumbnailUrl?: string
  description?: string
}

export function AssetSelectionModal({
  isOpen,
  onClose,
  onSelect,
  title = "Select Asset",
  excludeIds = [],
}: AssetSelectionModalProps) {
  const [assets, setAssets] = useState<UnifiedAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<AssetType>("all")

  const fetchAllAssets = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id

      const [charactersRes, objectsRes, locationsRes] = await Promise.all([
        getCharacters(undefined, userId),
        getObjects(undefined, userId),
        getLocations(undefined, userId),
      ])

      const unified: UnifiedAsset[] = [
        ...charactersRes.characters.map((c): UnifiedAsset => ({
          id: c.id,
          name: c.name,
          type: "character",
          thumbnailUrl: c.sourceImageUrl ?? undefined,
          description: c.description ?? undefined,
        })),
        ...objectsRes.objects.map((o): UnifiedAsset => ({
          id: o.id,
          name: o.name,
          type: "object",
          thumbnailUrl: o.sourceImageUrl ?? undefined,
          description: o.description ?? undefined,
        })),
        ...locationsRes.locations.map((l): UnifiedAsset => ({
          id: l.id,
          name: l.name,
          type: "location",
          thumbnailUrl: l.sourceImageUrl ?? undefined,
          description: l.description ?? undefined,
        })),
      ]

      setAssets(unified)
    } catch (err) {
      console.error("[AssetSelectionModal] Error:", err)
      setError(err instanceof Error ? err.message : "Failed to load assets")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchAllAssets()
    }
  }, [isOpen, fetchAllAssets])

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      // Exclude already attached
      if (excludeIds.includes(asset.id)) {
        return false
      }
      // Type filter
      if (typeFilter !== "all" && asset.type !== typeFilter) {
        return false
      }
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        if (!asset.name.toLowerCase().includes(query)) {
          return false
        }
      }
      return true
    })
  }, [assets, typeFilter, searchQuery, excludeIds])

  const counts = useMemo(() => {
    const filtered = assets.filter((a) => !excludeIds.includes(a.id))
    return {
      all: filtered.length,
      character: filtered.filter((a) => a.type === "character").length,
      object: filtered.filter((a) => a.type === "object").length,
      location: filtered.filter((a) => a.type === "location").length,
    }
  }, [assets, excludeIds])

  const handleSelect = (asset: UnifiedAsset) => {
    onSelect({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      thumbnailUrl: asset.thumbnailUrl,
      description: asset.description,
    })
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-2xl border w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Search and Filters */}
        <div className="p-4 border-b space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant={typeFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter("all")}
              className="text-xs"
            >
              All ({counts.all})
            </Button>
            <Button
              variant={typeFilter === "character" ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter("character")}
              className={cn("text-xs", typeFilter === "character" && "bg-pink-500 hover:bg-pink-600")}
            >
              <UserCircle className="w-3.5 h-3.5 mr-1" />
              Characters ({counts.character})
            </Button>
            <Button
              variant={typeFilter === "object" ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter("object")}
              className={cn("text-xs", typeFilter === "object" && "bg-emerald-500 hover:bg-emerald-600")}
            >
              <Package className="w-3.5 h-3.5 mr-1" />
              Objects ({counts.object})
            </Button>
            <Button
              variant={typeFilter === "location" ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter("location")}
              className={cn("text-xs", typeFilter === "location" && "bg-cyan-500 hover:bg-cyan-600")}
            >
              <MapPin className="w-3.5 h-3.5 mr-1" />
              Locations ({counts.location})
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <p className="text-sm">Loading assets...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-destructive">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p className="text-sm">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={fetchAllAssets}>
                Retry
              </Button>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">
                {assets.length === 0
                  ? "No assets found. Create some characters, objects, or locations first."
                  : "No assets match your filters."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {filteredAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => handleSelect(asset)}
                  className={cn(
                    "group relative flex flex-col items-center p-2 rounded-lg border-2 transition-all hover:shadow-md",
                    asset.type === "character" && "hover:border-pink-500/50",
                    asset.type === "object" && "hover:border-emerald-500/50",
                    asset.type === "location" && "hover:border-cyan-500/50",
                  )}
                >
                  {asset.thumbnailUrl ? (
                    <img
                      src={asset.thumbnailUrl}
                      alt={asset.name}
                      className="w-full aspect-square object-cover rounded-md"
                    />
                  ) : (
                    <div className={cn(
                      "w-full aspect-square rounded-md flex items-center justify-center",
                      asset.type === "character" && "bg-pink-500/10",
                      asset.type === "object" && "bg-emerald-500/10",
                      asset.type === "location" && "bg-cyan-500/10",
                    )}>
                      {asset.type === "character" && <UserCircle className="w-8 h-8 text-pink-500/50" />}
                      {asset.type === "object" && <Package className="w-8 h-8 text-emerald-500/50" />}
                      {asset.type === "location" && <MapPin className="w-8 h-8 text-cyan-500/50" />}
                    </div>
                  )}
                  <span className="text-xs font-medium mt-1.5 truncate w-full text-center">{asset.name}</span>
                  <span className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded mt-0.5",
                    asset.type === "character" && "bg-pink-500/10 text-pink-500",
                    asset.type === "object" && "bg-emerald-500/10 text-emerald-500",
                    asset.type === "location" && "bg-cyan-500/10 text-cyan-500",
                  )}>
                    {asset.type}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
