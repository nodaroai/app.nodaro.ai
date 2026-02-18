import { useState, useCallback, useMemo, lazy, Suspense } from "react"
import { createPortal } from "react-dom"
import { Grid3X3, X, Loader2, AlertCircle, Plus, Search, UserCircle, Package, MapPin, SmilePlus, FolderOpen } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAuth } from "@/hooks/use-auth"
import { useCharacters, useObjects, useLocations, useFaces } from "@/hooks/queries/use-assets-queries"
import { queryKeys } from "@/lib/query-keys"
const CharacterPageModal = lazy(() => import("./character-page-modal").then(m => ({ default: m.CharacterPageModal })))
const ObjectPageModal = lazy(() => import("./object-page-modal").then(m => ({ default: m.ObjectPageModal })))
const LocationPageModal = lazy(() => import("./location-page-modal").then(m => ({ default: m.LocationPageModal })))
import { createClient } from "@/lib/supabase"
import type { DbCharacter, DbObject, DbLocation, DbFace } from "@/lib/api"
import { CachedImage } from "@/components/ui/cached-image"
import type { CharacterNodeData, ObjectNodeData, LocationNodeData, FaceNodeData } from "@/types/nodes"

type AssetType = "all" | "character" | "object" | "location" | "face"

interface UnifiedAsset {
  id: string
  dbId: string
  name: string
  type: "character" | "object" | "location" | "face"
  thumbnailUrl?: string
  projectId?: string
  originalData: DbCharacter | DbObject | DbLocation | DbFace
}

interface UnifiedAssetLibraryModalProps {
  readonly open: boolean
  readonly onClose: () => void
}

function useAssetData() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: characters = [], isLoading: loadingChars, error: charError } = useCharacters(undefined, user?.id)
  const { data: objects = [], isLoading: loadingObjs, error: objError } = useObjects(undefined, user?.id)
  const { data: locations = [], isLoading: loadingLocs, error: locError } = useLocations(undefined, user?.id)
  const { data: faces = [], isLoading: loadingFaces, error: faceError } = useFaces(undefined, user?.id)

  const loading = loadingChars || loadingObjs || loadingLocs || loadingFaces
  const error = charError || objError || locError || faceError

  const assets = useMemo((): UnifiedAsset[] => [
    ...characters.map((c): UnifiedAsset => ({
      id: `char-${c.id}`,
      dbId: c.id,
      name: c.name,
      type: "character",
      thumbnailUrl: c.sourceImageUrl ?? undefined,
      projectId: c.projectId ?? undefined,
      originalData: c,
    })),
    ...objects.map((o): UnifiedAsset => ({
      id: `obj-${o.id}`,
      dbId: o.id,
      name: o.name,
      type: "object",
      thumbnailUrl: o.sourceImageUrl ?? undefined,
      projectId: o.projectId ?? undefined,
      originalData: o,
    })),
    ...locations.map((l): UnifiedAsset => ({
      id: `loc-${l.id}`,
      dbId: l.id,
      name: l.name,
      type: "location",
      thumbnailUrl: l.sourceImageUrl ?? undefined,
      projectId: l.projectId ?? undefined,
      originalData: l,
    })),
    ...faces.map((f): UnifiedAsset => ({
      id: `face-${f.id}`,
      dbId: f.id,
      name: f.name,
      type: "face",
      thumbnailUrl: f.sourceImageUrl ?? undefined,
      projectId: f.projectId ?? undefined,
      originalData: f,
    })),
  ], [characters, objects, locations, faces])

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "list", user?.id],
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .eq("user_id", user!.id)
        .order("name")
      if (error) throw error
      return data as Array<{ id: string; name: string }>
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  })

  const invalidateAssets = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.assets.all })
  }, [queryClient])

  return { assets, projects, loading, error, invalidateAssets }
}

