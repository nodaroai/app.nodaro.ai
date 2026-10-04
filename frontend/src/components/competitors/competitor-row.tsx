"use client"

import { AlertTriangle, Lightbulb, Loader2, Pencil, Radar, Rows3, Trash2 } from "lucide-react"
import { COMPETITOR_SCHEDULES, competitorScanCreditId, competitorScanCredits, type CompetitorAccountKey, type CompetitorSchedule, type TrackedCompetitor } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { CreditCost } from "@/components/ui/credit-cost"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { useT, type MessageKey } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"

export const SCHEDULE_LABEL: Readonly<Record<CompetitorSchedule, MessageKey>> = {
  off: "competitors.scheduleOff",
  weekly: "competitors.scheduleWeekly",
  daily: "competitors.scheduleDaily",
}

function lastScanLine(c: TrackedCompetitor, t: ReturnType<typeof useT>): string {
  if (c.scanning) return t("competitors.scanning")
  if (!c.lastScanAt) return t("competitors.neverScanned")
  return t("competitors.lastScan", { date: formatDate(Date.parse(c.lastScanAt), { month: "short", day: "numeric" }) })
}

/** One tracked brand: its accounts, schedule, last scan, and the actions on it. */
export function CompetitorRow({
  competitor,
  busy,
  onScan,
  onSchedule,
  onPosts,
  onLessons,
  onEdit,
  onRemove,
}: {
  readonly competitor: TrackedCompetitor
  readonly busy?: boolean
  readonly onScan: () => void
  readonly onSchedule: (schedule: CompetitorSchedule) => void
  readonly onPosts: () => void
  /** Opens what works for the brand (lessons from its own posts). */
  readonly onLessons: () => void
  readonly onEdit: () => void
  readonly onRemove: () => void
}) {
  const t = useT()
  const c = competitor
  // The price the scan is charged: the live price, the static table until it loads.
  const credits = useModelCredits(c.searches > 0 ? competitorScanCreditId(c.searches) : undefined, competitorScanCredits(c.searches))
  const accounts = (Object.entries(c.accounts) as Array<[CompetitorAccountKey, string]>).filter(([, v]) => v)
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold" dir="auto">
            {c.brand}
          </span>
          {c.isOwn && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{t("competitors.yours")}</span>}
          <span className="flex items-center gap-1 text-muted-foreground">
            {accounts.map(([key, value]) => (
              <span key={key} title={`${SOCIAL_PLATFORM_META[key].name}: ${value}`} aria-label={`${SOCIAL_PLATFORM_META[key].name}: ${value}`}>
                {SOCIAL_PLATFORM_META[key].icon("h-3.5 w-3.5")}
              </span>
            ))}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1">
            {c.scanning && <Loader2 className="h-3 w-3 animate-spin" />}
            {lastScanLine(c, t)}
          </span>
          <span>·</span>
          <span>{c.searches === 1 ? t("competitors.searchesOne") : t("competitors.searches", { n: c.searches })}</span>
        </div>
        {c.lastScanError && (
          <p className="mt-1 flex items-start gap-1 text-[12px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span dir="auto">{c.lastScanError}</span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={c.schedule}
          onChange={(e) => onSchedule(e.target.value as CompetitorSchedule)}
          disabled={busy}
          aria-label={t("competitors.schedule")}
          className="h-8 rounded-md border border-border bg-background px-2 text-[12.5px]"
        >
          {COMPETITOR_SCHEDULES.map((s) => (
            <option key={s} value={s}>
              {t(SCHEDULE_LABEL[s])}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={onScan} disabled={busy || c.scanning || c.searches === 0}>
          <Radar className="me-1 h-3.5 w-3.5" />
          {t("competitors.scanNow")}
          <CreditCost credits={credits} prefix=" · " className="ms-0.5 opacity-80" />
        </Button>
        <Button size="sm" variant="outline" onClick={onPosts} disabled={!c.lastScanId}>
          <Rows3 className="me-1 h-3.5 w-3.5" />
          {t("competitors.posts")}
        </Button>
        <Button size="sm" variant="outline" onClick={onLessons} disabled={!c.lastScanId}>
          <Lightbulb className="me-1 h-3.5 w-3.5" />
          {t(c.isOwn ? "competitors.tabLessonsOwn" : "competitors.tabLessons")}
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit} aria-label={t("competitors.edit")} title={t("competitors.edit")}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          aria-label={t("competitors.remove")}
          title={t("competitors.remove")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  )
}
