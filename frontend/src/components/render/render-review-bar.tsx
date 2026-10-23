"use client"

/**
 * The bar under a render's Preview: Render final, and — with the stop rule
 * on — Update preview. ONE bar for every surface that reviews a render: the
 * editor's node (A6.1) and the app runner's output card on the Run tab, in
 * Presentation and on mobile (A6.3). Each surface supplies its own actions and
 * prices (`RenderReviewBarView`); the editor's come from `useRenderFinal`.
 *
 * Mounted only while the take on display IS a Preview: the prices are computed
 * on every graph change, so the bar must not be live on every render card.
 */
import { useId, type ReactNode } from "react"
import { Film, Loader2, RefreshCw } from "lucide-react"
import { useRenderFinal } from "@/hooks/use-render-final"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { renderRunRefusalKey } from "@/lib/render-review-adapter"
import { usecaseRenderFinalRefusalKey } from "@/lib/use-case-render-final-target"
import type { UgcPriceState } from "@/components/editor/workflow-editor/ugc-run-estimate"
import type { RunUnpriced } from "@/components/editor/workflow-editor/run-unpriced"
import { runPriceSuffix, runPriceTitle } from "./run-price"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const BUTTON =
  "nodrag nopan inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"

export interface RenderReviewBarViewProps {
  readonly onRenderFinal: () => void
  /** Credits Render final will charge; 0 outside credit editions. */
  readonly finalCredits: number
  /** Render final's price is marked as an estimate: its UGC part's figure is not the server's checked one, and why. */
  readonly finalUnchecked?: UgcPriceState
  /** Update preview, where the surface offers it. */
  readonly onUpdatePreview?: () => void
  readonly previewCredits?: number
  /** Update preview's price is marked likewise. */
  readonly previewUnchecked?: UgcPriceState
  /** Render final's price holds a metered LLM call's estimate (charged its actual usage): shown approximate. */
  readonly finalApprox?: boolean
  /** Update preview's, likewise. */
  readonly previewApprox?: boolean
  /** Render final's run holds a node the server refuses to price: no figure, "not priced yet", the server's sentence on hover. */
  readonly finalUnpriced?: RunUnpriced
  /** Update preview's, likewise. */
  readonly previewUnpriced?: RunUnpriced
  /** A run is in progress: the buttons wait, and say why. */
  readonly busy: boolean
  /** Why they wait (default: a run is in progress). */
  readonly busyReason?: string
  /** A click on any render is waiting on its newer-run check (decided
   *  2026-10-07): both buttons are disabled. */
  readonly checkPending?: boolean
  /** This bar's button whose click is waiting on that check: it alone shows
   *  a spinner and aria-busy. */
  readonly checking?: "final" | "proxy" | null
  /** The Render final button's label (default: "Render final"). */
  readonly finalLabel?: string
  /** A line under the buttons (the app runner's "charged to you" note). */
  readonly note?: ReactNode
  /** No run of this render can go ahead at all (Speaker View until it is
   *  priced, C4): both buttons are disabled, show no price, and this says why
   *  under them — never a price that is not real. */
  readonly disabledReason?: string
  readonly className?: string
}

