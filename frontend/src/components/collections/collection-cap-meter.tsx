import { Progress } from "@/components/ui/progress"
import { useT } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"

/**
 * How full a collection is against the plan's records cap: "N of CAP records"
 * with a bar, and a note once the cap is reached (the oldest records are then
 * evicted as new ones arrive). With no cap (a self-hosted server without a
 * ceiling) it shows the count alone.
 */
export function CollectionCapMeter({ count, cap, className }: { readonly count: number; readonly cap: number | null; readonly className?: string }) {
  const t = useT()
  const countText = count === 1 ? t("collections.recordsCountOne") : t("collections.recordsCount", { n: formatNumber(count) })
  if (cap === null) return <p className={cn("text-xs text-muted-foreground", className)}>{countText}</p>
  const ratio = cap > 0 ? Math.min(100, Math.round((count / cap) * 100)) : 100
  const full = count >= cap
  return (
    <div className={cn("space-y-1", className)}>
      <p className={cn("text-xs", full ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
        {t("collections.capLine", { n: formatNumber(count), cap: formatNumber(cap) })}
      </p>
      <Progress value={ratio} className={cn("h-1.5", full && "[&>[data-slot=progress-indicator]]:bg-amber-500")} />
      {full && <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("collections.capReached")}</p>}
    </div>
  )
}
