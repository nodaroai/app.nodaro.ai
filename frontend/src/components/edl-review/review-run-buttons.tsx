"use client"

/**
 * The review's Update preview and Render final buttons, each with its price,
 * behind the footer's gate (§2.5 of the inspectors design): shown only while
 * the gate is `ready`, disabled while something holds the runs or a click's
 * newer-run check is out (decided 2026-10-07), the clicked one busy. Update
 * preview shows only with the stop rule on (`canUpdatePreview`); Render final
 * only where it can go ahead (`canRenderFinal`: a use-case node's only on a
 * Preview its run can finish). The footer
 * and the player's no-take and load-error states (M24) show the same pair.
 */
import { Film, Loader2, RefreshCw } from "lucide-react"
import type { ReviewRuns } from "@/hooks/use-review-runs"
import { runPriceSuffix, runPriceTitle } from "@/components/render/run-price"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export const RUN_BUTTON =
  "inline-flex items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"


export function ReviewRunButtons({ runs }: { readonly runs: ReviewRuns }) {
  const t = useT()
  if (runs.gate.mode !== "ready") return null
  const disabled = runs.gate.hold !== null || runs.checkPending
  return (
    <>
      {runs.canUpdatePreview && (
        <button
          type="button"
          className={cn(RUN_BUTTON, "border-border bg-background hover:bg-accent")}
          disabled={disabled}
          aria-busy={runs.checking === "proxy" || undefined}
          title={runs.previewUnpriced || runs.previewCredits > 0 ? runPriceTitle(t, runs.previewUnchecked, runs.previewUnpriced) : undefined}
          onClick={runs.updatePreview}
        >
          {runs.checking === "proxy" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
          {t("renderFinal.updatePreview")}{runPriceSuffix(t, runs.previewCredits, runs.previewUnchecked, { approx: runs.previewApprox === true, unpriced: runs.previewUnpriced })}
        </button>
      )}
      {runs.canRenderFinal && (
      <button
        type="button"
        className={cn(RUN_BUTTON, "border-[#ff0073]/60 bg-cta text-white hover:bg-cta-hover")}
        disabled={disabled}
        aria-busy={runs.checking === "final" || undefined}
        title={runs.finalUnpriced || runs.finalCredits > 0 ? runPriceTitle(t, runs.finalUnchecked, runs.finalUnpriced) : undefined}
        onClick={runs.renderFinal}
      >
        {runs.checking === "final" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Film className="h-3 w-3" aria-hidden />}
        {t("renderFinal.action")}{runPriceSuffix(t, runs.finalCredits, runs.finalUnchecked, { approx: runs.finalApprox === true, unpriced: runs.finalUnpriced })}
      </button>
      )}
    </>
  )
}
