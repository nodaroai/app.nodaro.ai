"use client"

/**
 * The reasons panel (§2.3 and §2.4 of the inspectors design): one row per
 * reason the cut holds (`reasonStats`, in the panel's order, the reviewer's
 * own cuts last), each with its swatch, label, how many spans of it are cut
 * and their time, and a tri-state box:
 *  - ☑ every span of it is cut: the box restores the reason (`restoreReason`,
 *    under the restore lock; spans the lock keeps stay cut, and a toast says
 *    how many and why);
 *  - ◐ some restored, ☐ all restored: the box cuts the reason again
 *    (`cutReason`).
 * Beside it, ↺ restores what is left of the reason, or ✂ cuts it again once
 * it is all restored. 🔒 replaces ↺ when no span of the reason could be
 * restored: a dry run of `restoreReason`, made only when the row is hovered or
 * focused (a whole reason's restore is the costly judgement).
 *
 * Under the list (`withIssues`): "No issues", or the plan's own issues as the
 * render rule words them (English, left-to-right). Below `sm` the issues are a
 * tab of their own (`ReviewIssues`).
 */
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check, Lock, Minus, RotateCcw, Scissors } from "lucide-react"
import type { ApplyEdlIssue } from "@nodaro/render-rules"
import type { ReviewEdits } from "@/hooks/use-review-edits"
import type { ReviewModel } from "@/hooks/use-review-model"
import { dropReasonLabel, dropReasonStyle } from "@/lib/edl-review/drop-reasons"
import { keptSetOf, MANUAL_REASON, type KeptSet } from "@/lib/edl-review/kept-set"
import { restoreReason, type LockedSpan } from "@/lib/edl-review/restore"
import { restoreLockLabel } from "@/lib/edl-review/restore-lock-labels"
import { reasonStats, type ReasonStat } from "@/lib/edl-review/review-stats"
import { useT } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"
import { toastLockedSpans } from "./span-popover"
import { useReviewFormat } from "./use-review-format"

export interface ReasonsPanelProps {
  readonly model: ReviewModel
  readonly edits: ReviewEdits
  /** List the plan's issues under the reasons (from `sm` up). */
  readonly withIssues: boolean
}

/** A reason's dry-run lock, for the K it was judged on. */
interface ReasonLocks {
  readonly kept: KeptSet
  readonly locked: Readonly<Record<string, readonly LockedSpan[]>>
}

const ICON_BUTTON = "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"

export function ReasonsPanel({ model, edits, withIssues }: ReasonsPanelProps) {
  const t = useT()
  const { base, render } = model
  // Read-only (no K): the plan as received. Deferred: a keystroke's commit
  // strikes the words, and the counts follow in the next (§2.4's cut budget).
  const kept = useDeferredValue(useMemo(() => edits.kept ?? (base ? keptSetOf(base) : null), [edits.kept, base]))
  const edited = useDeferredValue(edits.edited ?? base)
  const stats = useMemo(() => (base && edited && kept ? reasonStats(base, edited, kept) : []), [base, edited, kept])

  const [locks, setLocks] = useState<ReasonLocks | null>(null)
  const lockedOf = (reason: string): readonly LockedSpan[] | undefined =>
    locks && locks.kept === kept ? locks.locked[reason] : undefined
  const probe = useCallback((stat: ReasonStat) => {
    if (!base || !kept || !edits.canEdit || stat.state === "restored") return
    setLocks((current) => {
      const mine = current && current.kept === kept ? current : { kept, locked: {} }
      if (stat.reason in mine.locked) return current
      const result = restoreReason(kept, base, stat.reason, render)
      // Every span stayed cut: K came back as it went in.
      const all = result.kept === kept ? result.locked : []
      return { kept, locked: { ...mine.locked, [stat.reason]: all } }
    })
  }, [base, kept, edits.canEdit, render])

  const restore = useCallback((reason: string) => toastLockedSpans(edits.restoreReason(reason)), [edits])

  return (
    <div className="flex flex-col gap-3" data-testid="reasons-panel">
      <section className="flex flex-col gap-1">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("edlReview.reasonsTitle")}</h3>
        {stats.map((stat) => (
          <ReasonRow
            key={stat.reason}
            stat={stat}
            locked={lockedOf(stat.reason)}
            canEdit={edits.canEdit}
            onProbe={probe}
            onRestore={restore}
            onCut={edits.cutReason}
          />
        ))}
      </section>
      {withIssues && <ReviewIssues problems={model.planProblems} />}
    </div>
  )
}

