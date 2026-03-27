import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Puzzle, Search, Heart, Loader2, User, Play, Star } from "lucide-react"
import { browseApps, getMyApps } from "@/lib/api"
import type { AppBrowseCard, PublishedApp } from "@/lib/api"
import type { ComponentMetadata } from "@nodaro-shared/component-types"

interface ComponentBrowserProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (component: {
    appSlug: string
    appVersionId: string
    pinnedVersion: number
    componentMetadata: ComponentMetadata
    label: string
    creatorName: string
    creatorId: string
    estimatedCredits: number
  }) => void
}

type TabId = "browse" | "my-components" | "favorites"

const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "newest", label: "Newest" },
  { value: "most-favorited", label: "Most Favorited" },
] as const

type SortValue = (typeof SORT_OPTIONS)[number]["value"]

/** Convert AppBrowseCard to the shape onSelect expects */
function browseCardToSelection(card: AppBrowseCard) {
  const raw = card.componentMetadata ?? { inputs: [], outputs: [], exposedSettings: [] }
  const meta = raw as unknown as ComponentMetadata
  return {
    appSlug: card.slug,
    appVersionId: card.id,
    pinnedVersion: 0, // browse cards don't carry version; the node will resolve latest
    componentMetadata: meta,
    label: card.name,
    creatorName: card.creatorDisplayName ?? "",
    creatorId: card.creatorId,
    estimatedCredits: card.estimatedCredits,
  }
}

/** Convert PublishedApp (mine) to the shape onSelect expects */
function myAppToSelection(app: PublishedApp) {
  const raw = app.componentMetadata ?? { inputs: [], outputs: [], exposedSettings: [] }
  const meta = raw as unknown as ComponentMetadata
  return {
    appSlug: app.slug,
    appVersionId: app.id,
    pinnedVersion: app.version,
    componentMetadata: meta,
    label: app.name,
    creatorName: app.creatorDisplayName ?? "",
    creatorId: app.creatorId,
    estimatedCredits: app.estimatedCredits,
  }
}

const TYPE_COLORS: Record<string, string> = {
  image: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  video: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  audio: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  text: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
}

function IOTypePills({ metadata }: { metadata: ComponentMetadata | null }) {
  if (!metadata) return null
  const types = new Set<string>()
  for (const h of metadata.inputs ?? []) types.add(h.type)
  for (const h of metadata.outputs ?? []) types.add(h.type)
  if (types.size === 0) return null

  return (
    <div className="flex gap-1 flex-wrap">
      {Array.from(types).map((t) => (
        <span
          key={t}
          className={`text-[9px] px-1.5 py-0 rounded-full border ${TYPE_COLORS[t] ?? "bg-muted text-muted-foreground border-border"}`}
        >
          {t}
        </span>
      ))}
    </div>
  )
}

