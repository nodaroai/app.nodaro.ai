import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Rocket,
  ExternalLink,
  Copy,
  BarChart3,
  ToggleLeft,
  ToggleRight,
  Code2,
  Loader2,
  Shield,
  Plus,
  X,
  Search,
  Heart,
  User,
  SlidersHorizontal,
  Pencil,
  Workflow,
  Settings,
  Puzzle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { getMyApps, updateApp, deactivateApp, getMonetizationDefaults, updateMonetizationDefaults, type PublishedApp } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { calculateMonetizedCost } from "@nodaro/shared"
import { useAuth } from "@/hooks/use-auth"
import { Label } from "@/components/ui/label"
import { APP_CATEGORIES, OUTPUT_TYPES, CATEGORY_COLORS } from "@/lib/app-categories"
import {
  useAppBrowseInfinite,
  useAppFavorites,
  useToggleAppFavoriteMutation,
  type AppBrowseParams,
} from "@/hooks/queries/use-app-marketplace-queries"
import { AppMarketplaceCard, AppMarketplaceCardSkeleton } from "@/components/apps/app-marketplace-card"
import { useAppSettings } from "@/hooks/queries/use-app-settings-queries"

type ViewMode = "browse" | "my-apps" | "favorites"

export default function AppsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: appSettings } = useAppSettings()
  const videoAutoplay = appSettings?.apps_page_video_autoplay ?? true

  // Browse state
  const [viewMode, setViewMode] = useState<ViewMode>("browse")
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>()
  const [selectedOutputType, setSelectedOutputType] = useState<string | undefined>()
  const [sortBy, setSortBy] = useState<"popular" | "newest" | "most-favorited">("popular")
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Browse params
  const browseParams: AppBrowseParams = useMemo(() => ({
    search: debouncedSearch || undefined,
    category: selectedCategory,
    outputType: selectedOutputType,
    sort: sortBy,
    favoritesOnly: viewMode === "favorites" ? true : undefined,
    publishType: "app" as const,
  }), [debouncedSearch, selectedCategory, selectedOutputType, sortBy, viewMode])

  // Browse query
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

  // Favorites
  const { data: favoriteIds = [] } = useAppFavorites()
  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const favMutation = useToggleAppFavoriteMutation()

  // My apps
  const { data: myApps, isLoading: myAppsLoading } = useQuery({
    queryKey: ["my-apps"],
    queryFn: getMyApps,
    enabled: viewMode === "my-apps",
  })

  // Monetization defaults
  const [defaultFlatFee, setDefaultFlatFee] = useState(0)
  const [defaultPercent, setDefaultPercent] = useState(0)

  const { data: monetizationDefaults } = useQuery({
    queryKey: ["monetization-defaults"],
    queryFn: getMonetizationDefaults,
    enabled: hasCredits() && viewMode === "my-apps",
  })

  useEffect(() => {
    if (monetizationDefaults) {
      setDefaultFlatFee(monetizationDefaults.flatFee)
      setDefaultPercent(monetizationDefaults.percent)
    }
  }, [monetizationDefaults])

  const saveDefaultsMutation = useMutation({
    mutationFn: () => updateMonetizationDefaults({ flatFee: defaultFlatFee, percent: defaultPercent }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monetization-defaults"] })
      toast.success("Monetization defaults saved")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to save defaults")
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ appId, isActive }: { appId: string; isActive: boolean }) => {
      if (isActive) {
        await updateApp(appId, { isActive: true })
      } else {
        await deactivateApp(appId)
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-apps"] }) },
  })

  const originsMutation = useMutation({
    mutationFn: async ({ appId, origins }: { appId: string; origins: string[] }) => {
      await updateApp(appId, { allowedOrigins: origins })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-apps"] }) },
  })

  const listToggleMutation = useMutation({
    mutationFn: async ({ appId, isListed }: { appId: string; isListed: boolean }) => {
      await updateApp(appId, { isListed })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-apps"] })
      qc.invalidateQueries({ queryKey: ["app-marketplace"] })
    },
  })

  // Edit dialog state
  const [editApp, setEditApp] = useState<PublishedApp | null>(null)

  const editMutation = useMutation({
    mutationFn: async ({ appId, data }: { appId: string; data: Record<string, unknown> }) => {
      await updateApp(appId, data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-apps"] })
      qc.invalidateQueries({ queryKey: ["app-marketplace"] })
      setEditApp(null)
      toast.success("App updated")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update app")
    },
  })

  const handleCopyUrl = useCallback((slug: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/app/${slug}`)
    toast.success("URL copied")
  }, [])

  const handleCopyEmbed = useCallback((slug: string) => {
    const embedCode = `<iframe src="${window.location.origin}/embed/${slug}" width="100%" height="600" frameborder="0" allow="clipboard-write"></iframe>`
    navigator.clipboard.writeText(embedCode)
    toast.success("Embed code copied")
  }, [])

  // Infinite scroll observer
  useEffect(() => {
    if (viewMode !== "browse" && viewMode !== "favorites") return
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
  }, [viewMode, hasNextPage, isFetchingNextPage, fetchNextPage])

  const showBrowse = viewMode === "browse" || viewMode === "favorites"
  const isLoading = showBrowse ? browseLoading : myAppsLoading

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Apps</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Discover and run AI-powered apps, or manage your own
          </p>
        </div>
      </div>

      {/* View mode tabs + search */}
      <div className="space-y-4 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode pills */}
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg p-1">
            <button
              type="button"
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                viewMode === "browse"
                  ? "bg-white dark:bg-zinc-700 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setViewMode("browse")}
            >
              Browse
            </button>
            {user && (
              <>
                <button
                  type="button"
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5",
                    viewMode === "my-apps"
                      ? "bg-white dark:bg-zinc-700 text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setViewMode("my-apps")}
                >
                  <User className="h-3.5 w-3.5" />
                  My Apps
                </button>
                <button
                  type="button"
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5",
                    viewMode === "favorites"
                      ? "bg-white dark:bg-zinc-700 text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setViewMode("favorites")}
                >
                  <Heart className="h-3.5 w-3.5" />
                  Favorites
                </button>
              </>
            )}
          </div>

          {/* Monetization defaults (my-apps only, cloud edition) */}
          {hasCredits() && viewMode === "my-apps" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings className="h-3.5 w-3.5 mr-1.5" />
                  Monetization Defaults
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Default Pricing</h4>
                  <p className="text-xs text-muted-foreground">Applied to new apps when monetization is first enabled.</p>
                  <div>
                    <Label className="text-xs">Flat Fee (CR)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={defaultFlatFee}
                      onChange={(e) => setDefaultFlatFee(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Percentage (%)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={500}
                      value={defaultPercent}
                      onChange={(e) => setDefaultPercent(Number(e.target.value))}
                    />
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => saveDefaultsMutation.mutate()}
                    disabled={saveDefaultsMutation.isPending}
                  >
                    {saveDefaultsMutation.isPending ? "Saving..." : "Save Defaults"}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Search (browse/favorites only) */}
          {showBrowse && (
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search apps..."
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

          {/* Sort (browse/favorites only) */}
          {showBrowse && (
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-[160px] h-9">
                <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="popular">Popular</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="most-favorited">Most Favorited</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Category + output type pills (browse/favorites only) */}
        {showBrowse && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Category pills */}
            <button
              type="button"
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                !selectedCategory
                  ? "bg-[#ff0073]/10 text-[#ff0073] border-[#ff0073]/30"
                  : "text-muted-foreground border-border hover:text-foreground hover:border-zinc-400",
              )}
              onClick={() => setSelectedCategory(undefined)}
            >
              All
            </button>
            {APP_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition-colors",
                  selectedCategory === cat.value
                    ? "bg-[#ff0073]/10 text-[#ff0073] border-[#ff0073]/30"
                    : "text-muted-foreground border-border hover:text-foreground hover:border-zinc-400",
                )}
                onClick={() => setSelectedCategory(selectedCategory === cat.value ? undefined : cat.value)}
              >
                {cat.label}
              </button>
            ))}

            {/* Separator */}
            <div className="w-px h-5 bg-border mx-1" />

            {/* Output type pills */}
            {OUTPUT_TYPES.map((ot) => (
              <button
                key={ot.value}
                type="button"
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition-colors",
                  selectedOutputType === ot.value
                    ? "bg-[#ff0073]/10 text-[#ff0073] border-[#ff0073]/30"
                    : "text-muted-foreground border-border hover:text-foreground hover:border-zinc-400",
                )}
                onClick={() => setSelectedOutputType(selectedOutputType === ot.value ? undefined : ot.value)}
              >
                {ot.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content area */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <AppMarketplaceCardSkeleton key={i} />
          ))}
        </div>
      ) : showBrowse ? (
        /* Browse / Favorites grid */
        browseItems.length === 0 ? (
          <div className="text-center py-16">
            <Rocket className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-foreground mb-2">
              {viewMode === "favorites" ? "No favorites yet" : "No apps found"}
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {viewMode === "favorites"
                ? "Heart apps you like to save them here."
                : debouncedSearch || selectedCategory || selectedOutputType
                  ? "Try adjusting your search or filters."
                  : "Be the first to publish an app to the marketplace!"}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {browseItems.map((app) => (
                <AppMarketplaceCard
                  key={app.id}
                  app={app}
                  isFavorited={favSet.has(app.id)}
                  onToggleFavorite={(id) => favMutation.mutate({ appId: id })}
                  videoAutoplay={videoAutoplay}
                />
              ))}
              {isFetchingNextPage &&
                Array.from({ length: 4 }).map((_, i) => (
                  <AppMarketplaceCardSkeleton key={`skel-${i}`} />
                ))}
            </div>
            <div ref={sentinelRef} className="h-1" />
          </>
        )
      ) : (
        /* My Apps grid */
        <>
          <MyAppsGrid
            apps={myApps?.filter((a) => a.publishType !== "component")}
            onCopyUrl={handleCopyUrl}
            onCopyEmbed={handleCopyEmbed}
            onToggle={(appId, isActive) => toggleMutation.mutate({ appId, isActive })}
            onUpdateOrigins={(appId, origins) => originsMutation.mutate({ appId, origins })}
            onToggleListed={(appId, isListed) => listToggleMutation.mutate({ appId, isListed })}
            onEdit={setEditApp}
          />
          <EditAppDialog
            app={editApp}
            open={editApp !== null}
            onOpenChange={(open) => { if (!open) setEditApp(null) }}
            onSave={(appId, data) => editMutation.mutate({ appId, data })}
            isSaving={editMutation.isPending}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// My Apps Grid (creator management)
// ---------------------------------------------------------------------------

function MyAppsGrid({
  apps,
  onCopyUrl,
  onCopyEmbed,
  onToggle,
  onUpdateOrigins,
  onToggleListed,
  onEdit,
}: {
  apps: PublishedApp[] | undefined
  onCopyUrl: (slug: string) => void
  onCopyEmbed: (slug: string) => void
  onToggle: (appId: string, isActive: boolean) => void
  onUpdateOrigins: (appId: string, origins: string[]) => void
  onToggleListed: (appId: string, isListed: boolean) => void
  onEdit: (app: PublishedApp) => void
}) {
  if (!apps || apps.length === 0) {
    return (
      <div className="text-center py-16">
        <Rocket className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">No published apps yet</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Publish a workflow as a mini-app from the presentation mode share dialog.
          Apps get their own URL, persistent run history, and analytics.
        </p>
      </div>
    )
  }

  const activeApps = apps.filter((a) => a.isActive !== false)
  const inactiveApps = apps.filter((a) => a.isActive === false)

  return (
    <div className="space-y-6">
      {activeApps.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeApps.map((app) => (
            <MyAppCard
              key={app.id}
              app={app}
              onCopyUrl={onCopyUrl}
              onCopyEmbed={onCopyEmbed}
              onToggle={(isActive) => onToggle(app.id, isActive)}
              onUpdateOrigins={(origins) => onUpdateOrigins(app.id, origins)}
              onToggleListed={(isListed) => onToggleListed(app.id, isListed)}
              onEdit={() => onEdit(app)}
            />
          ))}
        </div>
      )}

      {inactiveApps.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Inactive</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
            {inactiveApps.map((app) => (
              <MyAppCard
                key={app.id}
                app={app}
                onCopyUrl={onCopyUrl}
                onCopyEmbed={onCopyEmbed}
                onToggle={(isActive) => onToggle(app.id, isActive)}
                onUpdateOrigins={(origins) => onUpdateOrigins(app.id, origins)}
                onToggleListed={(isListed) => onToggleListed(app.id, isListed)}
                onEdit={() => onEdit(app)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MyAppCard({
  app,
  onCopyUrl,
  onCopyEmbed,
  onToggle,
  onUpdateOrigins,
  onToggleListed,
  onEdit,
}: {
  app: PublishedApp
  onCopyUrl: (slug: string) => void
  onCopyEmbed: (slug: string) => void
  onToggle: (isActive: boolean) => void
  onUpdateOrigins: (origins: string[]) => void
  onToggleListed: (isListed: boolean) => void
  onEdit: () => void
}) {
  const [showEmbed, setShowEmbed] = useState(false)
  const [newOrigin, setNewOrigin] = useState("")
  const origins = app.allowedOrigins ?? []
  const categoryLabel = APP_CATEGORIES.find((c) => c.value === app.category)?.label

  const handleAddOrigin = () => {
    const trimmed = newOrigin.trim()
    if (!trimmed) return
    let origin = trimmed
    if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
      origin = `https://${origin}`
    }
    origin = origin.replace(/\/+$/, "")
    if (origins.includes(origin)) {
      toast.error("Domain already added")
      return
    }
    onUpdateOrigins([...origins, origin])
    setNewOrigin("")
  }

  const handleRemoveOrigin = (originToRemove: string) => {
    onUpdateOrigins(origins.filter((o) => o !== originToRemove))
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{app.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">/app/{app.slug}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {/* Marketplace status badge */}
          <span
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition-colors",
              app.isListed
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                : "bg-zinc-100 dark:bg-zinc-800 text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700",
            )}
            onClick={() => onToggleListed(!app.isListed)}
            title={app.isListed ? "Click to unlist from marketplace" : "Click to list on marketplace"}
          >
            {app.isListed ? "Listed" : "Unlisted"}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            v{app.version}
          </span>
        </div>
      </div>

      {app.description && (
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{app.description}</p>
      )}

      {/* Category + tags */}
      {(app.category !== "other" || (app.tags && app.tags.length > 0)) && (
        <div className="flex items-center gap-1 flex-wrap mb-3">
          {app.category !== "other" && categoryLabel && (
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", CATEGORY_COLORS[app.category] ?? "bg-zinc-500/10 text-zinc-500")}>
              {categoryLabel}
            </span>
          )}
          {app.tags?.slice(0, 2).map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Preview thumbnail */}
      {app.previewMediaUrl && (
        <div className="mb-3 rounded-md overflow-hidden aspect-video bg-zinc-100 dark:bg-zinc-800">
          {app.previewMediaType === "video" ? (
            <video src={app.previewMediaUrl} className="w-full h-full object-cover" muted />
          ) : (
            <img src={app.previewMediaUrl} alt="" className="w-full h-full object-cover" />
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
        <span>{app.runCount ?? app.totalRunCount ?? 0} runs</span>
        {app.monetizationEnabled ? (
          <span className="text-xs text-muted-foreground">
            Base: {app.baseEstimatedCredits ?? 0} CR | Total: {app.estimatedCredits ?? 0} CR
          </span>
        ) : (
          <span>{app.estimatedCredits ?? 0} CR/run</span>
        )}
        {app.favoriteCount > 0 && <span>{app.favoriteCount} favorites</span>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <a href={`/app/${app.slug}`} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
            <ExternalLink className="h-3 w-3 mr-1" />
            Open
          </Button>
        </a>
        {app.projectId && (
          <Link to={`/projects/${app.projectId}/workflows/${app.workflowId}`}>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
              <Workflow className="h-3 w-3 mr-1" />
              Workflow
            </Button>
          </Link>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onCopyUrl(app.slug)}
        >
          <Copy className="h-3 w-3 mr-1" />
          URL
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setShowEmbed(!showEmbed)}
          title="Embed settings"
        >
          <Code2 className="h-3 w-3 mr-1" />
          Embed
        </Button>
        <Link to={`/apps/${app.id}/analytics`}>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
            <BarChart3 className="h-3 w-3 mr-1" />
            Analytics
          </Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onEdit}
          title="Edit app settings"
        >
          <Pencil className="h-3 w-3 mr-1" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onToggle(!app.isActive)}
          title={app.isActive ? "Deactivate" : "Reactivate"}
        >
          {app.isActive ? (
            <ToggleRight className="h-4 w-4 text-emerald-500" />
          ) : (
            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </div>

      {/* Embed settings panel */}
      {showEmbed && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Shield className="h-3 w-3" />
            Allowed Embed Domains
          </div>
          <p className="text-[11px] text-muted-foreground">
            Add domains that can embed this app. Embedding is blocked until at least one domain is added.
          </p>

          {origins.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {origins.map((origin) => (
                <span
                  key={origin}
                  className="inline-flex items-center gap-1 text-[11px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground"
                >
                  {origin}
                  <button
                    type="button"
                    onClick={() => handleRemoveOrigin(origin)}
                    className="hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-1.5">
            <Input
              value={newOrigin}
              onChange={(e) => setNewOrigin(e.target.value)}
              placeholder="https://example.com"
              className="h-7 text-xs flex-1"
              onKeyDown={(e) => { if (e.key === "Enter") handleAddOrigin() }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs shrink-0"
              onClick={handleAddOrigin}
              disabled={!newOrigin.trim()}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>

          {origins.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs w-full"
              onClick={() => onCopyEmbed(app.slug)}
            >
              <Copy className="h-3 w-3 mr-1" />
              Copy Embed Code
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit App Dialog
// ---------------------------------------------------------------------------

function detectMediaType(url: string): "video" | "image" | null {
  if (!url) return null
  const lower = url.toLowerCase()
  if (lower.endsWith(".mp4") || lower.endsWith(".webm") || lower.endsWith(".mov")) return "video"
  return "image"
}

function EditAppDialog({
  app,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  app: PublishedApp | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (appId: string, data: Record<string, unknown>) => void
  isSaving: boolean
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("other")
  const [outputTypes, setOutputTypes] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [previewMediaUrl, setPreviewMediaUrl] = useState("")
  const [supportsRemix, setSupportsRemix] = useState(false)
  const [isListed, setIsListed] = useState(false)
  const [monetizationEnabled, setMonetizationEnabled] = useState(false)
  const [monetizationFlatFee, setMonetizationFlatFee] = useState(0)
  const [monetizationPercent, setMonetizationPercent] = useState(0)
  const [loadingDefaults, setLoadingDefaults] = useState(false)

  // Re-populate form when app changes or dialog opens
  useEffect(() => {
    if (app && open) {
      setName(app.name ?? "")
      setDescription(app.description ?? "")
      setCategory(app.category ?? "other")
      setOutputTypes(app.outputTypes ?? [])
      setTags(app.tags ?? [])
      setTagInput("")
      setPreviewMediaUrl(app.previewMediaUrl ?? "")
      setSupportsRemix(app.supportsRemix ?? false)
      setIsListed(app.isListed ?? false)
      setMonetizationEnabled(app.monetizationEnabled ?? false)
      setMonetizationFlatFee(app.monetizationFlatFee ?? 0)
      setMonetizationPercent(app.monetizationPercent ?? 0)
    }
  }, [app, open])

  const handleToggleMonetization = useCallback(async (enabled: boolean) => {
    setMonetizationEnabled(enabled)
    if (enabled && monetizationFlatFee === 0 && monetizationPercent === 0) {
      try {
        setLoadingDefaults(true)
        const defaults = await getMonetizationDefaults()
        setMonetizationFlatFee(defaults.flatFee)
        setMonetizationPercent(defaults.percent)
      } catch {
        // Ignore — user can still set manually
      } finally {
        setLoadingDefaults(false)
      }
    }
  }, [monetizationFlatFee, monetizationPercent])

  const handleLoadDefaults = useCallback(async () => {
    try {
      setLoadingDefaults(true)
      const defaults = await getMonetizationDefaults()
      setMonetizationFlatFee(defaults.flatFee)
      setMonetizationPercent(defaults.percent)
    } catch {
      toast.error("Failed to load defaults")
    } finally {
      setLoadingDefaults(false)
    }
  }, [])

  const baseCredits = app?.baseEstimatedCredits ?? 0
  const calculatedCredits = monetizationEnabled
    ? calculateMonetizedCost(baseCredits, monetizationFlatFee, monetizationPercent)
    : baseCredits

  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim().toLowerCase()
    if (!trimmed || tags.includes(trimmed) || tags.length >= 10) return
    setTags([...tags, trimmed])
    setTagInput("")
  }, [tagInput, tags])

  const handleRemoveTag = useCallback((tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }, [tags])

  const handleToggleOutputType = useCallback((type: string) => {
    setOutputTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    )
  }, [])

  const handleSave = useCallback(() => {
    if (!app) return
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    const mediaUrl = previewMediaUrl.trim() || null
    const data: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim(),
      category,
      outputTypes,
      tags,
      previewMediaUrl: mediaUrl,
      previewMediaType: mediaUrl ? detectMediaType(mediaUrl) : null,
      supportsRemix,
      isListed,
    }
    if (hasCredits()) {
      data.monetizationEnabled = monetizationEnabled
      data.monetizationFlatFee = monetizationFlatFee
      data.monetizationPercent = monetizationPercent
    }
    onSave(app.id, data)
  }, [app, name, description, category, outputTypes, tags, previewMediaUrl, supportsRemix, isListed, monetizationEnabled, monetizationFlatFee, monetizationPercent, onSave])

  if (!app) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit App</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-sm font-medium mb-1 block">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="App name"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this app do?"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APP_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Output types */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Output types</label>
            <div className="flex items-center gap-2 flex-wrap">
              {OUTPUT_TYPES.map((ot) => (
                <label
                  key={ot.value}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors ${
                    outputTypes.includes(ot.value)
                      ? "bg-[#ff0073]/10 text-[#ff0073] border-[#ff0073]/30"
                      : "text-muted-foreground border-border hover:border-zinc-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={outputTypes.includes(ot.value)}
                    onChange={() => handleToggleOutputType(ot.value)}
                  />
                  {ot.label}
                </label>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Tags <span className="text-xs text-muted-foreground font-normal">({tags.length}/10)</span>
            </label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-[11px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground"
                  >
                    {tag}
                    <button type="button" onClick={() => handleRemoveTag(tag)} className="hover:text-destructive">
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
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag() } }}
                disabled={tags.length >= 10}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={handleAddTag}
                disabled={!tagInput.trim() || tags.length >= 10}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Preview media URL */}
          <div>
            <label className="text-sm font-medium mb-1 block">Preview media URL</label>
            <Input
              value={previewMediaUrl}
              onChange={(e) => setPreviewMediaUrl(e.target.value)}
              placeholder="https://..."
              className="text-xs"
            />
            {previewMediaUrl.trim() && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Detected type: {detectMediaType(previewMediaUrl.trim()) ?? "image"}
              </p>
            )}
          </div>

          {/* Supports remix toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Supports remix</p>
              <p className="text-xs text-muted-foreground">Users can customize and remix this app</p>
            </div>
            <Switch checked={supportsRemix} onCheckedChange={setSupportsRemix} />
          </div>

          {/* Listed on marketplace toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Listed on marketplace</p>
              <p className="text-xs text-muted-foreground">Make discoverable in the Apps browse page</p>
            </div>
            <Switch checked={isListed} onCheckedChange={setIsListed} />
          </div>

          {/* Monetization section (cloud only) */}
          {hasCredits() && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Monetization</p>
                  <p className="text-xs text-muted-foreground">Charge a markup when others run your app</p>
                </div>
                <Switch checked={monetizationEnabled} onCheckedChange={handleToggleMonetization} />
              </div>

              {monetizationEnabled && (
                <div className="space-y-3 pl-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Flat fee (CR)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={monetizationFlatFee}
                        onChange={(e) => setMonetizationFlatFee(Math.max(0, Number(e.target.value) || 0))}
                        className="h-8 text-xs mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Percentage (%)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={500}
                        value={monetizationPercent}
                        onChange={(e) => setMonetizationPercent(Math.min(500, Math.max(0, Number(e.target.value) || 0)))}
                        className="h-8 text-xs mt-1"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    If this app costs {baseCredits} CR to run, users will pay {calculatedCredits} CR
                  </p>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleLoadDefaults}
                    disabled={loadingDefaults}
                  >
                    {loadingDefaults && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                    Use my defaults
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Save button */}
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