interface ReasonRowProps {
  readonly stat: ReasonStat
  /** The dry run's locked spans, when every span stays cut; undefined until probed. */
  readonly locked: readonly LockedSpan[] | undefined
  readonly canEdit: boolean
  readonly onProbe: (stat: ReasonStat) => void
  readonly onRestore: (reason: string) => void
  readonly onCut: (reason: string) => void
}

const ReasonRow = memo(function ReasonRow({ stat, locked, canEdit, onProbe, onRestore, onCut }: ReasonRowProps) {
  const t = useT()
  const format = useReviewFormat()
  const label = dropReasonLabel(stat.reason, t)
  const allLocked = locked !== undefined && locked.length > 0
  const checked = stat.state === "cut" ? true : stat.state === "partial" ? "indeterminate" : false

  return (
    <div
      data-reason={stat.reason}
      className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/50"
      onPointerEnter={() => onProbe(stat)}
      onFocus={() => onProbe(stat)}
    >
      <CheckboxPrimitive.Root
        checked={checked}
        disabled={!canEdit}
        aria-label={t("edlReview.reasonBox", { reason: label })}
        onCheckedChange={(next) => (next === true ? onCut(stat.reason) : onRestore(stat.reason))}
        className="grid size-4 shrink-0 place-content-center rounded-[4px] border border-input outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:text-primary"
      >
        <CheckboxPrimitive.Indicator>
          {stat.state === "partial" ? <Minus className="size-3" /> : <Check className="size-3" />}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span className={cn("size-2 shrink-0 rounded-full", dropReasonStyle(stat.reason).swatch)} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {t("edlReview.reasonCount", { n: formatNumber(stat.cutSpans), length: format.length(stat.cutMs) })}
      </span>
      {allLocked ? (
        <span
          data-testid="reason-locked"
          className="p-1 text-amber-700 dark:text-amber-400"
          title={t("edlReview.cantRestore", { reason: restoreLockLabel(locked[0]!.reason, t) })}
        >
          <Lock className="h-3 w-3" aria-hidden />
        </span>
      ) : canEdit && stat.state !== "restored" ? (
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={t("edlReview.restoreAll", { reason: label, n: stat.cutSpans })}
          title={t("edlReview.restoreAll", { reason: label, n: stat.cutSpans })}
          onClick={() => onRestore(stat.reason)}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      ) : canEdit && stat.reason !== MANUAL_REASON ? (
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={t("edlReview.cutAllAgain", { reason: label, n: stat.planSpans })}
          title={t("edlReview.cutAllAgain", { reason: label, n: stat.planSpans })}
          onClick={() => onCut(stat.reason)}
        >
          <Scissors className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  )
})

/** "No issues", or the plan's own issues in the render rule's words. */
export function ReviewIssues({ problems }: { readonly problems: readonly ApplyEdlIssue[] }) {
  const t = useT()
  if (problems.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3 w-3 text-emerald-600" aria-hidden />
        {t("edlReview.noIssues")}
      </p>
    )
  }
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("edlReview.issuesTitle")}</h3>
      <ul dir="ltr" data-testid="review-issues" className="flex flex-col gap-0.5">
        {problems.map((issue, i) => (
          <li key={i} className="break-words rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] leading-snug">{issue.message}</li>
        ))}
      </ul>
    </section>
  )
}
