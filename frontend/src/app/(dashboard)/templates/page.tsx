import { useState, useCallback, useRef, useEffect, useMemo, Suspense } from "react"
import { lazyWithRetry } from "@/lib/lazy-with-retry"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Navigate, useSearchParams } from "react-router-dom"
import { LayoutTemplate } from "lucide-react"
import { toast } from "sonner"
import { useT, type MessageKey } from "@/lib/i18n"
import { surfaceTemplatesVisible } from "@/lib/surface-selectors"
import { hasCredits } from "@/lib/edition"
import { browseTemplates, getMyTemplates, updateTemplate, deleteTemplate, type WorkflowTemplate } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { normalizeTemplateCategory } from "@nodaro/shared"
import { TYPICAL_EPISODE_MINUTES } from "@nodaro/render-rules"
import { TEMPLATE_CATEGORY_VALUES, templateCategoryLabel } from "@/lib/template-categories"
import type { TemplateSort } from "@/lib/template-utils"
import { readTemplatesUrlState, writeTemplatesUrlState, type TemplatesUrlPatch } from "@/lib/template-url-state"
import { queryKeys } from "@/lib/query-keys"
import {
  useTemplateBrowseInfinite,
  useTemplateFavorites,
  useToggleTemplateFavoriteMutation,
  type TemplateBrowseParams,
} from "@/hooks/queries/use-template-marketplace-queries"
import { SegmentedControl, ThemeSwitch } from "@/components/dashboard/home/home-section"
import { buildUseCaseTiles } from "@/components/dashboard/home/template-use-cases"
import { TemplateMarketplaceCard, TemplateMarketplaceCardSkeleton } from "@/components/templates/template-marketplace-card"
import { TemplatesHero } from "@/components/templates/templates-hero"
import { UseCaseTiles } from "@/components/templates/use-case-tiles"
import { TemplateSearch } from "@/components/templates/template-search"
import { MyTemplatesGrid } from "@/components/templates/my-templates-grid"
import { EditTemplateDialog } from "@/components/templates/edit-template-dialog"

const TemplateDetailModal = lazyWithRetry(() =>
  import("@/components/templates/template-detail-modal").then((m) => ({ default: m.TemplateDetailModal })),
)
const TemplateCanvasPreview = lazyWithRetry(() =>
  import("@/components/templates/template-canvas-preview").then((m) => ({ default: m.TemplateCanvasPreview })),
)

type ViewMode = "browse" | "favorites" | "mine"

const SORT_LABELS: Record<TemplateSort, MessageKey> = {
  popular: "templates.sortPopular",
  newest: "templates.sortNewest",
  "most-favorited": "templates.sortFavorited",
  cheapest: "templates.sortCheapest",
}

/** `/v1/templates/browse` caps a page at 50; the use-case tiles come from one page. */
const TILES_PAGE_SIZE = 50
/** The sort control shows the design's three; "most-favorited" stays reachable by URL. */
const SORT_CONTROL: readonly TemplateSort[] = ["popular", "newest", "cheapest"]
/**
 * At most six cards a row and never one narrower than 285px (the reference
 * measures 285×205 at six across): the column minimum is a sixth of the row
 * once the row is wide enough, the fixed floor before that.
 */
const CARD_GRID = "grid grid-cols-[repeat(auto-fill,minmax(max(285px,calc((100%_-_80px)/6)),1fr))] gap-4"

export default function TemplatesPage() {
  return surfaceTemplatesVisible() ? <TemplatesContent /> : <Navigate to="/projects" replace />
}