/** The bar itself: Render final, Update preview when offered, with their prices. */
export function RenderReviewBarView({
  onRenderFinal,
  finalCredits,
  finalUnchecked,
  finalApprox,
  onUpdatePreview,
  previewCredits = 0,
  previewUnchecked,
  previewApprox,
  finalUnpriced,
  previewUnpriced,
  busy,
  busyReason,
  checkPending = false,
  checking = null,
  finalLabel,
  note,
  disabledReason,
  className,
}: RenderReviewBarViewProps) {
  const t = useT()
  const reasonId = useId()
  const blocked = disabledReason !== undefined
  const price = (credits: number, unchecked?: UgcPriceState, approx?: boolean, unpriced?: RunUnpriced) =>
    blocked ? "" : runPriceSuffix(t, credits, unchecked, { approx: approx === true, ...(unpriced ? { unpriced } : {}) })
  const waiting = blocked ? disabledReason : busy ? (busyReason ?? t("renderFinal.inProgress")) : undefined
  // Nothing in the way: a price marked as an estimate says why on its button.
  const titleOf = (credits: number, unchecked?: UgcPriceState, unpriced?: RunUnpriced) =>
    waiting ?? (price(credits, unchecked, false, unpriced) ? runPriceTitle(t, unchecked, unpriced) : undefined)
  const off = blocked || busy || checkPending || checking !== null
  const described = blocked ? reasonId : undefined

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1.5" role="group">
        <button
          type="button"
          className={cn(BUTTON, "border-[#ff0073]/60 bg-cta text-white hover:bg-cta-hover")}
          disabled={off}
          aria-busy={checking === "final" || undefined}
          aria-describedby={described}
          title={titleOf(finalCredits, finalUnchecked, finalUnpriced)}
          onClick={onRenderFinal}
        >
          {checking === "final" ? <CheckSpinner /> : <Film className="h-3 w-3 shrink-0" aria-hidden />}
          <span className="truncate">{finalLabel ?? t("renderFinal.action")}{price(finalCredits, finalUnchecked, finalApprox, finalUnpriced)}</span>
        </button>
        {onUpdatePreview && (
          <button
            type="button"
            className={cn(BUTTON, "border-border bg-background hover:bg-accent")}
            disabled={off}
            aria-busy={checking === "proxy" || undefined}
            aria-describedby={described}
            title={titleOf(previewCredits, previewUnchecked, previewUnpriced)}
            onClick={onUpdatePreview}
          >
            {checking === "proxy" ? <CheckSpinner /> : <RefreshCw className="h-3 w-3 shrink-0" aria-hidden />}
            <span className="truncate">{t("renderFinal.updatePreview")}{price(previewCredits, previewUnchecked, previewApprox, previewUnpriced)}</span>
          </button>
        )}
      </div>
      {blocked && (
        <p id={reasonId} data-testid="render-review-refusal" className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
          {disabledReason}
        </p>
      )}
      {note && <p className="text-[10px] leading-snug text-muted-foreground">{note}</p>}
    </div>
  )
}

/** The spinner a button shows in place of its icon while its newer-run check is out. */
function CheckSpinner() {
  return (
    <span data-testid="check-spinner" className="inline-flex shrink-0" aria-hidden>
      <Loader2 className="h-3 w-3 animate-spin" />
    </span>
  )
}

interface RenderReviewBarProps {
  readonly renderId: string
  /** This render is running or queued: the buttons wait for it. */
  readonly busy: boolean
  readonly className?: string
}

/** The editor's bar: Render final always; Update preview with the flag on (decided 2026-10-06).
 *  A render that cannot run at all (`renderRunRefusalKey`), or a use-case node
 *  whose Render final cannot go ahead now (`usecaseRenderFinalRefusalKey`: a
 *  clip set whose review keeps no clip), shows them disabled, with why. */
export function RenderReviewBar({ renderId, busy, className }: RenderReviewBarProps) {
  const t = useT()
  const { renderFinal, updatePreview, finalCredits, previewCredits, finalUnchecked, previewUnchecked, finalApprox, previewApprox, finalUnpriced, previewUnpriced, canUpdatePreview, checkPending, checking } = useRenderFinal(renderId)
  const refusal = useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === renderId)
    return renderRunRefusalKey(node) ?? usecaseRenderFinalRefusalKey(node)
  })
  return (
    <RenderReviewBarView
      onRenderFinal={renderFinal}
      finalCredits={finalCredits}
      finalUnchecked={finalUnchecked}
      finalApprox={finalApprox === true}
      {...(finalUnpriced ? { finalUnpriced } : {})}
      {...(canUpdatePreview ? { onUpdatePreview: updatePreview, previewCredits, previewUnchecked, previewApprox: previewApprox === true, ...(previewUnpriced ? { previewUnpriced } : {}) } : {})}
      busy={busy}
      checkPending={checkPending}
      checking={checking}
      {...(refusal ? { disabledReason: t(refusal) } : {})}
      className={className}
    />
  )
}
