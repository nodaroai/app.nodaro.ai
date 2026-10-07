"use client"

/**
 * The review's Update preview and Render final buttons, each with its price,
 * behind the footer's gate (§2.5 of the inspectors design): shown only while
 * the gate is `ready`, disabled while something holds the runs or a click's
 * newer-run check is out (decided 2026-10-07), the clicked one busy. Update
 * preview shows only with the stop rule on (`canUpdatePreview`). The footer
 * and the player's no-take and load-error states (M24) show the same pair.
 */
import { Film, Loader2, RefreshCw } from "lucide-react"
import type { ReviewRuns } from "@/hooks/use-review-runs"
import { creditUnits } from "@/lib/credit-units"
import { hasCredits } from "@/lib/edition"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const BUTTON =
  "inline-flex items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"

/** " · {credits}" on a credit edition with a price to show. */
export const priceOf = (credits: number): string => (hasCredits() && credits > 0 ? ` · ${creditUnits(credits)}` : "")

export function ReviewRunButtons({ runs }: { readonly runs: ReviewRuns }) {
  const t = useT()
  if (runs.gate.mode !== "ready") return null
  const disabled = runs.gate.hold !== null || runs.checkPending
  return (
    <>
      {runs.canUpdatePreview && (
        <button
          type="button"
          className={cn(BUTTON, "border-border bg-background hover:bg-accent")}
          disabled={disabled}
          aria-busy={runs.checking === "proxy" || undefined}
          onClick={runs.updatePreview}
        >
          {runs.checking === "proxy" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
          {t("renderFinal.updatePreview")}{priceOf(runs.previewCredits)}
        </button>
      )}
      <button
        type="button"
        className={cn(BUTTON, "border-[#ff0073]/60 bg-[#ff0073] text-white hover:bg-[#ff0073]/90")}
        disabled={disabled}
        aria-busy={runs.checking === "final" || undefined}
        onClick={runs.renderFinal}
      >
        {runs.checking === "final" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Film className="h-3 w-3" aria-hidden />}
        {t("renderFinal.action")}{priceOf(runs.finalCredits)}
      </button>
    </>
  )
}
