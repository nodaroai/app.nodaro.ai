import { useState } from "react"
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useT } from "@/lib/i18n"
import { formatDate, formatNumber } from "@/lib/i18n/format"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"

interface MonthPickerProps {
  /** The month shown ("YYYY-MM"). */
  readonly month: string
  /** Conversations per month ("YYYY-MM" → count); months absent have none. */
  readonly counts: ReadonlyMap<string, number>
  readonly onChange: (month: string) => void
  /** Today's month ("YYYY-MM"), marked in the list. */
  readonly currentMonth: string
}

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))

function monthLabel(year: number, month: string, style: "long" | "short"): string {
  return formatDate(new Date(Date.UTC(year, Number(month) - 1, 15)), { month: style, timeZone: "UTC" })
}

/** The years the switcher reaches: every year with conversations, and this one. */
function yearRange(counts: ReadonlyMap<string, number>, currentMonth: string): { min: number; max: number } {
  const years = [...counts.keys()].map((m) => Number(m.slice(0, 4))).concat(Number(currentMonth.slice(0, 4)))
  return { min: Math.min(...years), max: Math.max(...years) }
}

/** A year with its arrows, then a dropdown of its twelve months with their counts. */
export function MonthPicker({ month, counts, onChange, currentMonth }: MonthPickerProps) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const [open, setOpen] = useState(false)
  const year = Number(month.slice(0, 4))
  const { min, max } = yearRange(counts, currentMonth)

  /** Switching year lands on its latest month with conversations, else this month (this year) or December. */
  const goToYear = (next: number) => {
    const withData = MONTHS.map((m) => `${next}-${m}`).filter((m) => (counts.get(m) ?? 0) > 0)
    const fallback = String(next) === currentMonth.slice(0, 4) ? currentMonth : `${next}-12`
    onChange(withData.at(-1) ?? fallback)
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => goToYear(year - 1)}
        disabled={year <= min}
        aria-label={t("mcpconv.prevYear")}
      >
        <ChevronLeft className={cn("h-4 w-4", isRtl && "rotate-180")} aria-hidden />
      </Button>
      <span className="min-w-[3rem] text-center text-sm font-semibold tabular-nums">{year}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => goToYear(year + 1)}
        disabled={year >= max}
        aria-label={t("mcpconv.nextYear")}
      >
        <ChevronRight className={cn("h-4 w-4", isRtl && "rotate-180")} aria-hidden />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" aria-label={t("mcpconv.monthMenu")}>
            {monthLabel(year, month.slice(5, 7), "long")}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <div className="grid grid-cols-2 gap-1" role="listbox" aria-label={t("mcpconv.monthMenu")}>
            {MONTHS.map((m) => {
              const key = `${year}-${m}`
              const count = counts.get(key) ?? 0
              const selected = key === month
              const isNow = key === currentMonth
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={count === 0 && !isNow}
                  onClick={() => {
                    onChange(key)
                    setOpen(false)
                  }}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2 py-1.5 text-start text-xs transition-colors",
                    "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
                    selected && "bg-accent font-semibold",
                  )}
                >
                  <span className="flex items-center gap-1">
                    {isNow && <Check className="h-3 w-3 text-[#ff0073]" aria-hidden />}
                    {monthLabel(year, m, "short")}
                    {isNow && <span className="text-[11px] text-[#ff0073]">{t("mcpconv.now")}</span>}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{formatNumber(count)}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setOpen(false)}>
              {t("common.done")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
