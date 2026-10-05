"use client"

import { MoreHorizontal, Pencil, Radar, Trash2 } from "lucide-react"
import { COMPETITOR_SCHEDULES, competitorScanCreditId, competitorScanCredits, type CompetitorSchedule, type TrackedCompetitor } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { CreditCost } from "@/components/ui/credit-cost"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { SCHEDULE_LABEL } from "./schedule-label"

/** When the brand's counts are from, or that it has none yet. */
export function lastScanLine(c: TrackedCompetitor, t: ReturnType<typeof useT>): string {
  if (c.scanning) return t("competitors.scanning")
  if (!c.lastScanAt) return t("competitors.neverScanned")
  return t("competitors.lastScan", { date: formatDate(Date.parse(c.lastScanAt), { month: "short", day: "numeric" }) })
}

/** The price a scan of the brand is charged: the live price, the static table until it loads. */
export function useScanPrice(c: Pick<TrackedCompetitor, "searches"> | null): number | null {
  const searches = c?.searches ?? 0
  return useModelCredits(searches > 0 ? competitorScanCreditId(searches) : undefined, competitorScanCredits(searches))
}

/** A brand's actions: scan now (with its price), its schedule, edit, remove. */
export function BrandRowMenu({
  competitor,
  busy,
  onScan,
  onSchedule,
  onEdit,
  onRemove,
}: {
  readonly competitor: TrackedCompetitor
  readonly busy?: boolean
  readonly onScan: () => void
  readonly onSchedule: (schedule: CompetitorSchedule) => void
  readonly onEdit: () => void
  readonly onRemove: () => void
}) {
  const t = useT()
  const c = competitor
  const credits = useScanPrice(c)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={t("competitors.brandActions", { brand: c.brand })}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">{lastScanLine(c, t)}</DropdownMenuLabel>
        <DropdownMenuItem disabled={busy || c.scanning || c.searches === 0} onSelect={onScan}>
          <Radar className="h-4 w-4" />
          {t("competitors.scanNow")}
          <CreditCost credits={credits} prefix=" · " className="opacity-80" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[12px]">{t("competitors.schedule")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={c.schedule} onValueChange={(value) => onSchedule(value as CompetitorSchedule)}>
          {COMPETITOR_SCHEDULES.map((schedule) => (
            <DropdownMenuRadioItem key={schedule} value={schedule} disabled={busy}>
              {t(SCHEDULE_LABEL[schedule])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="h-4 w-4" />
          {t("competitors.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemove} className="text-destructive focus:text-destructive">
          <Trash2 className="h-4 w-4" />
          {t("competitors.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
