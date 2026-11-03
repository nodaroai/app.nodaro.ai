import { Link } from "react-router-dom"
import { ChevronRight, ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { hasAdmin } from "@/lib/edition"
import { hasAccountStanding, useMyAccountStanding, useMyRestrictions } from "@/hooks/queries/use-my-restrictions"

/**
 * Settings → the way to Content restrictions, shown only to a person whose
 * content a complaint led to restricting, or whose account has something on
 * it under the repeat-infringer policy (a measure in force, a warning or an
 * infringement in the window): everyone else has nothing there. Both are made
 * from the admin's Complaints screen, so an edition without one never asks.
 */
export function ContentRestrictionsCard() {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const { data } = useMyRestrictions(hasAdmin())
  const { data: standing } = useMyAccountStanding(hasAdmin())
  if ((!data || data.length === 0) && !hasAccountStanding(standing)) return null
  return (
    <Link
      to="/settings/content-restrictions"
      className="mt-6 flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-base font-semibold">{t("settings.contentRestrictions")}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t("settings.contentRestrictionsDesc")}</p>
        </div>
      </div>
      <ChevronRight className={cn("h-5 w-5 text-muted-foreground", isRtl && "rotate-180")} />
    </Link>
  )
}
