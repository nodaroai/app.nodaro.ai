import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { Puzzle, Search, X, Loader2, FileText, Star, Coins, ExternalLink, Pencil, ToggleLeft, ToggleRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { optimizedImageUrl } from "@/lib/image"
import { toast } from "sonner"
import { getMyApps, updateApp, deactivateApp, getMonetizationDefaults } from "@/lib/api"
import type { AppBrowseCard, PublishedApp } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { calculateMonetizedCost } from "@nodaro/shared"
import { OUTPUT_TYPE_COLORS, APP_CATEGORIES, OUTPUT_TYPES, OUTPUT_TYPE_ICON } from "@/lib/app-categories"
import { AppMarketplaceCard, AppMarketplaceCardSkeleton } from "@/components/apps/app-marketplace-card"
import { ComponentPreviewModal } from "./component-preview-modal"
import {
  useAppBrowseInfinite,
  useAppFavorites,
  useToggleAppFavoriteMutation,
  type AppBrowseParams,
} from "@/hooks/queries/use-app-marketplace-queries"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ComponentMetadata } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComponentSelection {
  appSlug: string
  appVersionId: string
  pinnedVersion: number
  componentMetadata: ComponentMetadata
  label: string
  creatorName: string
  creatorId: string
  estimatedCredits: number
}

interface ComponentMarketplaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (component: ComponentSelection) => void
  /** "popup" = compact inline list (add-node / context menu), "fullscreen" = rich browser (toolbar button) */
  variant?: "popup" | "fullscreen"
  /** Position for the popup variant. Falls back to left:70, centered vertically. */
  position?: { x: number; y: number }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function browseCardToSelection(card: AppBrowseCard): ComponentSelection {
  const raw = card.componentMetadata ?? { inputs: [], outputs: [], exposedSettings: [] }
  const meta = raw as unknown as ComponentMetadata
  return {
    appSlug: card.slug,
    appVersionId: card.id,
    pinnedVersion: 0,
    componentMetadata: meta,
    label: card.name,
    creatorName: card.creatorDisplayName ?? "",
    creatorId: card.creatorId,
    estimatedCredits: card.estimatedCredits,
  }
}

function myAppToSelection(app: PublishedApp): ComponentSelection {
  const raw = app.componentMetadata ?? { inputs: [], outputs: [], exposedSettings: [] }
  const meta = raw as unknown as ComponentMetadata
  return {
    appSlug: app.slug,
    appVersionId: app.id,
    pinnedVersion: app.version,
    componentMetadata: meta,
    label: app.name,
    creatorName: app.creatorDisplayName ?? "",
    creatorId: app.creatorId ?? "",
    estimatedCredits: app.estimatedCredits,
  }
}

function publishedAppToBrowseCard(app: PublishedApp): AppBrowseCard {
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description ?? "",
    iconUrl: app.iconUrl ?? null,
    estimatedCredits: app.estimatedCredits ?? 0,
    category: app.category ?? "",
    outputTypes: app.outputTypes ?? [],
    tags: app.tags ?? [],
    previewMediaUrl: app.previewMediaUrl ?? null,
    previewMediaType: app.previewMediaType ?? null,
    supportsRemix: app.supportsRemix ?? false,
    creatorId: app.creatorId ?? "",
    creatorDisplayName: app.creatorDisplayName ?? "",
    totalRunCount: app.totalRunCount ?? 0,
    favoriteCount: app.favoriteCount ?? 0,
    publishType: "component",
    componentMetadata: app.componentMetadata,
    createdAt: app.createdAt ?? "",
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabId = "browse" | "my-components" | "favorites"

const TABS: { id: TabId; label: string }[] = [
  { id: "browse", label: "Browse" },
  { id: "my-components", label: "My Components" },
  { id: "favorites", label: "Favorites" },
]

const COMPACT_TABS: { id: TabId; label: string }[] = [
  { id: "browse", label: "Browse" },
  { id: "my-components", label: "Mine" },
  { id: "favorites", label: "Favs" },
]

const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "newest", label: "Newest" },
  { value: "most-favorited", label: "Most Favorited" },
] as const

