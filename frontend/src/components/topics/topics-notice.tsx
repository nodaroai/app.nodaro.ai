"use client"

import { Link } from "react-router-dom"
import { Lock, PlugZap } from "lucide-react"
import { plansOnSale } from "@/lib/plans-on-sale"
import { useT } from "@/lib/i18n"
import { interpolateNodes } from "@/lib/i18n/interpolate-nodes"

/**
 * The plan has no topics: where they come from, with the plans a press away
 * where they can be bought; a neutral word elsewhere (a prepaid deployment).
 */
export function TopicsLocked() {
  const t = useT()
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-sm leading-normal">
        {plansOnSale()
          ? interpolateNodes(t("topics.lockedPlans"), {
              link: (
                <Link to="/pricing" className="font-semibold underline">
                  {t("credits.viewPlans")}
                </Link>
              ),
            })
          : t("topics.locked")}
      </p>
    </div>
  )
}

/** This server has no topic tracking (an older one, or an edition without it), or it is not ready yet. */
export function TopicsUnavailable() {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <PlugZap className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
      <p className="max-w-md text-sm text-muted-foreground">{t("topics.unavailable")}</p>
    </div>
  )
}
