"use client"

/**
 * The Clip Pack inspector's footer (§4.2 of the inspectors design, A4-2; M17,
 * M19, M22):
 *  - the hooks note (R20 a): hooks are text only, and the nodes that read one
 *    pick it up when they next run;
 *  - what Render final runs and what it bills again: "Render final: Render Clip
 *    ×6 → Caption Clip ×6. 4 of 6 unchanged; all 6 re-render and are billed
 *    again." (TA15 a: a repeat re-bills every kept clip);
 *  - the gate's reason (nothing kept, the rule's issues, a newer run) or, while
 *    a run holds the review, "Rendering final… clip 3 of 6 · edits locked";
 *  - Close and Render final · {n} clips · ≈{credits}, behind the gate
 *    (`reviewGate`) as the cut review's are. A clip set's review offers no
 *    Update preview here (the design's footer names Render final only).
 */
import { useState } from "react"
import { Film, Loader2 } from "lucide-react"
import type { ReviewRuns } from "@/hooks/use-review-runs"
import type { ClipCards } from "@/lib/edl-review/build-clip-cards"
import type { ClipChainStep } from "@/lib/edl-review/clip-chain"
import { creditUnits } from "@/lib/credit-units"
import { hasCredits } from "@/lib/edition"
import { useT } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { cn } from "@/lib/utils"
import { GateIssues, GateStatus, GateWarning } from "../review-gate-status"
import { RUN_BUTTON } from "../review-run-buttons"

export interface ClipFooterProps {
  readonly cards: ClipCards
  readonly runs: ReviewRuns
  readonly chain: readonly ClipChainStep[]
  readonly compact: boolean
  readonly onClose: () => void
}

/** " · ≈420" on a credit edition with a price to show. */
const approxPriceOf = (credits: number): string => (hasCredits() && credits > 0 ? ` · ≈${creditUnits(credits)}` : "")

export function ClipFooter({ cards, runs, chain, compact, onClose }: ClipFooterProps) {
  const t = useT()
  const localize = useLocalizeNodeLabel()
  const [showIssues, setShowIssues] = useState(false)
  const { gate } = runs
  const kept = cards.keptCount
  const steps = chain.map((s) => t("clipReview.chainStep", { label: localize(s.label), times: s.times })).join(" → ")
  const label = compact
    ? t("clipReview.renderFinalShort", { n: kept })
    : kept === 1 ? t("clipReview.renderFinalOne") : t("clipReview.renderFinalMany", { n: kept })
  const runningLabel = runs.running === "final" && cards.progress
    ? t("clipReview.renderingProgress", { done: Math.min(cards.progress.done + 1, cards.progress.total), total: cards.progress.total })
    : undefined
  const disabled = gate.hold !== null || runs.checkPending

  return (
    <div data-testid="clip-footer" className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">{t("clipReview.hooksNote")}</p>
      {kept > 0 && chain.length > 0 && (
        <p data-testid="clip-chain" className="text-[11px] text-muted-foreground">
          {t("clipReview.chain", { chain: steps })}
          {cards.unchangedKept > 0 && <> {t("clipReview.unchanged", { unchanged: cards.unchangedKept, total: kept })}</>}
        </p>
      )}
      <div className={cn("flex gap-2", compact ? "flex-col" : "items-center justify-end")}>
        <GateStatus gate={gate} runs={runs} showIssues={showIssues} onToggleIssues={() => setShowIssues((v) => !v)} runningLabel={runningLabel} />
        <button type="button" className={cn(RUN_BUTTON, "border-border bg-background hover:bg-accent")} onClick={onClose}>
          {t("common.close")}
        </button>
        {gate.mode === "ready" && (
          <button
            type="button"
            className={cn(RUN_BUTTON, "border-[#ff0073]/60 bg-[#ff0073] text-white hover:bg-[#ff0073]/90")}
            disabled={disabled}
            aria-busy={runs.checking === "final" || undefined}
            onClick={runs.renderFinal}
          >
            {runs.checking === "final" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Film className="h-3 w-3" aria-hidden />}
            {label}{approxPriceOf(runs.finalCredits)}
          </button>
        )}
      </div>
      <GateWarning gate={gate} />
      <GateIssues gate={gate} open={showIssues} />
    </div>
  )
}
