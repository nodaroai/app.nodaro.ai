import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { PreviewVideo } from "@/components/ui/preview-video"
import { browseTemplates } from "@/lib/api"
import { useTemplateFavorites } from "@/hooks/queries/use-template-marketplace-queries"
import { normalizeTemplateCategory } from "@nodaro/shared/apps"
import { TEMPLATE_CATEGORY_VALUES, templateCategoryLabel } from "@/lib/template-categories"
import { useT, type MessageKey } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { EmptyLine, RowArrows, SectionTitle, SegmentedControl, SkeletonRow, ThemeSwitch } from "./home-section"
import { HOME_QUIET_LINK, useRowScroller } from "./home-ui"
import {
  TEMPLATE_FILTERS,
  TEMPLATE_FILTER_SORT,
  buildUseCaseTiles,
  templatesPageHref,
  type TemplateFilter,
  type UseCaseTile,
} from "./template-use-cases"

/** `/v1/templates/browse` caps a page at 50; the tiles are built from one page per sort. */
const TEMPLATE_PAGE_SIZE = 50

const FILTER_LABELS: Record<TemplateFilter, MessageKey> = {
  "for-you": "home.templates.forYou",
  trending: "home.templates.trending",
  "new-this-week": "home.templates.newThisWeek",
}

/** "Start from a template" on the Explore tab — one tile per use case. */
export function TemplateUseCasesSection({ withThemeSwitch }: { readonly withThemeSwitch: boolean }) {
  const t = useT()
  const [filter, setFilter] = useState<TemplateFilter>("for-you")
  // Fixed for the visit, so "this week" doesn't shift under a re-render.
  const [now] = useState(() => Date.now())
  const sort = TEMPLATE_FILTER_SORT[filter]

  const { data, isLoading } = useQuery({
    queryKey: ["home-template-use-cases", sort],
    queryFn: () => browseTemplates({ sort, limit: TEMPLATE_PAGE_SIZE }),
    staleTime: 60_000,
  })
  // The user's own favorites lead the "For you" row (same cache entry the
  // preview modal's heart reads).
  const { data: favoriteIds = [] } = useTemplateFavorites()
  const tiles = useMemo(
    () =>
      buildUseCaseTiles(
        TEMPLATE_CATEGORY_VALUES,
        // Read through the legacy map, so a card from an older backend still lands in a tile.
        (data?.data ?? []).map((card) => ({ ...card, category: normalizeTemplateCategory(card.category) })),
        { filter, now, favoriteIds },
      ),
    [data, filter, now, favoriteIds],
  )
  const scroller = useRowScroller(`${filter}:${tiles.length}`)
  const options = TEMPLATE_FILTERS.map((value) => ({ value, label: t(FILTER_LABELS[value]) }))

  return (
    <section>
      <SectionTitle
        title={t("home.section.startFromTemplate")}
        trailing={withThemeSwitch ? <ThemeSwitch /> : undefined}
      />
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label={t("home.section.startFromTemplate")}
          options={options}
          value={filter}
          onChange={setFilter}
        />
        <div className="flex items-center gap-4">
          <Link to="/templates" className={HOME_QUIET_LINK}>
            {t("home.templates.allUseCases")}
          </Link>
          {tiles.length > 0 && <RowArrows scroller={scroller} />}
        </div>
      </div>

      {isLoading ? (
        <SkeletonRow itemWidth={210} aspectClass="aspect-video" />
      ) : tiles.length === 0 ? (
        <EmptyLine
          text={filter === "new-this-week" ? t("home.templates.emptyNewThisWeek") : t("dash.noTemplates")}
        />
      ) : (
        <div ref={scroller.rowRef} className="home-row-scroll mt-3.5 flex gap-3 overflow-x-auto pb-1.5">
          {tiles.map((tile) => (
            <UseCaseTileLink
              key={tile.category}
              tile={tile}
              filter={filter}
              label={templateCategoryLabel(tile.category, t)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function UseCaseTileLink({
  tile,
  filter,
  label,
}: {
  readonly tile: UseCaseTile
  readonly filter: TemplateFilter
  readonly label: string
}) {
  const isRtl = useAppDir() === "rtl"
  return (
    <Link
      to={templatesPageHref(tile.category, filter)}
      className="home-stripes relative aspect-video w-[210px] flex-none overflow-hidden rounded-xl border border-[var(--home-line-2)] transition-colors hover:border-[var(--home-muted)]"
    >
      {tile.coverUrl &&
        (tile.coverType === "video" ? (
          <PreviewVideo src={tile.coverUrl} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <CachedImage
            src={tile.coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            thumbnail
          />
        ))}
      <span className="absolute inset-0 bg-[linear-gradient(180deg,transparent_40%,rgba(0,0,0,0.55))]" aria-hidden />
      <span className="absolute bottom-2.5 start-3 flex items-center gap-1 text-[13px] font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
        {label}
        <ArrowRight className={cn("size-3.5", isRtl && "rotate-180")} aria-hidden />
      </span>
    </Link>
  )
}
