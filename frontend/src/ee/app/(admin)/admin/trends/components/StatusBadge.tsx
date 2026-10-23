import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { TrendStatus } from "@/lib/api"

const STYLES: Readonly<Record<TrendStatus, string>> = {
  published: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  draft: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  unpublished: "border-muted-foreground/30 bg-muted text-muted-foreground",
}

export function StatusBadge({ status }: { readonly status: TrendStatus }) {
  return (
    <Badge variant="outline" className={cn("text-[11px] font-medium", STYLES[status])}>
      {status}
    </Badge>
  )
}