type SortValue = (typeof SORT_OPTIONS)[number]["value"]

const OUTPUT_TYPE_FILTERS: { key: string | undefined; label: string }[] = [
  { key: undefined, label: "All" },
  { key: "image", label: "Image" },
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
  { key: "text", label: "Text" },
]

// ---------------------------------------------------------------------------
// Compact list item (popup variant)
// ---------------------------------------------------------------------------

function ComponentListItem({
  card,
  isFavorited,
  onSelect,
  isHighlighted,
  onMouseEnter,
}: {
  card: AppBrowseCard
  isFavorited: boolean
  onSelect: () => void
  isHighlighted: boolean
  onMouseEnter: () => void
}) {
  const outputTypes = card.outputTypes ?? []
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
        isHighlighted
          ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]"
          : "hover:bg-[#F8FAFC] dark:hover:bg-[#252525]",
      )}
    >
      <div className="w-7 h-7 rounded-md bg-purple-500/10 flex items-center justify-center flex-shrink-0">
        {card.iconUrl ? (
          <img src={card.iconUrl} alt="" className="w-5 h-5 rounded-sm object-cover" />
        ) : (
          <Puzzle className="w-3.5 h-3.5 text-purple-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#1E293B] dark:text-white truncate">{card.name}</div>
        <div className="text-[10px] text-[#94A3B8] truncate">{card.description || card.creatorDisplayName || "Community"}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {outputTypes.slice(0, 2).map((t) => (
          <span key={t} className="text-[#94A3B8]">{OUTPUT_TYPE_ICON[t] ?? <FileText className="w-3 h-3" />}</span>
        ))}
      </div>
      {card.estimatedCredits > 0 && (
        <span className="text-[10px] text-purple-400 font-medium flex items-center gap-0.5 flex-shrink-0">
          <Coins className="w-2.5 h-2.5" />{card.estimatedCredits}
        </span>
      )}
      {isFavorited && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 flex-shrink-0" />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ComponentMarketplaceModal({ open, onOpenChange, onSelect, variant = "popup", position }: ComponentMarketplaceModalProps) {
  const isFullscreen = variant === "fullscreen"
  const [activeTab, setActiveTab] = useState<TabId>("browse")
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [sortBy, setSortBy] = useState<SortValue>("popular")
  const [outputTypeFilter, setOutputTypeFilter] = useState<string | undefined>(undefined)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [previewCard, setPreviewCard] = useState<AppBrowseCard | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    if (open) setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (!open || previewCard) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, previewCard, onOpenChange])

  // Click outside (popup variant only)
  useEffect(() => {
    if (!open || isFullscreen) return
    function handleClickOutside(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open, isFullscreen, onOpenChange])

  const browseParams: AppBrowseParams = useMemo(() => ({
    search: debouncedSearch || undefined,
    outputType: isFullscreen ? outputTypeFilter : undefined,
    sort: sortBy,
    favoritesOnly: activeTab === "favorites" ? true : undefined,
    publishType: "component" as const,
  }), [debouncedSearch, outputTypeFilter, sortBy, activeTab, isFullscreen])

  const {
    data: browseData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: browseLoading,
  } = useAppBrowseInfinite(browseParams)

  const browseItems = useMemo(
    () => browseData?.pages.flatMap((p) => p.data) ?? [],
    [browseData],
  )

  const { data: favoriteIds = [] } = useAppFavorites()
  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const favMutation = useToggleAppFavoriteMutation()

  const { data: allMyApps, isLoading: myAppsLoading } = useQuery({
    queryKey: ["my-apps"],
    queryFn: getMyApps,
    enabled: activeTab === "my-components",
    staleTime: 60_000,
  })

  // Only show latest version per slug — older versions are superseded
  const myComponents = useMemo(() => {
    const all = (allMyApps ?? []).filter((a) => a.publishType === "component")
    const bySlug = new Map<string, PublishedApp>()
    for (const app of all) {
      const existing = bySlug.get(app.slug)
      if (!existing || app.version > existing.version) bySlug.set(app.slug, app)
    }
    return [...bySlug.values()]
  }, [allMyApps])

  const myComponentsAsBrowseCards: AppBrowseCard[] = useMemo(
    () => myComponents.map(publishedAppToBrowseCard),
    [myComponents],
  )

  // Management mutations for My Components tab
  const qc = useQueryClient()
  const toggleListMutation = useMutation({
    mutationFn: async ({ appId, isListed }: { appId: string; isListed: boolean }) => {
      await updateApp(appId, { isListed })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-apps"] })
      qc.invalidateQueries({ queryKey: ["app-marketplace"] })
      toast.success("Updated")
    },
  })
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ appId, isActive }: { appId: string; isActive: boolean }) => {
      if (isActive) await updateApp(appId, { isActive: true })
      else await deactivateApp(appId)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-apps"] }) },
  })

  // Edit dialog
  const [editComp, setEditComp] = useState<PublishedApp | null>(null)
  const editMutation = useMutation({
    mutationFn: async ({ appId, data }: { appId: string; data: Record<string, unknown> }) => {
      await updateApp(appId, data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-apps"] })
      qc.invalidateQueries({ queryKey: ["app-marketplace"] })
      setEditComp(null)
      toast.success("Component updated")
    },
    onError: (err: Error) => { toast.error(err.message || "Failed to update") },
  })

  const scrollRef = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage })
  scrollRef.current = { hasNextPage, isFetchingNextPage, fetchNextPage }

  useEffect(() => {
    if (activeTab !== "browse" && activeTab !== "favorites") return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        const { hasNextPage: hn, isFetchingNextPage: ifn, fetchNextPage: fn } = scrollRef.current
        if (entries[0]?.isIntersecting && hn && !ifn) fn()
      },
      { rootMargin: isFullscreen ? "800px" : "400px" },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [activeTab, isFullscreen])

  const handleToggleFavorite = useCallback(
    (id: string) => favMutation.mutate({ appId: id }),
    [favMutation],
  )

  const handleSelectBrowseCard = useCallback(
    (card: AppBrowseCard) => {
      onSelect(browseCardToSelection(card))
      onOpenChange(false)
    },
    [onSelect, onOpenChange],
  )

  const handleSelectMyComponent = useCallback(
    (card: AppBrowseCard) => {
      const original = myComponents.find((a) => a.id === card.id)
      onSelect(original ? myAppToSelection(original) : browseCardToSelection(card))
      onOpenChange(false)
    },
    [myComponents, onSelect, onOpenChange],
  )

  const currentItems = activeTab === "my-components" ? myComponentsAsBrowseCards : browseItems
  const onCardSelect = activeTab === "my-components" ? handleSelectMyComponent : handleSelectBrowseCard

  // Keyboard nav (popup variant)
  useEffect(() => {
    if (!open || isFullscreen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlightedIndex((prev) => Math.min(prev + 1, currentItems.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlightedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const item = currentItems[highlightedIndex]
        if (item) onCardSelect(item)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, isFullscreen, currentItems, highlightedIndex, onCardSelect])

  useEffect(() => { setHighlightedIndex(0) }, [searchInput, activeTab])

  useEffect(() => {
    if (open) {
      setActiveTab("browse")
      setSearchInput("")
      setDebouncedSearch("")
      setSortBy("popular")
      setOutputTypeFilter(undefined)
      setPreviewCard(null)
    }
  }, [open])

  if (!open) return null

  const isLoading = (activeTab === "browse" || activeTab === "favorites") ? browseLoading : myAppsLoading

  // =========================================================================
  // Fullscreen variant (toolbar button)
  // =========================================================================
  if (isFullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Puzzle className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Components</h2>
              <p className="text-xs text-muted-foreground">Browse reusable workflow components from the community</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs + Filters */}
        <div className="px-6 py-3 border-b border-border space-y-3 shrink-0">
          <div className="flex items-center gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-colors",
                  activeTab === tab.id
                    ? "bg-purple-500/10 text-purple-400 font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-[360px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder="Search components..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortValue)}>
              <SelectTrigger className="w-[160px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1.5">
              {OUTPUT_TYPE_FILTERS.map((filter) => {
                const isActive = outputTypeFilter === filter.key
                let pillClass: string
                if (isActive) {
                  pillClass = filter.key === undefined
                    ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
                    : (OUTPUT_TYPE_COLORS[filter.key] ?? "bg-muted text-muted-foreground border-transparent")
                } else {
                  pillClass = "bg-muted text-muted-foreground border-transparent"
                }
                return (
                  <button
                    key={filter.label}
                    type="button"
                    onClick={() => setOutputTypeFilter(filter.key)}
                    className={cn(
                      "px-2.5 py-1 text-xs rounded-full border transition-colors",
                      pillClass,
                      !isActive && "hover:text-foreground",
                    )}
                  >
                    {filter.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Card Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <AppMarketplaceCardSkeleton key={i} />
              ))}
            </div>
          ) : currentItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Puzzle className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm font-medium">
                {activeTab === "my-components"
                  ? "You haven't published any components yet"
                  : activeTab === "favorites"
                    ? "No favorited components"
                    : "No components found"}
              </p>
              <p className="text-xs mt-1 opacity-70">
                {activeTab === "browse" && debouncedSearch
                  ? "Try different search terms"
                  : activeTab === "my-components"
                    ? "Publish a workflow as a component to see it here"
                    : "Components will appear here as creators publish them"}
              </p>
            </div>
          ) : activeTab === "my-components" ? (
            (() => {
              const activeComps = myComponents.filter((c) => c.isActive !== false)
              const archivedComps = myComponents.filter((c) => c.isActive === false)

              const renderCard = (comp: PublishedApp) => (
                <div key={comp.id} className="bg-card border border-border rounded-xl p-4 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-foreground truncate">{comp.name}</h3>
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">/app/{comp.slug}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition-colors",
                          comp.isListed
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                            : "bg-zinc-100 dark:bg-zinc-800 text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700",
                        )}
                        onClick={() => toggleListMutation.mutate({ appId: comp.id, isListed: !comp.isListed })}
                        title={comp.isListed ? "Click to unlist" : "Click to list on marketplace"}
                      >
                        {comp.isListed ? "Listed" : "Unlisted"}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">v{comp.version}</span>
                    </div>
                  </div>
                  {comp.description && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{comp.description}</p>}
                  {comp.previewMediaUrl && (
                    <div className="mb-2 rounded-md overflow-hidden aspect-video bg-zinc-100 dark:bg-zinc-800">
                      <img src={optimizedImageUrl(comp.previewMediaUrl)} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
                    <span>{comp.totalRunCount ?? 0} runs</span>
                    <span>{comp.estimatedCredits ?? 0} CR/run</span>
                    {(comp.favoriteCount ?? 0) > 0 && <span>{comp.favoriteCount} favs</span>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <a href={`/app/${comp.slug}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                        <ExternalLink className="h-3 w-3 mr-1" /> Open
                      </Button>
                    </a>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditComp(comp)}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button
                      variant={comp.isActive === false ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2 text-xs ml-auto"
                      onClick={() => toggleActiveMutation.mutate({ appId: comp.id, isActive: comp.isActive === false })}
                    >
                      {comp.isActive === false ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </div>
              )

              return (
                <div className="space-y-6">
                  {activeComps.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {activeComps.map(renderCard)}
                    </div>
                  )}
                  {archivedComps.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground mb-3">Archived</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
                        {archivedComps.map(renderCard)}
                      </div>
                    </div>
                  )}
                  <ComponentEditDialog
                    comp={editComp}
                    open={editComp !== null}
                    onOpenChange={(o) => { if (!o) setEditComp(null) }}
                    onSave={(appId, data) => editMutation.mutate({ appId, data })}
                    isSaving={editMutation.isPending}
                  />
                </div>
              )
            })()
          ) : (
            // Intentionally NOT row-virtualized (Batch E): variable-height
            // cards + only 20/page make windowing low-payoff here.
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {currentItems.map((card) => (
                <AppMarketplaceCard
                  key={card.id}
                  app={card}
                  isFavorited={favSet.has(card.id)}
                  onToggleFavorite={handleToggleFavorite}
                  onPreview={setPreviewCard}
                  onSelect={onCardSelect}
                />
              ))}
            </div>
          )}

          {isFetchingNextPage && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {(activeTab === "browse" || activeTab === "favorites") && (
            <div ref={sentinelRef} className="h-1" />
          )}
        </div>

        <ComponentPreviewModal
          card={previewCard}
          isFavorited={previewCard ? favSet.has(previewCard.id) : false}
          onToggleFavorite={handleToggleFavorite}
          onAdd={(card) => onCardSelect(card)}
          onClose={() => setPreviewCard(null)}
        />
      </div>,
      document.body,
    )
  }

  // =========================================================================
  // Popup variant (add-node / context menu)
  // =========================================================================
  return createPortal(
    <>
      <div className="fixed inset-0 z-[99]" />
      <div
        ref={popupRef}
        className={cn(
          "fixed z-[100] w-80",
          "bg-white dark:bg-[#1E1E1E]",
          "border border-[#E2E8F0] dark:border-[#2D2D2D]",
          "rounded-xl shadow-xl",
          "overflow-hidden",
        )}
        style={position
          ? { left: position.x, top: position.y }
          : { left: 70, top: "50%", transform: "translateY(-50%)" }
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#E2E8F0] dark:border-[#2D2D2D]">
          <div className="flex items-center gap-2">
            <Puzzle className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold text-[#1E293B] dark:text-white">Components</span>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 px-3 pt-2 pb-1">
          {COMPACT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-2 py-1 text-[11px] rounded-md transition-colors",
                activeTab === tab.id
                  ? "bg-purple-500/10 text-purple-400 font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-3 py-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#94A3B8]" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search components..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className={cn(
                "w-full pl-8 pr-3 py-1.5 text-sm",
                "bg-[#F8FAFC] dark:bg-[#121212]",
                "border border-[#E2E8F0] dark:border-[#2D2D2D]",
                "rounded-lg",
                "text-[#1E293B] dark:text-white",
                "placeholder:text-[#94A3B8]",
                "focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500",
              )}
            />
          </div>
        </div>

        {/* List */}
        <div className="max-h-72 overflow-y-auto py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : currentItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Puzzle className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-xs">
                {activeTab === "my-components"
                  ? "No components published yet"
                  : activeTab === "favorites"
                    ? "No favorites"
                    : debouncedSearch
                      ? "No results"
                      : "No components available"}
              </p>
            </div>
          ) : (
            currentItems.map((card, index) => (
              <ComponentListItem
                key={card.id}
                card={card}
                isFavorited={favSet.has(card.id)}
                onSelect={() => onCardSelect(card)}
                isHighlighted={index === highlightedIndex}
                onMouseEnter={() => setHighlightedIndex(index)}
              />
            ))
          )}

          {isFetchingNextPage && (
            <div className="flex justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {(activeTab === "browse" || activeTab === "favorites") && (
            <div ref={sentinelRef} className="h-1" />
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-[#E2E8F0] dark:border-[#2D2D2D] bg-[#F8FAFC] dark:bg-[#121212]">
          <div className="flex items-center gap-3 text-[10px] text-[#94A3B8]">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white dark:bg-[#2D2D2D] rounded border border-[#E2E8F0] dark:border-[#3D3D3D]">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white dark:bg-[#2D2D2D] rounded border border-[#E2E8F0] dark:border-[#3D3D3D]">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white dark:bg-[#2D2D2D] rounded border border-[#E2E8F0] dark:border-[#3D3D3D]">Esc</kbd>
              Close
            </span>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Component Edit Dialog (name, description, category, tags, monetization)
// ---------------------------------------------------------------------------

function ComponentEditDialog({
  comp,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  comp: PublishedApp | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (appId: string, data: Record<string, unknown>) => void
  isSaving: boolean
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("other")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [isListed, setIsListed] = useState(false)
  const [monetizationEnabled, setMonetizationEnabled] = useState(false)
  const [monetizationFlatFee, setMonetizationFlatFee] = useState(0)
  const [monetizationPercent, setMonetizationPercent] = useState(0)

  useEffect(() => {
    if (comp && open) {
      setName(comp.name ?? "")
      setDescription(comp.description ?? "")
      setCategory(comp.category ?? "other")
      setTags(comp.tags ?? [])
      setTagInput("")
      setIsListed(comp.isListed ?? false)
      setMonetizationEnabled(comp.monetizationEnabled ?? false)
      setMonetizationFlatFee(comp.monetizationFlatFee ?? 0)
      setMonetizationPercent(comp.monetizationPercent ?? 0)
    }
  }, [comp, open])

  const handleToggleMonetization = useCallback(async (enabled: boolean) => {
    setMonetizationEnabled(enabled)
    if (enabled && monetizationFlatFee === 0 && monetizationPercent === 0) {
      try {
        const defaults = await getMonetizationDefaults()
        setMonetizationFlatFee(defaults.flatFee)
        setMonetizationPercent(defaults.percent)
      } catch { /* user can set manually */ }
    }
  }, [monetizationFlatFee, monetizationPercent])

  const baseCredits = comp?.baseEstimatedCredits ?? 0
  const calculatedCredits = monetizationEnabled
    ? calculateMonetizedCost(baseCredits, monetizationFlatFee, monetizationPercent)
    : baseCredits

  const handleSave = useCallback(() => {
    if (!comp || !name.trim()) return
    const data: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim(),
      category,
      tags,
      isListed,
    }
    if (hasCredits()) {
      data.monetizationEnabled = monetizationEnabled
      data.monetizationFlatFee = monetizationFlatFee
      data.monetizationPercent = monetizationPercent
    }
    onSave(comp.id, data)
  }, [comp, name, description, category, tags, isListed, monetizationEnabled, monetizationFlatFee, monetizationPercent, onSave])

  if (!comp) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Component</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-1 block">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Component name" />
          </div>
          <div>
            <Label className="text-sm font-medium mb-1 block">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this component do?" />
          </div>
          <div>
            <Label className="text-sm font-medium mb-1.5 block">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {APP_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-medium mb-1.5 block">
              Tags <span className="text-xs text-muted-foreground font-normal">({tags.length}/10)</span>
            </Label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 text-[11px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                    {tag}
                    <button type="button" onClick={() => setTags(tags.filter((t) => t !== tag))} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Add a tag..."
                className="h-8 text-xs flex-1"
                maxLength={30}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    const trimmed = tagInput.trim().toLowerCase()
                    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
                      setTags([...tags, trimmed])
                      setTagInput("")
                    }
                  }
                }}
                disabled={tags.length >= 10}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => {
                  const trimmed = tagInput.trim().toLowerCase()
                  if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
                    setTags([...tags, trimmed])
                    setTagInput("")
                  }
                }}
                disabled={!tagInput.trim() || tags.length >= 10}
              >
                Add
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Listed on marketplace</p>
              <p className="text-xs text-muted-foreground">Make discoverable in the component browser</p>
            </div>
            <Switch checked={isListed} onCheckedChange={setIsListed} />
          </div>

          {hasCredits() && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Monetization</p>
                  <p className="text-xs text-muted-foreground">Charge a markup when others use this component</p>
                </div>
                <Switch checked={monetizationEnabled} onCheckedChange={handleToggleMonetization} />
              </div>
              {monetizationEnabled && (
                <div className="space-y-3 pl-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Flat fee (CR)</Label>
                      <Input type="number" min={0} value={monetizationFlatFee} onChange={(e) => setMonetizationFlatFee(Math.max(0, Number(e.target.value) || 0))} className="h-8 text-xs mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Percentage (%)</Label>
                      <Input type="number" min={0} max={500} value={monetizationPercent} onChange={(e) => setMonetizationPercent(Math.min(500, Math.max(0, Number(e.target.value) || 0)))} className="h-8 text-xs mt-1" />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Base cost: {baseCredits} CR | Users will pay: {calculatedCredits} CR
                  </p>
                </div>
              )}
            </div>
          )}

          <Button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="w-full text-white hover:opacity-90"
            style={{ backgroundColor: "#ff0073" }}
          >
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
