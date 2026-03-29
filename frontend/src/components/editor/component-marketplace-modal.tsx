import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { Puzzle, Search, X, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { getMyApps } from "@/lib/api"
import type { AppBrowseCard, PublishedApp } from "@/lib/api"
import { OUTPUT_TYPE_COLORS } from "@/lib/app-categories"
import { AppMarketplaceCard, AppMarketplaceCardSkeleton } from "@/components/apps/app-marketplace-card"
import {
  useAppBrowseInfinite,
  useAppFavorites,
  useToggleAppFavoriteMutation,
  type AppBrowseParams,
} from "@/hooks/queries/use-app-marketplace-queries"
import { useQuery } from "@tanstack/react-query"
import type { ComponentMetadata } from "@nodaro-shared/component-types"

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
// Component
// ---------------------------------------------------------------------------

export function ComponentMarketplaceModal({ open, onOpenChange, onSelect }: ComponentMarketplaceModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("browse")
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [sortBy, setSortBy] = useState<SortValue>("popular")
  const [outputTypeFilter, setOutputTypeFilter] = useState<string | undefined>(undefined)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onOpenChange])

  const browseParams: AppBrowseParams = useMemo(() => ({
    search: debouncedSearch || undefined,
    outputType: outputTypeFilter,
    sort: sortBy,
    favoritesOnly: activeTab === "favorites" ? true : undefined,
    publishType: "component" as const,
  }), [debouncedSearch, outputTypeFilter, sortBy, activeTab])

  // Browse query (used for "browse" and "favorites" tabs)
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

  const myComponents = useMemo(
    () => (allMyApps ?? []).filter((a) => a.publishType === "component"),
    [allMyApps],
  )

  const myComponentsAsBrowseCards: AppBrowseCard[] = useMemo(
    () => myComponents.map(publishedAppToBrowseCard),
    [myComponents],
  )

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
      { rootMargin: "800px" },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [activeTab])

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

  useEffect(() => {
    if (open) {
      setActiveTab("browse")
      setSearchInput("")
      setDebouncedSearch("")
      setSortBy("popular")
      setOutputTypeFilter(undefined)
    }
  }, [open])

  if (!open) return null

  const isLoading = (activeTab === "browse" || activeTab === "favorites") ? browseLoading : myAppsLoading
  const currentItems = activeTab === "my-components" ? myComponentsAsBrowseCards : browseItems
  const onCardSelect = activeTab === "my-components" ? handleSelectMyComponent : handleSelectBrowseCard

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
        {/* Tabs */}
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

        {/* Search + Sort + Output type pills */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-[360px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
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
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            {OUTPUT_TYPE_FILTERS.map((filter) => {
              const isActive = outputTypeFilter === filter.key
              let pillClass: string
              if (isActive) {
                if (filter.key === undefined) {
                  pillClass = "bg-purple-500/10 text-purple-400 border-purple-500/30"
                } else {
                  pillClass = OUTPUT_TYPE_COLORS[filter.key] ?? "bg-muted text-muted-foreground border-transparent"
                }
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
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {currentItems.map((card) => (
              <AppMarketplaceCard
                key={card.id}
                app={card}
                isFavorited={favSet.has(card.id)}
                onToggleFavorite={handleToggleFavorite}
                onSelect={onCardSelect}
              />
            ))}
          </div>
        )}

        {/* Loading more indicator */}
        {isFetchingNextPage && (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Infinite scroll sentinel */}
        {(activeTab === "browse" || activeTab === "favorites") && (
          <div ref={sentinelRef} className="h-1" />
        )}
      </div>
    </div>,
    document.body,
  )
}
