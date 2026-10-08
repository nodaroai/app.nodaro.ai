"use client"

/**
 * What the footer says about the runs' gate (§2.5 of the inspectors design),
 * shared by the cut review's footer and the Clip Pack inspector's: "View only"
 * on a read-only canvas, "Rendering final… 34% · edits locked" while a run
 * holds the review, or why the runs are held — nothing kept, the rule's issues
 * (a toggle that lists them, left-to-right, `GateIssues`), a newer run to load
 * first, the newer-run check still out.
 */
import { ChevronDown, Loader2 } from "lucide-react"
import type { ReviewRuns } from "@/hooks/use-review-runs"
import type { ReviewGate, ReviewGateHold } from "@/lib/edl-review/review-gate"
import { useT, type TFunction } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function holdText(hold: ReviewGateHold, t: TFunction): string {
  switch (hold.kind) {
    case "refused": return t(hold.reason)
    case "nothing-kept": return t("edlReview.nothingKept")
    case "issues": return hold.issues.length === 1 ? t("edlReview.fixIssuesOne") : t("edlReview.fixIssuesMany", { n: hold.issues.length })
    case "newer-run": return t("edlReview.loadNewerFirst")
    case "checking-newer": return t("edlReview.checkingNewer")
    case "judging": return ""
  }
}

/** "⟳ Rendering final… 34% · edits locked" (M5, M19). */
export function RunningNote({ runs, label }: { readonly runs: ReviewRuns; readonly label?: string }) {
  const t = useT()
  const text = label ?? (runs.running === "final"
    ? t("edlReview.renderingFinal")
    : runs.running === "proxy" ? t("edlReview.updatingPreview") : t("edlReview.runInProgress"))
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      <span className="tabular-nums">
        {label === undefined && runs.progress !== null ? `${text} ${runs.progress}%` : text} · {t("edlReview.editsLocked")}
      </span>
    </span>
  )
}

export interface GateStatusProps {
  readonly gate: ReviewGate
  readonly runs: ReviewRuns
  readonly showIssues: boolean
  readonly onToggleIssues: () => void
  /** Replaces the running note's text (the Clip Pack names the clip). */
  readonly runningLabel?: string
}

export function GateStatus({ gate, runs, showIssues, onToggleIssues, runningLabel }: GateStatusProps) {
  const t = useT()
  if (gate.mode === "view-only") return <span className="text-xs text-muted-foreground">{t("edlReview.viewOnly")}</span>
  if (gate.mode === "running") return <RunningNote runs={runs} label={runningLabel} />
  if (gate.mode !== "ready" || !gate.hold) return null
  const hold = holdText(gate.hold, t)
  if (gate.hold.kind === "issues") {
    return (
      <button type="button" className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" aria-expanded={showIssues} onClick={onToggleIssues}>
        {hold}
        <ChevronDown className={cn("h-3 w-3 transition-transform", showIssues && "rotate-180")} />
      </button>
    )
  }
  return <span className="text-xs text-muted-foreground">{hold}</span>
}

/** The caveat under the footer when the newer-run check timed out unanswered. */
export function GateWarning({ gate }: { readonly gate: ReviewGate }) {
  const t = useT()
  if (gate.mode !== "ready" || gate.warning !== "newer-unchecked") return null
  return (
    <p role="status" data-testid="footer-warning" className="text-xs text-amber-700 dark:text-amber-400">
      {t("edlReview.newerUnchecked")}
    </p>
  )
}

/** The rule's issues, in its own words (left-to-right), under an open "Fix n issues first". */
export function GateIssues({ gate, open }: { readonly gate: ReviewGate; readonly open: boolean }) {
  const issues = gate.hold?.kind === "issues" ? gate.hold.issues : null
  if (!issues || !open) return null
  return (
    <ul dir="ltr" data-testid="footer-issues" className="flex max-h-32 flex-col gap-0.5 overflow-auto">
      {issues.map((issue, i) => (
        <li key={i} className="break-words rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] leading-snug">{issue}</li>
      ))}
    </ul>
  )
}
