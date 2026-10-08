"use client"

/**
 * The Clip Pack inspector's header (§4.2 of the inspectors design, A4-2; M17):
 * the title `Review clips · {plan} → {render}`; beside it the render picker and
 * the validity badge (the render's own rule over every clip a run would send,
 * TA1 a) and the summary "8 clips · 6 kept · 6:41"; and the controls — Keep all
 * and Drop all (R15 a) and the Clips | JSON switch.
 */
import { cn } from "@/lib/utils"
import type { ClipCards } from "@/lib/edl-review/build-clip-cards"
import { positionOf } from "@/lib/edl-review/review-time"
import { useT } from "@/lib/i18n"
import { ReviewMeta, type ReviewMetaProps } from "../review-header"

export type ClipView = "clips" | "json"

export function ClipSummary({ cards }: { readonly cards: ClipCards }) {
  const t = useT()
  const clips = cards.cards.length === 1 ? t("clipReview.clipsOne") : t("clipReview.clipsMany", { n: cards.cards.length })
  return <>{t("clipReview.summary", { clips, kept: cards.keptCount, length: positionOf(cards.keptDurationMs) })}</>
}

export function ClipMeta({ cards, ...meta }: Omit<ReviewMetaProps, "take"> & { readonly cards: ClipCards | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <ReviewMeta {...meta} take={undefined} />
      {cards && <span data-testid="clip-summary"><ClipSummary cards={cards} /></span>}
    </span>
  )
}

export interface ClipActionsProps {
  readonly view: ClipView
  readonly onViewChange: (view: ClipView) => void
  /** Keep all / Drop all are offered (the review is editable and has clips). */
  readonly canBulk: boolean
  readonly onKeepAll: () => void
  readonly onDropAll: () => void
}

const BULK = "rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"

export function ClipActions({ view, onViewChange, canBulk, onKeepAll, onDropAll }: ClipActionsProps) {
  const t = useT()
  const tab = (value: ClipView, label: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      className={cn("rounded px-2 py-0.5 text-xs", view === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
      onClick={() => onViewChange(value)}
    >
      {label}
    </button>
  )
  return (
    <>
      {view === "clips" && (
        <>
          <button type="button" className={BULK} disabled={!canBulk} onClick={onKeepAll}>{t("clipReview.keepAll")}</button>
          <button type="button" className={BULK} disabled={!canBulk} onClick={onDropAll}>{t("clipReview.dropAll")}</button>
        </>
      )}
      <div role="group" aria-label={t("edlReview.view")} className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
        {tab("clips", t("clipReview.tabClips"))}
        {tab("json", t("out.json"))}
      </div>
    </>
  )
}
