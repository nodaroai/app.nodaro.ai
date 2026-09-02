import { useState, useMemo } from "react"
import { X, Loader2, AlertCircle, Search, UserCircle, Package, PawPrint, MapPin, SmilePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import { useAuth } from "@/hooks/use-auth"
import { useCharacters, useObjects, useCreatures, useLocations, useFaces } from "@/hooks/queries/use-assets-queries"
import { CachedImage } from "@/components/ui/cached-image"
import { cn } from "@/lib/utils"

type AssetType = "all" | "character" | "object" | "creature" | "location" | "face"

export interface SelectedAsset {
  id: string
  name: string
  type: "character" | "object" | "creature" | "location" | "face"
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

const ASSET_TYPE_KEYS = {
  character: "cfgext.assetTypeCharacter",
  object: "cfgext.assetTypeObject",
  creature: "cfgext.assetTypeCreature",
  location: "cfgext.assetTypeLocation",
  face: "cfgext.assetTypeFace",
} as const

interface UnifiedAsset {
  id: string
  name: string
  type: "character" | "object" | "creature" | "location" | "face"
  thumbnailUrl?: string
  description?: string
}

export function AssetSelectionModal({
  isOpen,
  onClose,
  onSelect,
  title,
  excludeIds = [],
}: AssetSelectionModalProps) {
  const t = useT()
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<AssetType>("all")

  const { data: characters = [], isLoading: loadingChars, error: charError } = useCharacters(undefined, user?.id)
  const { data: objects = [], isLoading: loadingObjs, error: objError } = useObjects(undefined, user?.id)
  const { data: creatures = [], isLoading: loadingCreatures, error: creatureError } = useCreatures(undefined, user?.id)
  const { data: locations = [], isLoading: loadingLocs, error: locError } = useLocations(undefined, user?.id)
  const { data: faces = [], isLoading: loadingFaces, error: faceError } = useFaces(undefined, user?.id)

  const loading = loadingChars || loadingObjs || loadingCreatures || loadingLocs || loadingFaces
  const error = charError || objError || creatureError || locError || faceError

  const assets = useMemo(() => {
    const unified: UnifiedAsset[] = [
      ...characters.map((c): UnifiedAsset => ({
        id: c.id,
        name: c.name,
        type: "character",
        thumbnailUrl: c.sourceImageUrl ?? undefined,
        description: c.description ?? undefined,
      })),
      ...objects.map((o): UnifiedAsset => ({
        id: o.id,
        name: o.name,
        type: "object",
        thumbnailUrl: o.sourceImageUrl ?? undefined,
        description: o.description ?? undefined,
      })),
      ...creatures.map((c): UnifiedAsset => ({
        id: c.id,
        name: c.name,
        type: "creature",
        thumbnailUrl: c.sourceImageUrl ?? undefined,
        description: c.description ?? undefined,
      })),
      ...locations.map((l): UnifiedAsset => ({
        id: l.id,
        name: l.name,
        type: "location",
        thumbnailUrl: l.sourceImageUrl ?? undefined,
        description: l.description ?? undefined,
      })),
      ...faces.map((f): UnifiedAsset => ({
        id: f.id,
        name: f.name,
        type: "face",
        thumbnailUrl: f.sourceImageUrl ?? undefined,
        description: f.description ?? undefined,
      })),
    ]
    return unified
  }, [characters, objects, creatures, locations, faces])

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
      creature: filtered.filter((a) => a.type === "creature").length,
      location: filtered.filter((a) => a.type === "location").length,
      face: filtered.filter((a) => a.type === "face").length,
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
        role="dialog"
        aria-modal="true"
        className="bg-card rounded-xl shadow-2xl border w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{title ?? t("cfgext.assetModalTitle")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("common.close")}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Search and Filters */}
        <div className="p-4 border-b space-y-3">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t("cfgext.assetModalSearchPh")}
              aria-label={t("cfgext.assetModalSearchAria")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ps-9"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant={typeFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter("all")}
              className="text-xs"
            >
              {t("cfgext.assetModalAll", { count: counts.all })}
            </Button>
            <Button
              variant={typeFilter === "character" ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter("character")}
              className={cn("text-xs", typeFilter === "character" && "bg-pink-500 hover:bg-pink-600")}
            >
              <UserCircle className="w-3.5 h-3.5 me-1" />
              {t("cfgext.assetModalCharacters", { count: counts.character })}
            </Button>
            <Button
              variant={typeFilter === "object" ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter("object")}
              className={cn("text-xs", typeFilter === "object" && "bg-emerald-500 hover:bg-emerald-600")}
            >
              <Package className="w-3.5 h-3.5 me-1" />
              {t("cfgext.assetModalObjects", { count: counts.object })}
            </Button>
            <Button
              variant={typeFilter === "creature" ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter("creature")}
              className={cn("text-xs", typeFilter === "creature" && "bg-[#A78BFA] hover:bg-[#9170f0]")}
            >
              <PawPrint className="w-3.5 h-3.5 me-1" />
              {t("cfgext.assetModalCreatures", { count: counts.creature })}
            </Button>
            <Button
              variant={typeFilter === "location" ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter("location")}
              className={cn("text-xs", typeFilter === "location" && "bg-cyan-500 hover:bg-cyan-600")}
            >
              <MapPin className="w-3.5 h-3.5 me-1" />
              {t("cfgext.assetModalLocations", { count: counts.location })}
            </Button>
            <Button
              variant={typeFilter === "face" ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter("face")}
              className={cn("text-xs", typeFilter === "face" && "bg-violet-500 hover:bg-violet-600")}
            >
              <SmilePlus className="w-3.5 h-3.5 me-1" />
              {t("cfgext.assetModalFaces", { count: counts.face })}
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <p className="text-sm">{t("cfgext.assetModalLoading")}</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-destructive">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p className="text-sm">{error.message || t("cfgext.assetModalLoadFailed")}</p>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">
                {assets.length === 0
                  ? t("cfgext.assetModalEmpty")
                  : t("cfgext.assetModalNoMatch")}
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
                    asset.type === "creature" && "hover:border-[#A78BFA]/50",
                    asset.type === "location" && "hover:border-cyan-500/50",
                    asset.type === "face" && "hover:border-violet-500/50",
                  )}
                >
                  {asset.thumbnailUrl ? (
                    <CachedImage
                      src={asset.thumbnailUrl}
                      alt={asset.name}
                      className="w-full aspect-square object-cover rounded-md"
                      thumbnail
                      thumbnailWidth={320}
                    />
                  ) : (
                    <div className={cn(
                      "w-full aspect-square rounded-md flex items-center justify-center",
                      asset.type === "character" && "bg-pink-500/10",
                      asset.type === "object" && "bg-emerald-500/10",
                      asset.type === "creature" && "bg-[#A78BFA]/10",
                      asset.type === "location" && "bg-cyan-500/10",
                      asset.type === "face" && "bg-violet-500/10",
                    )}>
                      {asset.type === "character" && <UserCircle className="w-8 h-8 text-pink-500/50" />}
                      {asset.type === "object" && <Package className="w-8 h-8 text-emerald-500/50" />}
                      {asset.type === "creature" && <PawPrint className="w-8 h-8 text-[#A78BFA]/50" />}
                      {asset.type === "location" && <MapPin className="w-8 h-8 text-cyan-500/50" />}
                      {asset.type === "face" && <SmilePlus className="w-8 h-8 text-violet-500/50" />}
                    </div>
                  )}
                  <span className="text-xs font-medium mt-1.5 truncate w-full text-center">{asset.name}</span>
                  <span className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded mt-0.5",
                    asset.type === "character" && "bg-pink-500/10 text-pink-500",
                    asset.type === "object" && "bg-emerald-500/10 text-emerald-500",
                    asset.type === "creature" && "bg-[#A78BFA]/10 text-[#A78BFA]",
                    asset.type === "location" && "bg-cyan-500/10 text-cyan-500",
                    asset.type === "face" && "bg-violet-500/10 text-violet-500",
                  )}>
                    {t(ASSET_TYPE_KEYS[asset.type])}
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
