"use client"

import { useMemo, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import type { CompetitorCardsResult, SocialPlatform, TrackedCompetitor } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ActionCardView, type SaveControls } from "./action-card-view"
import { brandHueStyle } from "./brand-colors"
import { cardPlatform, cardsOn, cardsPerBrand } from "./card-facts"
import { recordForCard, recordMovesCards, unseenVerdicts } from "./card-outcome-text"
import { TriedCards } from "./tried-cards"
import type { useCardMarking } from "./use-card-marking"

/** Cards shown before "Show all". */
const CARDS_FIRST = 6

function Chip({
  label,
  count,
  on,
  hue,
  neutral,
  onClick,
}: {
  readonly label: string
  readonly count: number
  readonly on: boolean
  readonly hue?: number
  readonly neutral?: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex items-center gap-[7px] whitespace-nowrap rounded-full border px-[11px] py-1.5 text-[13px] font-semibold transition-colors",
        // Dark mode keeps the chosen chip a raised gray, not an inverted near-white pill.
        on
          ? "border-foreground bg-foreground text-background dark:border-foreground/30 dark:bg-muted dark:text-foreground"
          : "border-border bg-card text-foreground/85 hover:bg-muted/60",
      )}
    >
      <span className={cn("h-2 w-2 rounded-[2px]", neutral || hue === undefined ? "bg-muted-foreground" : "brand-swatch")} style={neutral ? undefined : brandHueStyle(hue)} aria-hidden />
      <span dir="auto">{label}</span>
      <span className={cn("tabular-nums", on ? "text-background/70 dark:text-muted-foreground" : "text-muted-foreground")}>{count}</span>
    </button>
  )
}

/**
 * What to do now: the cards from every brand's latest scan, most urgent
 * first, filtered by brand and by the platform the page ranks by; and the
 * cards already acted on (Tried), with how they went.
 */
export function ActionWall({
  cards,
  loading,
  failed,
  onRetry,
  competitors,
  hues,
  platform,
  save,
  marking,
}: {
  readonly cards: CompetitorCardsResult | undefined
  readonly loading: boolean
  /** The cards could not be read. */
  readonly failed: boolean
  readonly onRetry: () => void
  readonly competitors: readonly TrackedCompetitor[]
  readonly hues: ReadonlyMap<string, number>
  readonly platform: SocialPlatform | null
  readonly save: SaveControls
  readonly marking: ReturnType<typeof useCardMarking>
}) {
  const t = useT()
  const [tab, setTab] = useState<"todo" | "tried">("todo")
  const [brandFilter, setBrandFilter] = useState<string | null>(null)
  // "Show all" belongs to one filter: changing a filter shows the first cards again.
  const [shownFor, setShownFor] = useState<string | null>(null)
  const posts = cards?.posts ?? {}
  const all = cards?.cards ?? []
  const todo = all.filter(marking.isTodo)
  const pool = cardsOn(todo, posts, platform)
  const counts = cardsPerBrand(pool)
  const activeBrand = brandFilter && counts.has(brandFilter) ? brandFilter : null
  const filtered = activeBrand ? pool.filter((card) => card.subjectId === activeBrand) : pool
  const filterKey = `${platform ?? ""}|${activeBrand ?? ""}`
  const showAll = shownFor === filterKey
  const shown = showAll ? filtered : filtered.slice(0, CARDS_FIRST)
  const byId = useMemo(() => new Map(competitors.map((c) => [c.id, c] as const)), [competitors])
  const chipBrands = [...counts.entries()].filter(([id]) => byId.has(id)).sort((a, b) => b[1] - a[1])
  const actions = marking.data?.actions ?? []
  const unseen = unseenVerdicts(actions)
  const tried = marking.canMark && tab === "tried" && actions.length > 0

  const cardsLabel = platform
    ? t(pool.length === 1 ? "competitors.cardsCountOnOne" : "competitors.cardsCountOn", { n: pool.length, platform: SOCIAL_PLATFORM_META[platform].name })
    : t(pool.length === 1 ? "competitors.cardsCountAllOne" : "competitors.cardsCountAll", { n: pool.length })
  const brandsLabel = counts.size === 1 ? t("competitors.brandsCountOne") : t("competitors.brandsCount", { n: counts.size })

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 className="text-lg font-semibold">{t("competitors.cardsTitle")}</h2>
            {!tried && all.length > 0 && <span className="text-[13px] text-muted-foreground">{t("competitors.cardsLine", { cards: cardsLabel, brands: brandsLabel })}</span>}
          </div>
          {recordMovesCards(cards?.record) && <p className="text-[12px] text-muted-foreground">{t("marks.sortedByRecord")}</p>}
        </div>
        {marking.canMark && actions.length > 0 && (
          <div className="flex gap-1 rounded-lg border p-0.5 text-[12px] font-bold" role="tablist" aria-label={t("competitors.cardsTitle")}>
            {(["todo", "tried"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn("rounded-md px-2.5 py-1.5", tab === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {key === "todo" ? t("marks.tabTodo", { n: todo.length }) : t("marks.tabTried", { n: actions.length })}
              </button>
            ))}
          </div>
        )}
      </div>
      {unseen.length > 0 && !tried && (
        <button
          type="button"
          onClick={() => setTab("tried")}
          className="flex w-full items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-start text-[13px] font-semibold text-emerald-800 hover:bg-emerald-500/15 dark:text-emerald-300"
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="flex-1">{unseen.length === 1 ? t("marks.resultsInOne") : t("marks.resultsIn", { n: unseen.length })}</span>
          <span className="text-[12px] underline">{t("marks.seeResults")}</span>
        </button>
      )}
      {tried && marking.data ? (
        <TriedCards data={marking.data} handlers={marking.handlers} />
      ) : loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : failed && !cards ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <span className="flex-1">{t("apiErr.loadCompetitorCards")}</span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      ) : todo.length === 0 ? (
        <p className="text-sm text-muted-foreground">{all.length > 0 ? t("marks.allTried") : t("competitors.noCards")}</p>
      ) : (
        <>
          {pool.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <Chip label={t("competitors.allBrands")} count={pool.length} on={activeBrand === null} neutral onClick={() => setBrandFilter(null)} />
              {chipBrands.map(([id, n]) => (
                <Chip
                  key={id}
                  label={byId.get(id)!.brand}
                  count={n}
                  on={activeBrand === id}
                  hue={hues.get(id)}
                  onClick={() => setBrandFilter(activeBrand === id ? null : id)}
                />
              ))}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-[18px] text-[13px] text-muted-foreground">{t("competitors.nothingToAct")}</div>
          ) : (
            <div id="action-wall-cards" className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))]">
              {shown.map((card) => {
                const owner = card.subjectId ? byId.get(card.subjectId) : undefined
                return (
                  <ActionCardView
                    key={card.id}
                    card={card}
                    brand={{ name: owner?.brand ?? null, hue: owner ? hues.get(owner.id) : undefined }}
                    platform={cardPlatform(card, posts)}
                    posts={posts}
                    save={save}
                    record={recordForCard(cards?.record, card)}
                    marking={marking.markingFor(card)}
                  />
                )
              })}
            </div>
          )}
          {filtered.length > CARDS_FIRST && (
            <button
              type="button"
              aria-expanded={showAll}
              aria-controls="action-wall-cards"
              onClick={() => setShownFor(showAll ? null : filterKey)}
              className="self-start text-[13px] font-semibold hover:underline"
            >
              {showAll ? t("competitors.showFewer") : t("competitors.showAll", { n: filtered.length })}
            </button>
          )}
        </>
      )}
    </section>
  )
}
