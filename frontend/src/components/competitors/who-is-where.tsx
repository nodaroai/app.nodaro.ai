"use client"

import { AlertTriangle, ArrowDown, Loader2 } from "lucide-react"
import type { CompetitorSchedule, SocialPlatform, TrackedCompetitor } from "@nodaro/shared"
import { CreditCost } from "@/components/ui/credit-cost"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"
import { brandHueStyle } from "./brand-colors"
import { BrandRowMenu, lastScanLine, useScanPrice } from "./brand-row-menu"
import { MatrixCellView } from "./matrix-cell"
import { latestScanAt, scanOutcome, type Matrix, type MatrixRow } from "./platform-matrix"

export interface BrandActions {
  /** A scan or an edit of this brand is on its way. */
  readonly isBusy: (c: TrackedCompetitor) => boolean
  readonly onOpen: (c: TrackedCompetitor) => void
  readonly onScan: (c: TrackedCompetitor) => void
  readonly onSchedule: (c: TrackedCompetitor, schedule: CompetitorSchedule) => void
  readonly onEdit: (c: TrackedCompetitor) => void
  readonly onRemove: (c: TrackedCompetitor) => void
}

const shortDate = (iso: string) => formatDate(Date.parse(iso), { month: "short", day: "numeric" })

/** The product pink, darkened in light and lightened in dark so 11px text reads (WCAG AA on the card). */
const LINK = "font-semibold text-[#D6006A] hover:underline dark:text-[#ff4d8f]"

/**
 * Puts focus back on the brand's name that opened its window, once the window
 * has closed: Radix returns it to a dialog trigger, and the name is none, so
 * focus would fall to the page. Found by its id, so a re-sorted table still
 * finds it.
 */
export function focusBrandOpener(id: string | null, event: Event): void {
  if (!id) return
  const opener = [...document.querySelectorAll<HTMLElement>("[data-brand-open]")].find((el) => el.dataset.brandOpen === id)
  if (!opener) return
  event.preventDefault()
  opener.focus()
}

/** The id of the hidden brand name the line's controls are described by. */
const nameIdOf = (c: TrackedCompetitor) => `brand-name-${c.id}`

/** The brand's scan, right under its name, with the price it is charged. */
function SublineScan({ c, label, actions }: { readonly c: TrackedCompetitor; readonly label: string; readonly actions: BrandActions }) {
  const credits = useScanPrice(c)
  return (
    <button
      type="button"
      onClick={() => actions.onScan(c)}
      disabled={actions.isBusy(c)}
      aria-describedby={nameIdOf(c)}
      className={cn("shrink-0 whitespace-nowrap text-[11px] disabled:opacity-50", LINK)}
    >
      {label}
      <CreditCost credits={credits} prefix=" · " className="opacity-80" />
    </button>
  )
}

/** The problem the server named, a press away; `label` names it in the line, else it is a sign alone. */
function ScanProblem({ row, label }: { readonly row: MatrixRow; readonly label: string | null }) {
  const t = useT()
  const c = row.competitor
  // The scan before's date, for a scan that did not happen: the numbers shown are that scan's.
  const from = label && row.scanAt ? row.scanAt : null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 shrink-0 items-center gap-1 text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-400"
          aria-label={label ? undefined : t("competitors.scanProblem")}
          aria-describedby={nameIdOf(c)}
        >
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          {label && <span className="truncate">{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-[12.5px]">
        <p dir="auto">{c.lastScanError}</p>
        {from && <p className="mt-1.5 text-[12px] text-muted-foreground">{t("competitors.countsFrom", { date: shortDate(from) })}</p>}
      </PopoverContent>
    </Popover>
  )
}

/** A line of its own: a scan that did not happen, and the scan again. */
function FailedLine({ row, actions }: { readonly row: MatrixRow; readonly actions: BrandActions }) {
  const t = useT()
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <ScanProblem row={row} label={t("competitors.lastScanFailed")} />
      <SublineScan c={row.competitor} label={t("competitors.scanAgain")} actions={actions} />
    </span>
  )
}

/**
 * The line under a brand's name: scanning, nothing to search, no scan yet, a
 * scan that did not happen, or its totals (with a sign when some of the
 * scan's searches failed). A brand with nothing to show, or whose scan did
 * not happen, gets its scan right there. The totals are the latest scan's
 * tallies: shown once they are here, never as zeros before.
 */
function BrandSubline({ row, loading, actions }: { readonly row: MatrixRow; readonly loading: boolean; readonly actions: BrandActions }) {
  const t = useT()
  const c = row.competitor
  const muted = "truncate text-[11px] text-muted-foreground"
  if (c.scanning) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {t("competitors.scanning")}
      </span>
    )
  }
  if (c.searches === 0) {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className={muted}>{t("competitors.noSearches")}</span>
        <button type="button" onClick={() => actions.onEdit(c)} aria-describedby={nameIdOf(c)} className={cn("shrink-0 text-[11px]", LINK)}>
          {t("competitors.edit")}
        </button>
      </span>
    )
  }
  if (!c.lastScanId) {
    // No scan was ever saved: an error is the first scan not happening.
    if (c.lastScanError) return <FailedLine row={row} actions={actions} />
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className={muted}>{t("competitors.neverScanned")}</span>
        <SublineScan c={c} label={t("competitors.scanNow")} actions={actions} />
      </span>
    )
  }
  if (row.scanAt === null) {
    if (loading) return <span className="h-3 w-24 animate-pulse rounded bg-muted" />
    // A server that sends no tallies: whether the error is a part of the scan or all of it cannot be told.
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className={muted}>{lastScanLine(c, t)}</span>
        {c.lastScanError && <ScanProblem row={row} label={null} />}
      </span>
    )
  }
  const outcome = scanOutcome(row)
  if (outcome === "failed") return <FailedLine row={row} actions={actions} />
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className={muted}>{t(c.isOwn ? "competitors.brandTotalsOwn" : "competitors.brandTotals", { own: row.own, about: row.about })}</span>
      {outcome === "partial" && <ScanProblem row={row} label={null} />}
    </span>
  )
}