function ComponentCard({
  name,
  creatorName,
  estimatedCredits,
  runCount,
  favoriteCount,
  metadata,
  onClick,
}: {
  name: string
  creatorName: string | null
  estimatedCredits: number
  runCount: number
  favoriteCount: number
  metadata: ComponentMetadata | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 w-8 h-8 rounded-md bg-[#ff0073]/10 flex items-center justify-center">
          <Puzzle className="w-4 h-4 text-[#ff0073]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{name}</p>
          {creatorName && (
            <div className="flex items-center gap-1 mt-0.5">
              <User className="w-2.5 h-2.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground truncate">
                {creatorName}
              </span>
            </div>
          )}
        </div>
        {estimatedCredits > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
            {estimatedCredits} CR
          </Badge>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <IOTypePills metadata={metadata} />
        <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground flex-shrink-0">
          {runCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Play className="w-2.5 h-2.5" />
              {runCount.toLocaleString()}
            </span>
          )}
          {favoriteCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Star className="w-2.5 h-2.5" />
              {favoriteCount.toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function ComponentBrowserDialog({ open, onOpenChange, onSelect }: ComponentBrowserProps) {
  const [tab, setTab] = useState<TabId>("browse")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [sort, setSort] = useState<SortValue>("popular")

  // Browse tab state
  const [browseCards, setBrowseCards] = useState<AppBrowseCard[]>([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseNextCursor, setBrowseNextCursor] = useState<string | null>(null)

  // My components state
  const [myComponents, setMyComponents] = useState<PublishedApp[]>([])
  const [myLoading, setMyLoading] = useState(false)

  // Favorites state
  const [favoriteCards, setFavoriteCards] = useState<AppBrowseCard[]>([])
  const [favLoading, setFavLoading] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  // Fetch browse tab
  const fetchBrowse = useCallback(async (searchVal: string, sortVal: SortValue) => {
    setBrowseLoading(true)
    try {
      const result = await browseApps({
        publishType: "component",
        search: searchVal || undefined,
        sort: sortVal,
        limit: 30,
      })
      setBrowseCards(result.data)
      setBrowseNextCursor(result.nextCursor)
    } catch {
      // silently fail
    } finally {
      setBrowseLoading(false)
    }
  }, [])

  // Fetch my components
  const fetchMyComponents = useCallback(async () => {
    setMyLoading(true)
    try {
      const all = await getMyApps()
      setMyComponents(all.filter((a) => a.publishType === "component"))
    } catch {
      // silently fail
    } finally {
      setMyLoading(false)
    }
  }, [])

  // Fetch favorites
  const fetchFavorites = useCallback(async () => {
    setFavLoading(true)
    try {
      const favResult = await browseApps({ publishType: "component", favoritesOnly: true, limit: 30 })
      setFavoriteCards(favResult.data)
    } catch {
      // silently fail
    } finally {
      setFavLoading(false)
    }
  }, [])

  // Track whether the dialog was previously open to detect open transitions
  const prevOpenRef = useRef(false)

  // Fetch data when tab or filters change; reset state on fresh open
  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false
      return
    }

    // Reset state on fresh open (was closed, now open)
    if (!prevOpenRef.current) {
      prevOpenRef.current = true
      setTab("browse")
      setSearch("")
      setDebouncedSearch("")
      setSort("popular")
      // Fetch with defaults directly — avoids a second render cycle
      fetchBrowse("", "popular")
      return
    }

    // Subsequent changes (tab switch, search, sort)
    if (tab === "browse") {
      fetchBrowse(debouncedSearch, sort)
    } else if (tab === "my-components") {
      fetchMyComponents()
    } else if (tab === "favorites") {
      fetchFavorites()
    }
  }, [open, tab, debouncedSearch, sort, fetchBrowse, fetchMyComponents, fetchFavorites])

  const handleSelectBrowseCard = useCallback((card: AppBrowseCard) => {
    onSelect(browseCardToSelection(card))
    onOpenChange(false)
  }, [onSelect, onOpenChange])

  const handleSelectMyApp = useCallback((app: PublishedApp) => {
    onSelect(myAppToSelection(app))
    onOpenChange(false)
  }, [onSelect, onOpenChange])

  // Client-side filter for my components (search only, sort by name)
  const filteredMyComponents = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return myComponents
    return myComponents.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q),
    )
  }, [myComponents, search])

  const tabLabels: Record<TabId, string> = {
    browse: "Browse",
    "my-components": "My Components",
    favorites: "Favorites",
  }

  const tabs: TabId[] = ["browse", "my-components", "favorites"]

  const isLoading = tab === "browse" ? browseLoading : tab === "my-components" ? myLoading : favLoading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Puzzle className="w-4 h-4 text-[#ff0073]" />
            Component Browser
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border pb-1">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
                tab === t
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "favorites" && <Heart className="w-3 h-3 inline-block mr-1" />}
              {tabLabels[t]}
            </button>
          ))}
        </div>

        {/* Search + Sort */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search components..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          {tab === "browse" && (
            <Select value={sort} onValueChange={(v) => setSort(v as SortValue)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
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
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[50vh]">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Browse tab */}
              {tab === "browse" && (
                browseCards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                    <Puzzle className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">No components found</p>
                    {debouncedSearch && (
                      <p className="text-xs mt-1">Try a different search term</p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {browseCards.map((card) => (
                      <ComponentCard
                        key={card.id}
                        name={card.name}
                        creatorName={card.creatorDisplayName}
                        estimatedCredits={card.estimatedCredits}
                        runCount={card.totalRunCount}
                        favoriteCount={card.favoriteCount}
                        metadata={card.componentMetadata as ComponentMetadata | null}
                        onClick={() => handleSelectBrowseCard(card)}
                      />
                    ))}
                  </div>
                )
              )}

              {/* My Components tab */}
              {tab === "my-components" && (
                filteredMyComponents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                    <Puzzle className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">
                      {myComponents.length === 0 ? "No components published yet" : "No matching components"}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {filteredMyComponents.map((app) => (
                      <ComponentCard
                        key={app.id}
                        name={app.name}
                        creatorName={app.creatorDisplayName}
                        estimatedCredits={app.estimatedCredits}
                        runCount={app.totalRunCount}
                        favoriteCount={app.favoriteCount}
                        metadata={app.componentMetadata as ComponentMetadata | null}
                        onClick={() => handleSelectMyApp(app)}
                      />
                    ))}
                  </div>
                )
              )}

              {/* Favorites tab */}
              {tab === "favorites" && (
                favoriteCards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                    <Heart className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">No favorite components yet</p>
                    <p className="text-xs mt-1">Favorite components in the Browse tab to find them here</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {favoriteCards.map((card) => (
                      <ComponentCard
                        key={card.id}
                        name={card.name}
                        creatorName={card.creatorDisplayName}
                        estimatedCredits={card.estimatedCredits}
                        runCount={card.totalRunCount}
                        favoriteCount={card.favoriteCount}
                        metadata={card.componentMetadata as ComponentMetadata | null}
                        onClick={() => handleSelectBrowseCard(card)}
                      />
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