// Standalone modal that can be controlled externally
export function UnifiedAssetLibraryModal({ open, onClose }: UnifiedAssetLibraryModalProps) {
  const { assets, projects, loading, error, invalidateAssets } = useAssetData()

  // Filters
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<AssetType>("all")
  const [filterByProject, setFilterByProject] = useState<string>("all")

  // Page modals
  const [characterPageNodeId, setCharacterPageNodeId] = useState<string | null>(null)
  const [objectPageNodeId, setObjectPageNodeId] = useState<string | null>(null)
  const [locationPageNodeId, setLocationPageNodeId] = useState<string | null>(null)

  const nodes = useWorkflowStore((s) => s.nodes)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const addNode = useWorkflowStore((s) => s.addNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  // Filter assets
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      if (typeFilter !== "all" && asset.type !== typeFilter) return false
      if (filterByProject !== "all" && asset.projectId !== filterByProject) return false
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        if (!asset.name.toLowerCase().includes(query)) return false
      }
      return true
    })
  }, [assets, typeFilter, searchQuery, filterByProject])

  // Count by type
  const counts = useMemo(() => ({
    all: assets.length,
    character: assets.filter((a) => a.type === "character").length,
    object: assets.filter((a) => a.type === "object").length,
    location: assets.filter((a) => a.type === "location").length,
    face: assets.filter((a) => a.type === "face").length,
  }), [assets])

  // Find if asset has a node on canvas
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
        } else if (asset.type === "face" && node.type === "face") {
          const d = node.data as FaceNodeData
          if (d.faceDbId === asset.dbId) return node.id
        }
      }
      return null
    },
    [nodes],
  )

  // Handle clicking asset thumbnail
  const handleAssetClick = useCallback(
    (asset: UnifiedAsset) => {
      const existingNodeId = findNodeForAsset(asset)

      if (existingNodeId) {
        // Set Page modal state first, then close library after a microtask to ensure state is processed
        if (asset.type === "character") setCharacterPageNodeId(existingNodeId)
        else if (asset.type === "object") setObjectPageNodeId(existingNodeId)
        else if (asset.type === "location") setLocationPageNodeId(existingNodeId)
        else if (asset.type === "face") selectNode(existingNodeId)
        // Delay onClose to ensure local state update is processed before parent re-renders
        setTimeout(() => onClose(), 0)
      } else {
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
          } else if (asset.type === "face") {
            const f = asset.originalData as DbFace
            updateNodeData(nodeId, {
              faceDbId: f.id,
              faceName: f.name,
              description: f.description ?? "",
              style: f.style ?? "realistic",
              sourceImageUrl: f.sourceImageUrl ?? "",
            })
            selectNode(nodeId)
          }
          // Delay onClose to ensure local state update is processed before parent re-renders
          setTimeout(() => onClose(), 0)
        }
      }
    },
    [nodes, findNodeForAsset, addNode, updateNodeData, selectNode, onClose],
  )

  // Handle clicking "+" button
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
        } else if (asset.type === "face") {
          const f = asset.originalData as DbFace
          updateNodeData(nodeId, {
            faceDbId: f.id,
            faceName: f.name,
            description: f.description ?? "",
            style: f.style ?? "realistic",
            sourceImageUrl: f.sourceImageUrl ?? "",
          })
        }

        selectNode(nodeId)
        onClose()
      }
    },
    [nodes, addNode, updateNodeData, selectNode, onClose],
  )

  // Type badge colors and icons
  function getTypeBadge(type: "character" | "object" | "location" | "face") {
    switch (type) {
      case "character":
        return { color: "bg-pink-500/10 text-pink-600", icon: UserCircle }
      case "object":
        return { color: "bg-emerald-500/10 text-emerald-600", icon: Package }
      case "location":
        return { color: "bg-cyan-500/10 text-cyan-600", icon: MapPin }
      case "face":
        return { color: "bg-violet-500/10 text-violet-600", icon: SmilePlus }
    }
  }

  // Get project name by ID
  const getProjectName = useCallback(
    (projectId?: string) => {
      if (!projectId) return null
      const project = projects.find((p) => p.id === projectId)
      return project?.name ?? null
    },
    [projects]
  )

  return (
    <>
      {/* My Library Modal */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 dark:bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <div
            className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#2D2D2D] rounded-xl shadow-2xl w-[600px] max-w-[95vw] max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#2D2D2D] bg-[#ff0073] rounded-t-xl">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-white">My Library</h3>
            <button
              type="button"
              className="p-1 text-white/80 hover:text-white transition-colors"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search and Filters */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-[#2D2D2D] space-y-2 bg-white dark:bg-[#1E1E1E]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-[#64748B]" />
              <Input
                placeholder="Search assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-gray-900 dark:text-[#E2E8F0] placeholder:text-gray-400 dark:placeholder:text-[#64748B] focus:border-[#ff0073] focus:ring-[#ff0073]/20"
              />
            </div>
            {/* Project Filter */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-[#64748B] min-w-[60px]">
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Project:</span>
              </div>
              <Select
                value={filterByProject}
                onValueChange={setFilterByProject}
              >
                <SelectTrigger className="h-8 text-xs flex-1 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-gray-700 dark:text-[#E2E8F0]">
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent
                  className="bg-white dark:bg-[#1E1E1E] border-gray-200 dark:border-[#2D2D2D] z-[10000]"
                  position="popper"
                >
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filterByProject !== "all" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-gray-500 dark:text-[#94A3B8] hover:text-gray-700 dark:hover:text-white"
                  onClick={() => setFilterByProject("all")}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Type Filter Tabs */}
          <div className="flex gap-1.5 px-4 py-2 border-b border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E]">
            <button
              type="button"
              className={`h-8 px-4 text-xs font-medium rounded-full transition-colors ${
                typeFilter === "all"
                  ? "bg-[#ff0073] text-white"
                  : "bg-gray-100 dark:bg-[#2D2D2D] text-gray-500 dark:text-[#94A3B8] hover:bg-gray-200 dark:hover:bg-[#3D3D3D]"
              }`}
              onClick={() => setTypeFilter("all")}
            >
              All
              <span className="ml-1.5 text-[10px] opacity-70">({counts.all})</span>
            </button>
            <button
              type="button"
              className={`h-8 px-4 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                typeFilter === "character"
                  ? "bg-[#ff0073] text-white"
                  : "bg-gray-100 dark:bg-[#2D2D2D] text-gray-500 dark:text-[#94A3B8] hover:bg-gray-200 dark:hover:bg-[#3D3D3D]"
              }`}
              onClick={() => setTypeFilter("character")}
            >
              <UserCircle className="h-3 w-3" />
              Characters
              <span className="text-[10px] opacity-70">({counts.character})</span>
            </button>
            <button
              type="button"
              className={`h-8 px-4 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                typeFilter === "object"
                  ? "bg-[#ff0073] text-white"
                  : "bg-gray-100 dark:bg-[#2D2D2D] text-gray-500 dark:text-[#94A3B8] hover:bg-gray-200 dark:hover:bg-[#3D3D3D]"
              }`}
              onClick={() => setTypeFilter("object")}
            >
              <Package className="h-3 w-3" />
              Objects
              <span className="text-[10px] opacity-70">({counts.object})</span>
            </button>
            <button
              type="button"
              className={`h-8 px-4 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                typeFilter === "location"
                  ? "bg-[#ff0073] text-white"
                  : "bg-gray-100 dark:bg-[#2D2D2D] text-gray-500 dark:text-[#94A3B8] hover:bg-gray-200 dark:hover:bg-[#3D3D3D]"
              }`}
              onClick={() => setTypeFilter("location")}
            >
              <MapPin className="h-3 w-3" />
              Locations
              <span className="text-[10px] opacity-70">({counts.location})</span>
            </button>
            <button
              type="button"
              className={`h-8 px-4 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                typeFilter === "face"
                  ? "bg-[#ff0073] text-white"
                  : "bg-gray-100 dark:bg-[#2D2D2D] text-gray-500 dark:text-[#94A3B8] hover:bg-gray-200 dark:hover:bg-[#3D3D3D]"
              }`}
              onClick={() => setTypeFilter("face")}
            >
              <SmilePlus className="h-3 w-3" />
              Faces
              <span className="text-[10px] opacity-70">({counts.face})</span>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 bg-[#F8FAFC] dark:bg-[#121212]">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-[#64748B]">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#ff0073]" />
                <p className="text-sm">Loading assets...</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 text-red-500">
                <AlertCircle className="w-8 h-8 mb-2" />
                <p className="text-sm">{error.message || "Failed to load assets"}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={invalidateAssets}>
                  Retry
                </Button>
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-[#64748B]">
                <Grid3X3 className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm">
                  {searchQuery || typeFilter !== "all" || filterByProject !== "all"
                    ? "No matching assets"
                    : "No saved assets"}
                </p>
                <p className="text-xs mt-1">
                  {searchQuery || typeFilter !== "all" || filterByProject !== "all"
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
                  const projectName = filterByProject === "all" ? getProjectName(asset.projectId) : null

                  return (
                    <div key={asset.id} className="relative group">
                      <button
                        type="button"
                        className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] hover:border-[#ff0073] hover:shadow-md transition-all cursor-pointer text-left w-full"
                        onClick={() => handleAssetClick(asset)}
                        title={`View ${asset.name}`}
                      >
                        {asset.thumbnailUrl ? (
                          <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 dark:bg-[#121212]">
                            <CachedImage
                              src={asset.thumbnailUrl}
                              alt={asset.name}
                              className="w-full h-full object-cover"
                              thumbnail
                              thumbnailWidth={160}
                            />
                          </div>
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-[#121212] flex items-center justify-center">
                            <BadgeIcon className="w-8 h-8 text-gray-300 dark:text-[#2D2D2D]" />
                          </div>
                        )}
                        <span className="text-xs font-medium truncate w-full text-center text-gray-900 dark:text-[#E2E8F0]">{asset.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full uppercase font-medium text-[#ff0073] bg-[#ff0073]/10">
                          {asset.type}
                        </span>
                        {projectName && (
                          <span className="text-[9px] text-gray-400 dark:text-[#64748B] truncate w-full text-center">
                            {projectName}
                          </span>
                        )}
                        {isOnCanvas && (
                          <span className="text-[9px] text-gray-400 dark:text-[#64748B]">On canvas</span>
                        )}
                      </button>
                      {/* Add to canvas button */}
                      <button
                        type="button"
                        className="absolute bottom-8 right-1 w-6 h-6 flex items-center justify-center bg-[#ff0073] text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-[#e00066]"
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
        </div>,
        document.body
      )}

      {/* Page Modals - rendered outside the library modal so they stay open when library closes */}
      {characterPageNodeId && (
        <Suspense fallback={null}>
          <CharacterPageModal
            characterNodeId={characterPageNodeId}
            onClose={() => {
              setCharacterPageNodeId(null)
              invalidateAssets()
            }}
          />
        </Suspense>
      )}
      {objectPageNodeId && (
        <Suspense fallback={null}>
          <ObjectPageModal
            objectNodeId={objectPageNodeId}
            onClose={() => {
              setObjectPageNodeId(null)
              invalidateAssets()
            }}
          />
        </Suspense>
      )}
      {locationPageNodeId && (
        <Suspense fallback={null}>
          <LocationPageModal
            locationNodeId={locationPageNodeId}
            onClose={() => {
              setLocationPageNodeId(null)
              invalidateAssets()
            }}
          />
        </Suspense>
      )}
    </>
  )
}

export function UnifiedAssetLibraryButton() {
  const [open, setOpen] = useState(false)
  const { assets, projects, loading, error, invalidateAssets } = useAssetData()

  // Filters
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<AssetType>("all")
  const [filterByProject, setFilterByProject] = useState<string>("all")

  // Page modals
  const [characterPageNodeId, setCharacterPageNodeId] = useState<string | null>(null)
  const [objectPageNodeId, setObjectPageNodeId] = useState<string | null>(null)
  const [locationPageNodeId, setLocationPageNodeId] = useState<string | null>(null)

  const nodes = useWorkflowStore((s) => s.nodes)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const addNode = useWorkflowStore((s) => s.addNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  // Filter assets based on search, type, and project
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      if (typeFilter !== "all" && asset.type !== typeFilter) return false
      if (filterByProject !== "all" && asset.projectId !== filterByProject) return false
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        if (!asset.name.toLowerCase().includes(query)) return false
      }
      return true
    })
  }, [assets, typeFilter, searchQuery, filterByProject])

  // Count by type for badges
  const counts = useMemo(() => ({
    all: assets.length,
    character: assets.filter((a) => a.type === "character").length,
    object: assets.filter((a) => a.type === "object").length,
    location: assets.filter((a) => a.type === "location").length,
    face: assets.filter((a) => a.type === "face").length,
  }), [assets])

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
        } else if (asset.type === "face" && node.type === "face") {
          const d = node.data as FaceNodeData
          if (d.faceDbId === asset.dbId) return node.id
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
        else if (asset.type === "face") selectNode(existingNodeId)
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
          } else if (asset.type === "face") {
            const f = asset.originalData as DbFace
            updateNodeData(nodeId, {
              faceDbId: f.id,
              faceName: f.name,
              description: f.description ?? "",
              style: f.style ?? "realistic",
              sourceImageUrl: f.sourceImageUrl ?? "",
            })
            selectNode(nodeId)
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
        } else if (asset.type === "face") {
          const f = asset.originalData as DbFace
          updateNodeData(nodeId, {
            faceDbId: f.id,
            faceName: f.name,
            description: f.description ?? "",
            style: f.style ?? "realistic",
            sourceImageUrl: f.sourceImageUrl ?? "",
          })
        }

        selectNode(nodeId)
        setOpen(false)
      }
    },
    [nodes, addNode, updateNodeData, selectNode],
  )

  // Type badge colors and icons
  function getTypeBadge(type: "character" | "object" | "location" | "face") {
    switch (type) {
      case "character":
        return { color: "bg-pink-500/10 text-pink-600", icon: UserCircle }
      case "object":
        return { color: "bg-emerald-500/10 text-emerald-600", icon: Package }
      case "location":
        return { color: "bg-cyan-500/10 text-cyan-600", icon: MapPin }
      case "face":
        return { color: "bg-violet-500/10 text-violet-600", icon: SmilePlus }
    }
  }

  // Get project name by ID
  const getProjectName = useCallback(
    (projectId?: string) => {
      if (!projectId) return null
      const project = projects.find((p) => p.id === projectId)
      return project?.name ?? null
    },
    [projects]
  )

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
        My Library
        {totalCount > 0 && (
          <span className="ml-auto text-[10px] bg-violet-500/10 text-violet-600 px-1.5 py-0.5 rounded-full">
            {totalCount}
          </span>
        )}
      </Button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 dark:bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#2D2D2D] rounded-xl shadow-2xl w-[600px] max-w-[95vw] max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#2D2D2D] bg-[#ff0073] rounded-t-xl">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-white">My Library</h3>
              <button
                type="button"
                className="p-1 text-white/80 hover:text-white transition-colors"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search and Filters */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-[#2D2D2D] space-y-2 bg-white dark:bg-[#1E1E1E]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-[#64748B]" />
                <Input
                  placeholder="Search assets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-gray-900 dark:text-[#E2E8F0] placeholder:text-gray-400 dark:placeholder:text-[#64748B] focus:border-[#ff0073] focus:ring-[#ff0073]/20"
                />
              </div>
              {/* Project Filter */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-[#64748B] min-w-[60px]">
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Project:</span>
                </div>
                <Select
                  value={filterByProject}
                  onValueChange={setFilterByProject}
                >
                  <SelectTrigger className="h-8 text-xs flex-1 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-gray-700 dark:text-[#E2E8F0]">
                    <SelectValue placeholder="All Projects" />
                  </SelectTrigger>
                  <SelectContent
                    className="bg-white dark:bg-[#1E1E1E] border-gray-200 dark:border-[#2D2D2D] z-[10000]"
                    position="popper"
                  >
                    <SelectItem value="all">All Projects</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filterByProject !== "all" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-gray-500 dark:text-[#94A3B8] hover:text-gray-700 dark:hover:text-white"
                    onClick={() => setFilterByProject("all")}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {/* Type Filter Tabs */}
            <div className="flex gap-1.5 px-4 py-2 border-b border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E]">
              <button
                type="button"
                className={`h-8 px-4 text-xs font-medium rounded-full transition-colors ${
                  typeFilter === "all"
                    ? "bg-[#ff0073] text-white"
                    : "bg-gray-100 dark:bg-[#2D2D2D] text-gray-500 dark:text-[#94A3B8] hover:bg-gray-200 dark:hover:bg-[#3D3D3D]"
                }`}
                onClick={() => setTypeFilter("all")}
              >
                All
                <span className="ml-1.5 text-[10px] opacity-70">({counts.all})</span>
              </button>
              <button
                type="button"
                className={`h-8 px-4 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                  typeFilter === "character"
                    ? "bg-[#ff0073] text-white"
                    : "bg-gray-100 dark:bg-[#2D2D2D] text-gray-500 dark:text-[#94A3B8] hover:bg-gray-200 dark:hover:bg-[#3D3D3D]"
                }`}
                onClick={() => setTypeFilter("character")}
              >
                <UserCircle className="h-3 w-3" />
                Characters
                <span className="text-[10px] opacity-70">({counts.character})</span>
              </button>
              <button
                type="button"
                className={`h-8 px-4 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                  typeFilter === "object"
                    ? "bg-[#ff0073] text-white"
                    : "bg-gray-100 dark:bg-[#2D2D2D] text-gray-500 dark:text-[#94A3B8] hover:bg-gray-200 dark:hover:bg-[#3D3D3D]"
                }`}
                onClick={() => setTypeFilter("object")}
              >
                <Package className="h-3 w-3" />
                Objects
                <span className="text-[10px] opacity-70">({counts.object})</span>
              </button>
              <button
                type="button"
                className={`h-8 px-4 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                  typeFilter === "location"
                    ? "bg-[#ff0073] text-white"
                    : "bg-gray-100 dark:bg-[#2D2D2D] text-gray-500 dark:text-[#94A3B8] hover:bg-gray-200 dark:hover:bg-[#3D3D3D]"
                }`}
                onClick={() => setTypeFilter("location")}
              >
                <MapPin className="h-3 w-3" />
                Locations
                <span className="text-[10px] opacity-70">({counts.location})</span>
              </button>
              <button
                type="button"
                className={`h-8 px-4 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                  typeFilter === "face"
                    ? "bg-[#ff0073] text-white"
                    : "bg-gray-100 dark:bg-[#2D2D2D] text-gray-500 dark:text-[#94A3B8] hover:bg-gray-200 dark:hover:bg-[#3D3D3D]"
                }`}
                onClick={() => setTypeFilter("face")}
              >
                <SmilePlus className="h-3 w-3" />
                Faces
                <span className="text-[10px] opacity-70">({counts.face})</span>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 bg-[#F8FAFC] dark:bg-[#121212]">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-[#64748B]">
                  <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#ff0073]" />
                  <p className="text-sm">Loading assets...</p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-12 text-red-500">
                  <AlertCircle className="w-8 h-8 mb-2" />
                  <p className="text-sm">{error.message || "Failed to load assets"}</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={invalidateAssets}>
                    Retry
                  </Button>
                </div>
              ) : filteredAssets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-[#64748B]">
                  <Grid3X3 className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">
                    {searchQuery || typeFilter !== "all" || filterByProject !== "all"
                      ? "No matching assets"
                      : "No saved assets"}
                  </p>
                  <p className="text-xs mt-1">
                    {searchQuery || typeFilter !== "all" || filterByProject !== "all"
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
                    const projectName = filterByProject === "all" ? getProjectName(asset.projectId) : null

                    return (
                      <div key={asset.id} className="relative group">
                        <button
                          type="button"
                          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] hover:border-[#ff0073] hover:shadow-md transition-all cursor-pointer text-left w-full"
                          onClick={() => handleAssetClick(asset)}
                          title={`View ${asset.name}`}
                        >
                          {asset.thumbnailUrl ? (
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 dark:bg-[#121212]">
                              <img
                                src={asset.thumbnailUrl}
                                alt={asset.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-[#121212] flex items-center justify-center">
                              <BadgeIcon className="w-8 h-8 text-gray-300 dark:text-[#2D2D2D]" />
                            </div>
                          )}
                          <span className="text-xs font-medium truncate w-full text-center text-gray-900 dark:text-[#E2E8F0]">{asset.name}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full uppercase font-medium text-[#ff0073] bg-[#ff0073]/10">
                            {asset.type}
                          </span>
                          {projectName && (
                            <span className="text-[9px] text-gray-400 dark:text-[#64748B] truncate w-full text-center">
                              {projectName}
                            </span>
                          )}
                          {isOnCanvas && (
                            <span className="text-[9px] text-gray-400 dark:text-[#64748B]">On canvas</span>
                          )}
                        </button>
                        {/* Add to canvas button */}
                        <button
                          type="button"
                          className="absolute bottom-8 right-1 w-6 h-6 flex items-center justify-center bg-[#ff0073] text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-[#e00066]"
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
        </div>,
        document.body
      )}

      {/* Page Modals */}
      {characterPageNodeId && (
        <Suspense fallback={null}>
          <CharacterPageModal
            characterNodeId={characterPageNodeId}
            onClose={() => {
              setCharacterPageNodeId(null)
              invalidateAssets()
            }}
          />
        </Suspense>
      )}
      {objectPageNodeId && (
        <Suspense fallback={null}>
          <ObjectPageModal
            objectNodeId={objectPageNodeId}
            onClose={() => {
              setObjectPageNodeId(null)
              invalidateAssets()
            }}
          />
        </Suspense>
      )}
      {locationPageNodeId && (
        <Suspense fallback={null}>
          <LocationPageModal
            locationNodeId={locationPageNodeId}
            onClose={() => {
              setLocationPageNodeId(null)
              invalidateAssets()
            }}
          />
        </Suspense>
      )}
    </>
  )
}