function BrandCell({
  row,
  hue,
  loading,
  actions,
}: {
  readonly row: MatrixRow
  readonly hue: number | undefined
  readonly loading: boolean
  readonly actions: BrandActions
}) {
  const t = useT()
  const c = row.competitor
  const busy = actions.isBusy(c)
  return (
    <th scope="row" className="sticky start-0 z-10 bg-card px-2 py-2.5 text-start font-normal">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", hue === undefined ? "bg-muted-foreground" : "brand-swatch")} style={brandHueStyle(hue)} aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => actions.onOpen(c)}
              className="truncate text-start text-[14px] font-semibold hover:underline"
              dir="auto"
              aria-label={t("competitors.openBrand", { brand: c.brand })}
              data-brand-open={c.id}
            >
              {c.brand}
            </button>
            {c.isOwn && <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10.5px] font-bold text-muted-foreground">{t("competitors.yours")}</span>}
            <span id={nameIdOf(c)} hidden>
              {c.brand}
            </span>
          </div>
          <BrandSubline row={row} loading={loading} actions={actions} />
        </div>
        <BrandRowMenu
          competitor={c}
          busy={busy}
          onScan={() => actions.onScan(c)}
          onSchedule={(schedule) => actions.onSchedule(c, schedule)}
          onEdit={() => actions.onEdit(c)}
          onRemove={() => actions.onRemove(c)}
        />
      </div>
    </th>
  )
}

/**
 * Who is where: each tracked brand against each platform — its own posts and
 * the posts about it there, from its latest scan. A platform's header ranks
 * the brands by it; pressing it again clears that.
 */
export function WhoIsWhere({
  matrix,
  rows,
  hues,
  selected,
  onSelect,
  loading,
  actions,
}: {
  readonly matrix: Matrix
  /** The rows in the order to show them. */
  readonly rows: readonly MatrixRow[]
  readonly hues: ReadonlyMap<string, number>
  readonly selected: SocialPlatform | null
  readonly onSelect: (platform: SocialPlatform | null) => void
  /** The tallies are on their way. */
  readonly loading: boolean
  readonly actions: BrandActions
}) {
  const t = useT()
  const latest = latestScanAt(matrix.rows)
  const brands = rows.length === 1 ? t("competitors.brandsCountOne") : t("competitors.brandsCount", { n: rows.length })
  const sub = latest ? t("competitors.matrixLastScan", { brands, date: shortDate(latest) }) : t("competitors.matrixNoScan", { brands })
  const selectedName = selected ? SOCIAL_PLATFORM_META[selected].name : ""
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-lg font-semibold">{t("competitors.whoIsWhere")}</h2>
          <span className="text-[13px] text-muted-foreground">{sub}</span>
        </div>
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          {selected ? t("competitors.sortPlatform", { platform: selectedName }) : t("competitors.sortTotal")}
        </p>
      </div>
      <div className="overflow-x-auto rounded-[14px] border border-border bg-card">
        {/* Fixed layout: the rank and brand columns keep their width, the platforms share the rest. */}
        <table className="w-full table-fixed border-collapse" style={{ minWidth: 256 + matrix.columns.length * 110 }}>
          <thead>
            <tr>
              <th scope="col" className="w-9">
                <span className="sr-only">{t("competitors.colRank")}</span>
              </th>
              <th scope="col" className="sticky start-0 z-10 w-[220px] bg-card px-2 py-3 text-start text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground">
                {t("competitors.colBrand")}
              </th>
              {matrix.columns.map((column) => {
                const on = selected === column.platform
                const meta = SOCIAL_PLATFORM_META[column.platform]
                return (
                  <th
                    key={column.platform}
                    scope="col"
                    aria-sort={on ? "descending" : "none"}
                    className={cn("border-b-2 p-0 transition-colors", on ? "border-primary bg-primary/[0.07]" : "border-border")}
                  >
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onSelect(on ? null : column.platform)}
                      className="flex w-full items-center gap-1.5 px-2.5 py-3 text-start transition-colors hover:bg-muted/60"
                    >
                      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-muted">{meta.icon("h-3.5 w-3.5")}</span>
                      <span className="truncate text-[13px] font-semibold">{meta.name}</span>
                      {on && <ArrowDown className="ms-auto h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.competitor.id} className="border-t border-border/70">
                <td className="text-center text-[12px] tabular-nums text-muted-foreground">{index + 1}</td>
                <BrandCell row={row} hue={hues.get(row.competitor.id)} loading={loading} actions={actions} />
                {row.cells.map((cell) => {
                  const column = matrix.columns.find((c) => c.platform === cell.platform)
                  return column ? (
                    <MatrixCellView
                      key={cell.platform}
                      cell={cell}
                      column={column}
                      hue={hues.get(row.competitor.id)}
                      isOwn={row.competitor.isOwn}
                      selected={selected === cell.platform}
                    />
                  ) : null
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
