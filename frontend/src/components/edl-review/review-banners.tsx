"use client"

/**
 * The banners above the transcript (§2.3 of the inspectors design, M2 and
 * M7), stacked in this order:
 *  - the plan cannot be edited here (its segments overlap or run backwards):
 *    the inspector opens read-only;
 *  - the edit was made on an earlier plan and no longer applies (TA13), with
 *    Discard them;
 *  - the plan as made breaks the render's rule: its own refusal, said once
 *    (the issues are listed with the reasons), never a lock;
 *  - the take on display predates the edit (R4 a: no count of changes, a
 *    basis cannot count them), with Update preview behind the footer's gate;
 *  - a newer run finished while the review was closed (TA3 c), with Load its
 *    results (M2 stacks it under the stale preview); like Discard, the action
 *    is not offered while edits are locked (a read-only canvas, or a live run
 *    that includes the render would be overwritten by the earlier results);
 *  - Cuts-only: no transcript is loaded (R5 a).
 */
import type { ReactNode } from "react"
import { AlertTriangle, Info } from "lucide-react"
import type { ReviewChecks } from "@/hooks/use-review-checks"
import type { ReviewEdits } from "@/hooks/use-review-edits"
import type { ReviewModel } from "@/hooks/use-review-model"
import type { ReviewRuns } from "@/hooks/use-review-runs"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { priceOf } from "./review-run-buttons"

export interface ReviewBannersProps {
  readonly model: ReviewModel
  readonly edits: ReviewEdits
  readonly checks: ReviewChecks
  readonly runs: ReviewRuns
}

export const BANNER_ACTION = "shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"

export function Banner({ id, tone = "info", children, action }: { readonly id: string; readonly tone?: "info" | "warn"; readonly children: ReactNode; readonly action?: ReactNode }) {
  const Icon = tone === "warn" ? AlertTriangle : Info
  return (
    <div
      data-testid={`banner-${id}`}
      className={cn(
        "flex items-start gap-2 border-b border-border px-3 py-2 text-xs",
        tone === "warn" ? "bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-muted/40 text-foreground",
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  )
}

export function ReviewBanners({ model, edits, checks, runs }: ReviewBannersProps) {
  const t = useT()
  if (!model.base) return null
  const problems = model.planProblems.length
  const { gate } = runs
  const canRun = gate.mode === "ready"

  return (
    <div className="flex shrink-0 flex-col">
      {!model.reviewable && <Banner id="not-reviewable">{t("edlReview.notReviewable")}</Banner>}
      {model.editStatus === "stale" && (
        <Banner
          id="stale-edit"
          tone="warn"
          action={!model.locked && (
            <button type="button" className={BANNER_ACTION} onClick={edits.discardStaleEdit}>{t("edlReview.discardEdits")}</button>
          )}
        >
          {t("edlReview.staleEdit")}
        </Banner>
      )}
      {problems > 0 && (
        <Banner id="plan-refused" tone="warn">
          {problems === 1 ? t("edlReview.planRefusedOne") : t("edlReview.planRefusedMany", { n: problems })}
        </Banner>
      )}
      {checks.staleTake && (
        <Banner
          id="stale-take"
          action={canRun && runs.canUpdatePreview && (
            <button type="button" className={BANNER_ACTION} disabled={gate.hold !== null} onClick={runs.updatePreview}>
              {t("renderFinal.updatePreview")}{priceOf(runs.previewCredits)}
            </button>
          )}
        >
          {t("edlReview.staleTake")}
        </Banner>
      )}
      {model.newerRun && (
        <Banner
          id="newer-run"
          tone="warn"
          action={!model.locked && (
            <button type="button" className={BANNER_ACTION} onClick={model.loadNewerRun}>{t("renderFinal.loadNewerRun")}</button>
          )}
        >
          {t("edlReview.newerRunBanner")}
        </Banner>
      )}
      {!model.transcript && <Banner id="cuts-only">{t("edlReview.cutsOnly")}</Banner>}
    </div>
  )
}
