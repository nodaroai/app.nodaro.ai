import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  LayoutTemplate, Search, Heart, User, X, SlidersHorizontal,
  Pencil, Trash2, ToggleLeft, ToggleRight, Loader2, Layers, Copy,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { getMyTemplates, updateTemplate, deleteTemplate, cloneTemplate, type WorkflowTemplate, type TemplateBrowseCard } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { APP_CATEGORIES, OUTPUT_TYPES } from "@/lib/app-categories"
import { COMPLEXITY_CONFIG, type Complexity } from "@/lib/template-utils"
import {
  useTemplateBrowseInfinite,
  useTemplateFavorites,
  useToggleTemplateFavoriteMutation,
  type TemplateBrowseParams,
} from "@/hooks/queries/use-template-marketplace-queries"
import { TemplateMarketplaceCard, TemplateMarketplaceCardSkeleton } from "@/components/templates/template-marketplace-card"
import { TemplatePreviewModal } from "@/components/templates/template-preview-modal"
import { useProjects } from "@/hooks/queries/use-projects-queries"

type ViewMode = "browse" | "my-templates" | "favorites"

export default function TemplatesPage() {
  const { user } = useAuth()
  const qc = useQueryClient()

  // Browse state
  const [viewMode, setViewMode] = useState<ViewMode>("browse")
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>()
  const [selectedOutputType, setSelectedOutputType] = useState<string | undefined>()
  const [selectedComplexity, setSelectedComplexity] = useState<string | undefined>()
  const [sortBy, setSortBy] = useState<"popular" | "newest" | "most-favorited">("popular")
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Preview modal state
  const [previewTemplate, setPreviewTemplate] = useState<TemplateBrowseCard | null>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Browse params
  const browseParams: TemplateBrowseParams = useMemo(() => ({
    search: debouncedSearch || undefined,
    category: selectedCategory,
    outputType: selectedOutputType,
    complexity: selectedComplexity,
    sort: sortBy,
    favoritesOnly: viewMode === "favorites" ? true : undefined,
  }), [debouncedSearch, selectedCategory, selectedOutputType, selectedComplexity, sortBy, viewMode])

  // Browse query
  const {
    data: browseData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: browseLoading,
  } = useTemplateBrowseInfinite(browseParams)

  const browseItems = useMemo(
    () => browseData?.pages.flatMap((p) => p.data) ?? [],
    [browseData],
  )

  // Favorites
  const { data: favoriteIds = [] } = useTemplateFavorites()
  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const favMutation = useToggleTemplateFavoriteMutation()

  // My templates
  const { data: myTemplates, isLoading: myTemplatesLoading } = useQuery({
    queryKey: ["my-templates"],
    queryFn: getMyTemplates,
    enabled: viewMode === "my-templates",
  })

  // Projects (for clone dropdown in preview modal)
  const { data: projects } = useProjects()

  const listToggleMutation = useMutation({
    mutationFn: async ({ templateId, isListed }: { templateId: string; isListed: boolean }) => {
      await updateTemplate(templateId, { isListed })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-templates"] })
      qc.invalidateQueries({ queryKey: ["template-marketplace"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      await deleteTemplate(templateId)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-templates"] })
      qc.invalidateQueries({ queryKey: ["template-marketplace"] })
      toast.success("Template deleted")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete template")
    },
  })

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
  const isLoading = showBrowse ? browseLoading : myTemplatesLoading

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Discover workflow templates or manage your own
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
                    viewMode === "my-templates"
                      ? "bg-white dark:bg-zinc-700 text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setViewMode("my-templates")}
                >
                  <User className="h-3.5 w-3.5" />
                  My Templates
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

          {/* Search (browse/favorites only) */}
          {showBrowse && (
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search templates..."
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

        {/* Category + output type + complexity pills (browse/favorites only) */}
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

            {/* Separator */}
            <div className="w-px h-5 bg-border mx-1" />

            {/* Complexity pills */}
            {(Object.keys(COMPLEXITY_CONFIG) as Complexity[]).map((key) => {
              const cfg = COMPLEXITY_CONFIG[key]
              return (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors",
                    selectedComplexity === key
                      ? cfg.color
                      : "text-muted-foreground border-border hover:text-foreground hover:border-zinc-400",
                  )}
                  onClick={() => setSelectedComplexity(selectedComplexity === key ? undefined : key)}
                >
                  {cfg.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Content area */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <TemplateMarketplaceCardSkeleton key={i} />
          ))}
        </div>
      ) : showBrowse ? (
        /* Browse / Favorites grid */
        browseItems.length === 0 ? (
          <div className="text-center py-16">
            <LayoutTemplate className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-foreground mb-2">
              {viewMode === "favorites" ? "No favorites yet" : "No templates found"}
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {viewMode === "favorites"
                ? "Heart templates you like to save them here."
                : debouncedSearch || selectedCategory || selectedOutputType || selectedComplexity
                  ? "Try adjusting your search or filters."
                  : "Be the first to publish a workflow template!"}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {browseItems.map((template) => (
                <TemplateMarketplaceCard
                  key={template.id}
                  template={template}
                  isFavorited={favSet.has(template.id)}
                  onToggleFavorite={(id) => favMutation.mutate({ templateId: id })}
                  onOpenPreview={setPreviewTemplate}
                />
              ))}
              {isFetchingNextPage &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TemplateMarketplaceCardSkeleton key={`skel-${i}`} />
                ))}
            </div>
            <div ref={sentinelRef} className="h-1" />
          </>
        )
      ) : (
        /* My Templates list */
        <MyTemplatesGrid
          templates={myTemplates}
          onToggleListed={(templateId, isListed) => listToggleMutation.mutate({ templateId, isListed })}
          onDelete={(templateId) => deleteMutation.mutate(templateId)}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {/* Preview modal */}
      {previewTemplate && (
        <TemplatePreviewModal
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          isFavorited={favSet.has(previewTemplate.id)}
          onToggleFavorite={(id) => favMutation.mutate({ templateId: id })}
          projects={projects ?? []}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// My Templates Grid
// ---------------------------------------------------------------------------

function MyTemplatesGrid({
  templates,
  onToggleListed,
  onDelete,
  isDeleting,
}: {
  templates: WorkflowTemplate[] | undefined
  onToggleListed: (templateId: string, isListed: boolean) => void
  onDelete: (templateId: string) => void
  isDeleting: boolean
}) {
  if (!templates || templates.length === 0) {
    return (
      <div className="text-center py-16">
        <LayoutTemplate className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">No templates yet</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Publish a workflow as a template from the workflow editor share dialog.
          Templates let others clone your workflow into their own projects.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {templates.map((tmpl) => (
        <MyTemplateCard
          key={tmpl.id}
          template={tmpl}
          onToggleListed={(isListed) => onToggleListed(tmpl.id, isListed)}
          onDelete={() => onDelete(tmpl.id)}
          isDeleting={isDeleting}
        />
      ))}
    </div>
  )
}

function MyTemplateCard({
  template,
  onToggleListed,
  onDelete,
  isDeleting,
}: {
  template: WorkflowTemplate
  onToggleListed: (isListed: boolean) => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const complexity = COMPLEXITY_CONFIG[template.complexity as Complexity]

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{template.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{template.slug}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {/* Listed/Unlisted badge */}
          <span
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition-colors",
              template.isListed
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                : "bg-zinc-100 dark:bg-zinc-800 text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700",
            )}
            onClick={() => onToggleListed(!template.isListed)}
            title={template.isListed ? "Click to unlist from marketplace" : "Click to list on marketplace"}
          >
            {template.isListed ? "Listed" : "Unlisted"}
          </span>
          {/* Complexity badge */}
          {complexity && (
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", complexity.color)}>
              {complexity.label}
            </span>
          )}
        </div>
      </div>

      {template.description && (
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{template.description}</p>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Copy className="h-3 w-3" />
          {template.cloneCount} clones
        </span>
        <span className="flex items-center gap-1">
          <Heart className="h-3 w-3" />
          {template.favoriteCount} favorites
        </span>
        <span className="flex items-center gap-1">
          <Layers className="h-3 w-3" />
          {template.nodeCount} nodes
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onToggleListed(!template.isListed)}
          title={template.isListed ? "Unlist" : "List"}
        >
          {template.isListed ? (
            <ToggleRight className="h-4 w-4 text-emerald-500" />
          ) : (
            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={isDeleting}
          title="Delete template"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