function TemplatesContent() {
  const t = useT()
  const { user } = useAuth()
  const qc = useQueryClient()
  // Category, sort, the open template and the canvas flag live in the URL —
  // see template-url-state.ts. Everything below reads them from there.
  const [searchParams, setSearchParams] = useSearchParams()
  const urlState = useMemo(() => readTemplatesUrlState(searchParams), [searchParams])
  const patchUrl = useCallback(
    (patch: TemplatesUrlPatch) => {
      // Opening or closing an overlay is a step Back should undo; a filter
      // change is not, so it replaces the entry it is on.
      const overlay = "templateSlug" in patch || "view" in patch
      setSearchParams((prev) => writeTemplatesUrlState(prev, patch), { replace: !overlay })
    },
    [setSearchParams],
  )
  // Fixed for the visit, so a "New" badge doesn't flip under a re-render.
  const [now] = useState(() => Date.now())

  const [viewMode, setViewMode] = useState<ViewMode>("browse")
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const sentinelRef = useRef<HTMLDivElement>(null)
  const browseRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const browseParams: TemplateBrowseParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      category: urlState.category,
      sort: urlState.sort,
      favoritesOnly: viewMode === "favorites" ? true : undefined,
    }),
    [debouncedSearch, urlState.category, urlState.sort, viewMode],
  )
  const { data: browseData, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading: browseLoading } =
    useTemplateBrowseInfinite(browseParams)
  const browseItems = useMemo(() => browseData?.pages.flatMap((p) => p.data) ?? [], [browseData])

  // The use-case row is built from the popular page — the same cache entry the
  // home screen's Trending row reads — and never changes with the filter.
  const { data: tilesPage, isLoading: tilesLoading } = useQuery({
    queryKey: ["home-template-use-cases", "popular"],
    queryFn: () => browseTemplates({ sort: "popular", limit: TILES_PAGE_SIZE }),
    staleTime: 60_000,
  })
  // A tile per use case that HOLDS at least one template, in taxonomy order —
  // completely empty categories are hidden so the row never shows a blank tile
  // that opens an empty list. (`all: true` keeps taxonomy order; the count
  // filter drops the empties, unlike `all: false` which also reorders.) A row's
  // category is read through the legacy map here too, so a card served by an
  // older backend still lands in its tile.
  const tiles = useMemo(
    () =>
      buildUseCaseTiles(
        TEMPLATE_CATEGORY_VALUES,
        (tilesPage?.data ?? []).map((card) => ({ ...card, category: normalizeTemplateCategory(card.category) })),
        { filter: "trending", now, all: true },
      ).filter((tile) => tile.count > 0),
    [tilesPage, now],
  )
  const heroCover = tiles.find((tile) => tile.coverUrl)
  const { data: favoriteIds = [] } = useTemplateFavorites()
  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const favMutation = useToggleTemplateFavoriteMutation()

  const { data: myTemplates, isLoading: myTemplatesLoading } = useQuery({
    queryKey: ["my-templates"],
    queryFn: getMyTemplates,
    enabled: viewMode === "mine",
  })
  const [editingTemplate, setEditingTemplate] = useState<WorkflowTemplate | null>(null)
  const listToggleMutation = useMutation({
    mutationFn: ({ templateId, isListed }: { templateId: string; isListed: boolean }) => updateTemplate(templateId, { isListed }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-templates"] })
      qc.invalidateQueries({ queryKey: queryKeys.templateMarketplace.all })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => deleteTemplate(templateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-templates"] })
      qc.invalidateQueries({ queryKey: queryKeys.templateMarketplace.all })
      toast.success(t("templates.deleted"))
    },
    onError: (err: Error) => toast.error(err.message || t("templates.failedDelete")),
  })

  const showBrowse = viewMode !== "mine"
  useEffect(() => {
    if (!showBrowse) return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: "800px" },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [showBrowse, hasNextPage, isFetchingNextPage, fetchNextPage])

  const browseAll = () => {
    patchUrl({ category: undefined })
    setSearchInput("")
    setViewMode("browse")
    browseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  const sortOptions = SORT_CONTROL.filter((sort) => sort !== "cheapest" || hasCredits()).map((value) => ({
    value,
    label: t(SORT_LABELS[value]),
    // Cheapest first prices a per-minute template at a typical episode (decided 2026-10-07).
    hint: value === "cheapest" ? t("templates.sortCheapestHint", { n: TYPICAL_EPISODE_MINUTES }) : undefined,
  }))
  const viewOptions: { value: ViewMode; label: string }[] = [
    { value: "browse", label: t("templates.tabBrowse") },
    { value: "favorites", label: t("templates.tabFavorites") },
    { value: "mine", label: t("templates.tabMy") },
  ]
  const browseTitle =
    viewMode === "favorites"
      ? t("templates.tabFavorites")
      : viewMode === "mine"
        ? t("templates.tabMy")
        : urlState.category
          ? templateCategoryLabel(urlState.category, t)
          : t("templates.browseTitle")
  const filtered = Boolean(debouncedSearch || urlState.category)
  const openCard = browseItems.find((card) => card.slug === urlState.templateSlug) ?? null
  const isLoading = showBrowse ? browseLoading : myTemplatesLoading

  return (
    <div className="templates-page min-h-full bg-[var(--home-bg)] text-[var(--home-fg)]">
      {/* Edge to edge like the home panel — the design has no column cap. */}
      <div className="px-5 py-6 sm:px-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--home-strong)]">{t("templates.title")}</h1>
          <ThemeSwitch />
        </div>

        <TemplatesHero onBrowseAll={browseAll} cover={heroCover?.coverUrl ? { url: heroCover.coverUrl, type: heroCover.coverType } : null} />

        <div className="mt-7">
          <UseCaseTiles
            tiles={tiles}
            active={urlState.category}
            isLoading={tilesLoading}
            onToggle={(category) => patchUrl({ category: urlState.category === category ? undefined : category })}
          />
        </div>

        <section ref={browseRef} className="mt-7 scroll-mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-[17px] font-semibold text-[var(--home-strong)]">{browseTitle}</h2>
              {showBrowse && !browseLoading && browseItems.length > 0 && (
                <span className="text-xs text-[var(--home-muted)]">
                  {hasNextPage ? t("templates.countMore", { n: browseItems.length }) : t("templates.count", { n: browseItems.length })}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {user && <SegmentedControl label={t("templates.viewLabel")} options={viewOptions} value={viewMode} onChange={setViewMode} />}
              {showBrowse && (
                <>
                  <SegmentedControl
                    label={t("templates.sortLabel")}
                    options={sortOptions}
                    value={urlState.sort}
                    onChange={(sort) => patchUrl({ sort })}
                  />
                  <TemplateSearch value={searchInput} onChange={setSearchInput} />
                </>
              )}
            </div>
          </div>

          <div className="mt-3.5">
            {isLoading ? (
              <div className={CARD_GRID}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <TemplateMarketplaceCardSkeleton key={i} />
                ))}
              </div>
            ) : !showBrowse ? (
              <MyTemplatesGrid
                templates={myTemplates}
                onEdit={setEditingTemplate}
                onToggleListed={(templateId, isListed) => listToggleMutation.mutate({ templateId, isListed })}
                onDelete={(templateId) => deleteMutation.mutate(templateId)}
                isDeleting={deleteMutation.isPending}
              />
            ) : browseItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--home-line-2)] py-16 text-center">
                <LayoutTemplate className="mx-auto mb-4 size-10 text-[var(--home-dim)]" aria-hidden />
                <h3 className="mb-1.5 text-base font-semibold text-[var(--home-strong)]">
                  {viewMode === "favorites" ? t("templates.emptyFavoritesTitle") : t("templates.emptyBrowseTitle")}
                </h3>
                <p className="mx-auto max-w-md text-sm text-[var(--home-muted)]">
                  {viewMode === "favorites"
                    ? t("templates.emptyFavoritesDesc")
                    : filtered
                      ? t("templates.emptyBrowseFilteredDesc")
                      : t("templates.emptyBrowseAllDesc")}
                </p>
              </div>
            ) : (
              <>
                <div className={CARD_GRID}>
                  {browseItems.map((template) => (
                    <TemplateMarketplaceCard
                      key={template.id}
                      template={template}
                      now={now}
                      isFavorited={favSet.has(template.id)}
                      onToggleFavorite={(id) => favMutation.mutate({ templateId: id })}
                      onOpen={(card) => patchUrl({ templateSlug: card.slug })}
                    />
                  ))}
                  {isFetchingNextPage && Array.from({ length: 4 }).map((_, i) => <TemplateMarketplaceCardSkeleton key={`skel-${i}`} />)}
                </div>
                <div ref={sentinelRef} className="h-1" />
              </>
            )}
          </div>
        </section>
      </div>

      <EditTemplateDialog
        template={editingTemplate}
        open={editingTemplate !== null}
        onOpenChange={(open) => !open && setEditingTemplate(null)}
      />

      {/* The two overlays are exclusive by URL: the detail closes while the
          canvas is up, so a modal never sits inert underneath another. They
          are a separate chunk (the canvas carries the whole node library) that
          loads only once a template is opened. */}
      {urlState.templateSlug && (
        <Suspense fallback={null}>
          <TemplateDetailModal
            slug={urlState.templateSlug}
            open={urlState.view === "detail"}
            fallback={openCard}
            now={now}
            favoriteIds={favoriteIds}
            onToggleFavorite={user ? (id) => favMutation.mutate({ templateId: id }) : undefined}
            onClose={() => patchUrl({ templateSlug: null })}
            onPreviewCanvas={() => patchUrl({ view: "canvas" })}
            onOpenTemplate={(slug) => patchUrl({ templateSlug: slug })}
          />
          <TemplateCanvasPreview
            slug={urlState.templateSlug}
            open={urlState.view === "canvas"}
            fallback={openCard}
            onBack={() => patchUrl({ view: "detail" })}
          />
        </Suspense>
      )}
    </div>
  )
}
