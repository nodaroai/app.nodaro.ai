import { useState, useEffect, useMemo, useRef } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Compass, Search, X, SlidersHorizontal, Heart } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  browseCommunity,
  getCommunityFavorites,
  type CommunityCard as CommunityCardData,
} from "@/lib/api"
import {
  CommunityCard,
  CommunityCardSkeleton,
} from "@/ee/components/community/community-card"
import { CommunityPreviewModal } from "@/ee/components/community/community-preview-modal"

type EntityType = "character" | "location" | "object"
type ViewMode = "browse" | "favorites"
type SortMode = "popular" | "newest"

const ENTITY_TABS: { value: EntityType; label: string }[] = [
  { value: "character", label: "Characters" },
  { value: "location", label: "Locations" },
  { value: "object", label: "Objects" },
]

export default function ExplorePage() {
  const [entityType, setEntityType] = useState<EntityType>("character")
  const [view, setView] = useState<ViewMode>("browse")
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [sort, setSort] = useState<SortMode>("popular")
  const sentinelRef = useRef<HTMLDivElement>(null)

  const [selected, setSelected] = useState<CommunityCardData | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Debounce search (mirror templates page)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Browse (infinite)
  const {
    data: browseData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: browseLoading,
  } = useInfiniteQuery({
    queryKey: ["community", entityType, view, debouncedSearch, sort],
    queryFn: ({ pageParam }) =>
      browseCommunity({
        entityType,
        q: debouncedSearch || undefined,
        sort,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: view === "browse",
  })

  const browseItems = useMemo(
    () => browseData?.pages.flatMap((p) => p.data) ?? [],
    [browseData],
  )

  // Favorites (flat). Filter to the active entity tab client-side so the tab
  // selector stays meaningful in this view too.
  const { data: favoritesData, isLoading: favoritesLoading } = useQuery({
    queryKey: ["community", "favorites"],
    queryFn: getCommunityFavorites,
    enabled: view === "favorites",
  })

  const favoriteItems = useMemo(
    () => (favoritesData?.data ?? []).filter((c) => c.entity_type === entityType),
    [favoritesData, entityType],
  )

  // Infinite scroll observer (browse only)
  useEffect(() => {
    if (view !== "browse") return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { rootMargin: "800px" },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [view, hasNextPage, isFetchingNextPage, fetchNextPage])

  const items = view === "browse" ? browseItems : favoriteItems
  const isLoading = view === "browse" ? browseLoading : favoritesLoading

  const openPreview = (item: CommunityCardData) => {
    setSelected(item)
    setPreviewOpen(true)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Explore</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Discover community-shared characters, locations, and objects
        </p>
      </div>

      {/* Controls */}
      <div className="space-y-4 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Entity tabs */}
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg p-1">
            {ENTITY_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  entityType === tab.value
                    ? "bg-white dark:bg-zinc-700 text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setEntityType(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg p-1">
            <button
              type="button"
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                view === "browse"
                  ? "bg-white dark:bg-zinc-700 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setView("browse")}
            >
              Browse
            </button>
            <button
              type="button"
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5",
                view === "favorites"
                  ? "bg-white dark:bg-zinc-700 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setView("favorites")}
            >
              <Heart className="h-3.5 w-3.5" />
              Favorites
            </button>
          </div>

          {/* Search (browse only) */}
          {view === "browse" && (
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search community..."
                className="pl-9 h-9"
              />
              {searchInput && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchInput("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Sort (browse only) */}
          {view === "browse" && (
            <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
              <SelectTrigger className="w-[150px] h-9">
                <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="popular">Popular</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <CommunityCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <Compass className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {view === "favorites" ? "No favorites yet" : "Nothing here yet"}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {view === "favorites"
              ? "Heart listings you like to save them here."
              : debouncedSearch
                ? "Try adjusting your search."
                : "Be the first to share something with the community!"}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {items.map((item) => (
              <CommunityCard key={item.id} item={item} onClick={() => openPreview(item)} />
            ))}
            {view === "browse" &&
              isFetchingNextPage &&
              Array.from({ length: 5 }).map((_, i) => (
                <CommunityCardSkeleton key={`skel-${i}`} />
              ))}
          </div>
          {view === "browse" && <div ref={sentinelRef} className="h-1" />}
        </>
      )}

      {/* Preview modal */}
      <CommunityPreviewModal
        item={selected}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  )
}
