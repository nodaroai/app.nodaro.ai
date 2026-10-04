"use client"

import { Trophy } from "lucide-react"
import type { AdviceRecord } from "@nodaro/shared"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { familyLabel, ratioText, recordDots, recordPill } from "./card-outcome-text"

const DOT: Readonly<Record<"worked" | "flat" | "missed", string>> = {
  worked: "bg-emerald-500",
  flat: "bg-muted-foreground/50",
  missed: "border border-muted-foreground/40 bg-transparent",
}

/**
 * How each family of advice went for the person ("Sound advice: 3 of 4
 * worked for you"), one dot per post judged. Only the families with enough
 * verdicts to say something; nothing at all before that.
 */
export function AdviceRecordList({ record, className }: { readonly record: readonly AdviceRecord[] | undefined; readonly className?: string }) {
  const t = useT()
  const shown = (record ?? []).filter((r) => r.shown)
  if (shown.length === 0) return null
  return (
    <section className={cn("flex flex-col gap-2 rounded-xl border bg-card p-3", className)}>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-extrabold">
        <Trophy className="h-4 w-4 text-amber-500" />
        {t("marks.recordTitle")}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {shown.map((r) => (
          <li key={r.family} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-[9rem] text-[12.5px] font-semibold">{familyLabel(r.family, t)}</span>
            <span className="flex items-center gap-1" aria-hidden>
              {recordDots(r).map((state, i) => (
                <span key={i} className={cn("h-2.5 w-2.5 rounded-full", DOT[state])} />
              ))}
            </span>
            <span className="text-[12px] tabular-nums">{recordPill(r, t)}</span>
            <span className="text-[11.5px] text-muted-foreground tabular-nums">{t("marks.recordAvg", { ratio: ratioText(r.avgRatio, t) })}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">{t("marks.method")}</p>
    </section>
  )
}
