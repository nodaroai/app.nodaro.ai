"use client"

/**
 * The bar under a render's Preview (Track A6.1): Render final, and — with the
 * stop rule on — Update preview. It shows while the take on display IS a
 * Preview (the node decides, from the take's stamp); each button quotes the
 * run's own price. Render final stays available with the rollout flag off, as
 * "re-render at Final"; Update preview needs the flag (decided 2026-10-06).
 *
 * Mounted only while the take on display is a Preview: the prices are computed
 * on every graph change, so the bar must not be live on every render card.
 */
import { Film, RefreshCw } from "lucide-react"
import { useRenderFinal } from "@/hooks/use-render-final"
import { hasCredits } from "@/lib/edition"
import { creditUnits } from "@/lib/credit-units"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface RenderReviewBarProps {
  readonly renderId: string
  /** This render is running or queued: the buttons wait for it. */
  readonly busy: boolean
  readonly className?: string
}

const BUTTON =
  "nodrag nopan inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"

export function RenderReviewBar({ renderId, busy, className }: RenderReviewBarProps) {
  const t = useT()
  const { renderFinal, updatePreview, finalCredits, previewCredits, canUpdatePreview } = useRenderFinal(renderId)
  const price = (credits: number) => (hasCredits() && credits > 0 ? ` · ${creditUnits(credits)}` : "")
  const waiting = busy ? t("renderFinal.inProgress") : undefined

  return (
    <div className={cn("flex items-center gap-1.5", className)} role="group">
      <button
        type="button"
        className={cn(BUTTON, "border-[#ff0073]/60 bg-[#ff0073] text-white hover:bg-[#ff0073]/90")}
        disabled={busy}
        title={waiting}
        onClick={renderFinal}
      >
        <Film className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{t("renderFinal.action")}{price(finalCredits)}</span>
      </button>
      {canUpdatePreview && (
        <button
          type="button"
          className={cn(BUTTON, "border-border bg-background hover:bg-accent")}
          disabled={busy}
          title={waiting}
          onClick={updatePreview}
        >
          <RefreshCw className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{t("renderFinal.updatePreview")}{price(previewCredits)}</span>
        </button>
      )}
    </div>
  )
}
