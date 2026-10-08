"use client"

/**
 * The Clip Pack inspector's body (§4.2 of the inspectors design, A4-2; M17,
 * M20, M22): the banners (an edit made on an earlier plan, a newer run), the
 * Show filter (All / Kept / Dropped, R15 a) with the previews note, the card
 * grid, the muted line counting clips the render's wire never sends (R12 a),
 * and the finals of clips this plan no longer has, collapsed.
 */
import { useState } from "react"
import { ChevronRight } from "lucide-react"
import type { ReviewModel } from "@/hooks/use-review-model"
import type { ClipCards } from "@/lib/edl-review/build-clip-cards"
import { CLIP_FILTERS, clipFilterCounts, filterClipCards, type ClipFilter } from "@/lib/edl-review/clip-view"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { Banner, BANNER_ACTION } from "../review-banners"
import { ClipGrid, type ClipGridProps } from "./clip-grid"

export interface ClipBodyProps {
  readonly model: ReviewModel
  readonly cards: ClipCards
  readonly grid: Omit<ClipGridProps, "cards">
  readonly onDiscardStaleEdit: () => void
}

function FilterBar({ cards, filter, onChange }: { readonly cards: ClipCards; readonly filter: ClipFilter; readonly onChange: (f: ClipFilter) => void }) {
  const t = useT()
  const counts = clipFilterCounts(cards.cards)
  const label = (f: ClipFilter) =>
    f === "all" ? t("clipReview.filterAll", { n: counts.all }) : f === "kept" ? t("clipReview.filterKept", { n: counts.kept }) : t("clipReview.filterDropped", { n: counts.dropped })
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="radiogroup" aria-label={t("clipReview.show")} className="inline-flex rounded-md bg-muted p-0.5 text-xs">
        {CLIP_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            className={cn("rounded px-2 py-0.5 tabular-nums", filter === f ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            onClick={() => onChange(f)}
          >
            {label(f)}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("clipReview.previewsPrivate")}</p>
    </div>
  )
}

function Orphans({ cards }: { readonly cards: ClipCards }) {
  const t = useT()
  const rtl = useAppDir() === "rtl"
  const [open, setOpen] = useState(false)
  if (cards.orphanFinals.length === 0) return null
  return (
    <section data-testid="clip-orphans" className="flex flex-col gap-2">
      <button type="button" aria-expanded={open} className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setOpen((v) => !v)}>
        <ChevronRight className={cn("h-3 w-3 transition-transform", open ? "rotate-90" : rtl && "rotate-180")} aria-hidden />
        {t("clipReview.orphans", { n: cards.orphanFinals.length })}
      </button>
      {open && (
        <>
          <p className="text-[11px] text-muted-foreground">{t("clipReview.orphansNote")}</p>
          <ul className="flex flex-col gap-1">
            {cards.orphanFinals.map((final) => (
              <li key={final.jobId ?? final.url} className="flex items-center gap-2 text-xs">
                <span>{t("clipReview.orphanFinal")}</span>
                <a href={final.url} target="_blank" rel="noreferrer" className="text-muted-foreground underline hover:text-foreground">
                  {final.url.split("/").pop()}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export function ClipBody({ model, cards, grid, onDiscardStaleEdit }: ClipBodyProps) {
  const t = useT()
  const [filter, setFilter] = useState<ClipFilter>("all")
  const shown = filterClipCards(cards.cards, filter)
  return (
    <div data-testid="clip-body" className="flex min-h-0 flex-1 flex-col gap-3">
      {model.editStatus === "stale" && (
        <Banner
          id="stale-edit"
          tone="warn"
          action={!model.locked && (
            <button type="button" className={BANNER_ACTION} onClick={onDiscardStaleEdit}>{t("edlReview.discardEdits")}</button>
          )}
        >
          {t("edlReview.staleEdit")}
        </Banner>
      )}
      {model.newerRun && (
        <Banner
          id="newer-run"
          tone="warn"
          action={!model.locked && (
            <button type="button" className={BANNER_ACTION} onClick={model.loadNewerRun}>{t("renderFinal.loadNewerRun")}</button>
          )}
        >
          {t("edlReview.newerRunBanner")}
        </Banner>
      )}
      <div className="flex flex-col gap-3 px-4 pb-3">
        <FilterBar cards={cards} filter={filter} onChange={setFilter} />
        {shown.length === 0 ? (
          <p data-testid="clip-empty" className="py-8 text-center text-sm text-muted-foreground">
            {cards.cards.length === 0 ? t("clipReview.noClips") : t("clipReview.noMatch")}
          </p>
        ) : (
          <ClipGrid cards={shown} {...grid} />
        )}
        {cards.notSent > 0 && (
          <p data-testid="clip-not-sent" className="text-xs text-muted-foreground">
            {cards.notSent === 1 ? t("clipReview.notSentOne") : t("clipReview.notSentMany", { n: cards.notSent })}
          </p>
        )}
        <Orphans cards={cards} />
      </div>
    </div>
  )
}
