import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { Puzzle, Search, X, Loader2, ImageIcon, Video, AudioLines, FileText, Star, Coins } from "lucide-react"
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

const OUTPUT_TYPE_ICON: Record<string, React.ReactNode> = {
  image: <ImageIcon className="w-3 h-3" />,
  video: <Video className="w-3 h-3" />,
  audio: <AudioLines className="w-3 h-3" />,
  text: <FileText className="w-3 h-3" />,
}

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
        <div className="text-[10px] text-[#94A3B8] truncate">{card.creatorDisplayName || "Community"}</div>
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
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onOpenChange])

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

          {isFetchingNextPage && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {(activeTab === "browse" || activeTab === "favorites") && (
            <div ref={sentinelRef} className="h-1" />
          )}
        </div>
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
