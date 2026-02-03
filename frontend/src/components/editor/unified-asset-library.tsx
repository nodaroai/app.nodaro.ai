"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Grid3X3, X, Loader2, AlertCircle, Plus, Search, UserCircle, Package, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { CharacterPageModal } from "./character-page-modal"
import { ObjectPageModal } from "./object-page-modal"
import { LocationPageModal } from "./location-page-modal"
import { getCharacters, getObjects, getLocations, type DbCharacter, type DbObject, type DbLocation } from "@/lib/api"
import { createClient } from "@/lib/supabase"
import type { CharacterNodeData, ObjectNodeData, LocationNodeData } from "@/types/nodes"

type AssetType = "all" | "character" | "object" | "location"

interface UnifiedAsset {
  id: string
  dbId: string
  name: string
  type: "character" | "object" | "location"
  thumbnailUrl?: string
  projectId?: string
  // Store original data for populating nodes
  originalData: DbCharacter | DbObject | DbLocation
}

export function UnifiedAssetLibraryButton() {
  const [open, setOpen] = useState(false)
  const [assets, setAssets] = useState<UnifiedAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<AssetType>("all")

  // Page modals
  const [characterPageNodeId, setCharacterPageNodeId] = useState<string | null>(null)
  const [objectPageNodeId, setObjectPageNodeId] = useState<string | null>(null)
  const [locationPageNodeId, setLocationPageNodeId] = useState<string | null>(null)

  const nodes = useWorkflowStore((s) => s.nodes)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const addNode = useWorkflowStore((s) => s.addNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const projectId = useWorkflowStore((s) => s.projectId)

  // Fetch all assets when modal opens
  // NOTE: We fetch ALL user assets (not filtered by project) for a true unified library
  const fetchAllAssets = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id

      console.log("[AssetLibrary] Fetching all assets for userId:", userId)

      // Fetch all three types in parallel - NO projectId filter to get ALL user assets
      const [charactersRes, objectsRes, locationsRes] = await Promise.all([
        getCharacters(undefined, userId),
        getObjects(undefined, userId),
        getLocations(undefined, userId),
      ])

      console.log("[AssetLibrary] Fetched:", {
        characters: charactersRes.characters.length,
        objects: objectsRes.objects.length,
        locations: locationsRes.locations.length,
      })

      // Combine into unified array
      const unified: UnifiedAsset[] = [
        ...charactersRes.characters.map((c): UnifiedAsset => ({
          id: `char-${c.id}`,
          dbId: c.id,
          name: c.name,
          type: "character",
          thumbnailUrl: c.sourceImageUrl ?? undefined,
          projectId: c.projectId ?? undefined,
          originalData: c,
        })),
        ...objectsRes.objects.map((o): UnifiedAsset => ({
          id: `obj-${o.id}`,
          dbId: o.id,
          name: o.name,
          type: "object",
          thumbnailUrl: o.sourceImageUrl ?? undefined,
          projectId: o.projectId ?? undefined,
          originalData: o,
        })),
        ...locationsRes.locations.map((l): UnifiedAsset => ({
          id: `loc-${l.id}`,
          dbId: l.id,
          name: l.name,
          type: "location",
          thumbnailUrl: l.sourceImageUrl ?? undefined,
          projectId: l.projectId ?? undefined,
          originalData: l,
        })),
      ]

      console.log("[AssetLibrary] Unified assets:", unified.map(a => `${a.type}:${a.name}`))
      setAssets(unified)
    } catch (err) {
      console.error("[AssetLibrary] Error:", err)
      setError(err instanceof Error ? err.message : "Failed to load assets")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchAllAssets()
    }
  }, [open, fetchAllAssets])

  // Filter assets based on search and type
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
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
  }, [assets, typeFilter, searchQuery])

  // Count by type for badges
  const counts = useMemo(() => {
    return {
      all: assets.length,
      character: assets.filter((a) => a.type === "character").length,
      object: assets.filter((a) => a.type === "object").length,
      location: assets.filter((a) => a.type === "location").length,
    }
  }, [assets])

  // Find if asset already has a node on canvas
  const findNodeForAsset = useCallback(
    (asset: UnifiedAsset): string | null => {
      for (const node of nodes) {
        if (asset.type === "character" && node.type === "character") {
          const d = node.data as CharacterNodeData
          if (d.characterDbId === asset.dbId) return node.id
        } else if (asset.type === "object" && node.type === "object") {
          const d = node.data as ObjectNodeData
          if (d.objectDbId === asset.dbId) return node.id
        } else if (asset.type === "location" && node.type === "location") {
          const d = node.data as LocationNodeData
          if (d.locationDbId === asset.dbId) return node.id
        }
      }
      return null
    },
    [nodes],
  )

  // Handle clicking asset thumbnail - opens respective Page modal
  const handleAssetClick = useCallback(
    (asset: UnifiedAsset) => {
      const existingNodeId = findNodeForAsset(asset)

      if (existingNodeId) {
        // Already on canvas - open Page modal for that node
        if (asset.type === "character") setCharacterPageNodeId(existingNodeId)
        else if (asset.type === "object") setObjectPageNodeId(existingNodeId)
        else if (asset.type === "location") setLocationPageNodeId(existingNodeId)
        setOpen(false)
      } else {
        // Not on canvas - create node then open Page modal
        const maxX = nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.x)) + 300 : 200
        const avgY = nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length : 200

        const nodeId = addNode(asset.type, { x: maxX, y: avgY })

        if (nodeId) {
          // Populate with DB data
          if (asset.type === "character") {
            const c = asset.originalData as DbCharacter
            updateNodeData(nodeId, {
              characterDbId: c.id,
              characterName: c.name,
              description: c.description ?? "",
              gender: c.gender ?? "other",
              style: c.style ?? "realistic",
              baseOutfit: c.baseOutfit ?? "",
              sourceImageUrl: c.sourceImageUrl ?? "",
              expressions: c.expressions ?? [],
              poses: c.poses ?? [],
              lightingVariations: c.lightingVariations ?? [],
            })
            selectNode(nodeId)
            setCharacterPageNodeId(nodeId)
          } else if (asset.type === "object") {
            const o = asset.originalData as DbObject
            updateNodeData(nodeId, {
              objectDbId: o.id,
              objectName: o.name,
              description: o.description ?? "",
              category: o.category ?? "other",
              style: o.style ?? "realistic",
              sourceImageUrl: o.sourceImageUrl ?? "",
              angles: o.angles ?? [],
              materials: o.materials ?? [],
              variations: o.variations ?? [],
            })
            selectNode(nodeId)
            setObjectPageNodeId(nodeId)
          } else if (asset.type === "location") {
            const l = asset.originalData as DbLocation
            updateNodeData(nodeId, {
              locationDbId: l.id,
              locationName: l.name,
              description: l.description ?? "",
              category: l.category ?? "outdoor",
              style: l.style ?? "realistic",
              sourceImageUrl: l.sourceImageUrl ?? "",
              timeOfDay: l.timeOfDay ?? [],
              weather: l.weather ?? [],
              angles: l.angles ?? [],
            })
            selectNode(nodeId)
            setLocationPageNodeId(nodeId)
          }
          setOpen(false)
        }
      }
    },
    [nodes, findNodeForAsset, addNode, updateNodeData, selectNode],
  )

  // Handle clicking "+" button - adds to canvas without opening modal
  const handleAddToCanvas = useCallback(
    (e: React.MouseEvent, asset: UnifiedAsset) => {
      e.stopPropagation()

      const maxX = nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.x)) + 300 : 200
      const avgY = nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length : 200

      const nodeId = addNode(asset.type, { x: maxX, y: avgY })

      if (nodeId) {
        if (asset.type === "character") {
          const c = asset.originalData as DbCharacter
          updateNodeData(nodeId, {
            characterDbId: c.id,
            characterName: c.name,
            description: c.description ?? "",
            gender: c.gender ?? "other",
            style: c.style ?? "realistic",
            baseOutfit: c.baseOutfit ?? "",
            sourceImageUrl: c.sourceImageUrl ?? "",
            expressions: c.expressions ?? [],
            poses: c.poses ?? [],
            lightingVariations: c.lightingVariations ?? [],
          })
        } else if (asset.type === "object") {
          const o = asset.originalData as DbObject
          updateNodeData(nodeId, {
            objectDbId: o.id,
            objectName: o.name,
            description: o.description ?? "",
            category: o.category ?? "other",
            style: o.style ?? "realistic",
            sourceImageUrl: o.sourceImageUrl ?? "",
            angles: o.angles ?? [],
            materials: o.materials ?? [],
            variations: o.variations ?? [],
          })
        } else if (asset.type === "location") {
          const l = asset.originalData as DbLocation
          updateNodeData(nodeId, {
            locationDbId: l.id,
            locationName: l.name,
            description: l.description ?? "",
            category: l.category ?? "outdoor",
            style: l.style ?? "realistic",
            sourceImageUrl: l.sourceImageUrl ?? "",
            timeOfDay: l.timeOfDay ?? [],
            weather: l.weather ?? [],
            angles: l.angles ?? [],
          })
        }

        selectNode(nodeId)
        setOpen(false)
      }
    },
    [nodes, addNode, updateNodeData, selectNode],
  )

  // Type badge colors and icons
  const getTypeBadge = (type: "character" | "object" | "location") => {
    switch (type) {
      case "character":
        return { color: "bg-pink-500/10 text-pink-600", icon: UserCircle }
      case "object":
        return { color: "bg-emerald-500/10 text-emerald-600", icon: Package }
      case "location":
        return { color: "bg-cyan-500/10 text-cyan-600", icon: MapPin }
    }
  }

  const totalCount = counts.all

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 h-10 touch-manipulation"
        onClick={() => setOpen(true)}
      >
        <Grid3X3 className="h-4 w-4" />
        Asset Library
        {totalCount > 0 && (
          <span className="ml-auto text-[10px] bg-violet-500/10 text-violet-600 px-1.5 py-0.5 rounded-full">
            {totalCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border rounded-xl shadow-2xl w-[600px] max-w-[95vw] max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">Asset Library</h3>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Search */}
            <div className="px-4 py-3 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search assets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            </div>

            {/* Type Filter Tabs */}
            <div className="flex gap-1 px-4 py-2 border-b">
              <Button
                variant={typeFilter === "all" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setTypeFilter("all")}
              >
                All
                <span className="ml-1.5 text-[10px] opacity-60">({counts.all})</span>
              </Button>
              <Button
                variant={typeFilter === "character" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => setTypeFilter("character")}
              >
                <UserCircle className="h-3 w-3" />
                Characters
                <span className="ml-1 text-[10px] opacity-60">({counts.character})</span>
              </Button>
              <Button
                variant={typeFilter === "object" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => setTypeFilter("object")}
              >
                <Package className="h-3 w-3" />
                Objects
                <span className="ml-1 text-[10px] opacity-60">({counts.object})</span>
              </Button>
              <Button
                variant={typeFilter === "location" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => setTypeFilter("location")}
              >
                <MapPin className="h-3 w-3" />
                Locations
                <span className="ml-1 text-[10px] opacity-60">({counts.location})</span>
              </Button>
            </div>

            {/* Body */}
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
                  <Button variant="outline" size="sm" className="mt-2" onClick={fetchAllAssets}>
                    Retry
                  </Button>
                </div>
              ) : filteredAssets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Grid3X3 className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">
                    {searchQuery || typeFilter !== "all" ? "No matching assets" : "No saved assets"}
                  </p>
                  <p className="text-xs mt-1">
                    {searchQuery || typeFilter !== "all"
                      ? "Try adjusting your filters"
                      : "Generate a character, object, or location to save it here"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {filteredAssets.map((asset) => {
                    const isOnCanvas = !!findNodeForAsset(asset)
                    const badge = getTypeBadge(asset.type)
                    const BadgeIcon = badge.icon

                    return (
                      <div key={asset.id} className="relative group">
                        <button
                          type="button"
                          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/30 transition-colors cursor-pointer text-left w-full"
                          onClick={() => handleAssetClick(asset)}
                          title={`View ${asset.name}`}
                        >
                          {asset.thumbnailUrl ? (
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted/30">
                              <img
                                src={asset.thumbnailUrl}
                                alt={asset.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-muted/30 flex items-center justify-center">
                              <BadgeIcon className="w-8 h-8 text-muted-foreground/30" />
                            </div>
                          )}
                          <span className="text-xs truncate w-full text-center">{asset.name}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${badge.color}`}>
                            {asset.type}
                          </span>
                          {isOnCanvas && (
                            <span className="text-[9px] text-muted-foreground">On canvas</span>
                          )}
                        </button>
                        {/* Add to canvas button */}
                        <button
                          type="button"
                          className="absolute bottom-8 right-1 w-6 h-6 flex items-center justify-center bg-violet-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-violet-600"
                          onClick={(e) => handleAddToCanvas(e, asset)}
                          title={`Add ${asset.name} to canvas`}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Page Modals */}
      {characterPageNodeId && (
        <CharacterPageModal
          characterNodeId={characterPageNodeId}
          onClose={() => setCharacterPageNodeId(null)}
        />
      )}
      {objectPageNodeId && (
        <ObjectPageModal
          objectNodeId={objectPageNodeId}
          onClose={() => setObjectPageNodeId(null)}
        />
      )}
      {locationPageNodeId && (
        <LocationPageModal
          locationNodeId={locationPageNodeId}
          onClose={() => setLocationPageNodeId(null)}
        />
      )}
    </>
  )
}
