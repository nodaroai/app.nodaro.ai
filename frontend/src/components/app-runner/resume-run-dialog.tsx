"use client"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { formatNodeType } from "@/components/editor/execution-utils"
import { creditUnits } from "@/lib/credit-units"
import { hasCredits } from "@/lib/edition"
import { useT, type MessageKey, type TFunction } from "@/lib/i18n"
import type { ResumeDialogState } from "./use-run-slots"

/** Why a run cannot be continued, in the runner's words, by the server's code. */
const REFUSAL_KEYS: Readonly<Record<string, MessageKey>> = {
  app_run_version_unavailable: "runner.retryVersionGone",
  app_run_version_changed: "runner.retryVersionChanged",
  continuation_not_failed: "runner.retryNotFailed",
  continuation_subset_required: "runner.retryNothingLeft",
}

/** The confirmation's words for a state: its title, what it says, and whether Retry can be pressed. */
export function resumeDialogText(state: ResumeDialogState | null, t: TFunction): {
  readonly title: string
  readonly body: string
  readonly notes: readonly string[]
  readonly steps: readonly string[]
  readonly canRetry: boolean
} {
  if (!state) return { title: "", body: "", notes: [], steps: [], canRetry: false }
  if (state.error) {
    const key = state.error.code ? REFUSAL_KEYS[state.error.code] : undefined
    return {
      title: t("runner.retryTitle"),
      body: key ? t(key) : t("runner.retryUnavailable", { message: state.error.message }),
      notes: [t("runner.startOverNote")],
      steps: [],
      canRetry: false,
    }
  }
  const plan = state.plan
  if (!plan) return { title: t("runner.retryTitle"), body: t("runner.retryChecking"), notes: [], steps: [], canRetry: false }
  const credits = hasCredits() && plan.estimatedCredits !== null ? plan.estimatedCredits : null
  const notes = [
    ...(plan.reusedClips === 1 ? [t("runner.retryReusedClipOne")] : plan.reusedClips > 1 ? [t("runner.retryReusedClips", { n: plan.reusedClips })] : []),
    ...(plan.sufficient === false ? [t("runner.retryInsufficient")] : []),
    t("runner.retryInputsNote"),
  ]
  return {
    title: credits !== null ? t("runner.retryTitleCredits", { credits: creditUnits(credits) }) : t("runner.retryTitle"),
    body: t("runner.retryBody"),
    notes,
    steps: plan.steps.map((s) => s.label ?? formatNodeType(s.type)),
    canRetry: plan.sufficient !== false,
  }
}

/**
 * Retry of a failed app run, always confirmed first: the steps that will run again (everything
 * the run finished is kept and reused) and their price, with Start over beside it.
 */
export function ResumeRunDialog({
  state,
  onConfirm,
  onStartOver,
  onCancel,
}: {
  readonly state: ResumeDialogState | null
  readonly onConfirm: () => void
  readonly onStartOver: () => void
  readonly onCancel: () => void
}) {
  const t = useT()
  const text = resumeDialogText(state, t)
  return (
    <AlertDialog open={state !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
      <AlertDialogContent data-testid="resume-run-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.body}</AlertDialogDescription>
        </AlertDialogHeader>
        {text.steps.length > 0 && (
          <ul className="list-disc ps-5 text-sm text-foreground space-y-0.5" data-testid="resume-run-steps">
            {text.steps.map((step, i) => <li key={`${i}-${step}`}>{step}</li>)}
          </ul>
        )}
        {text.notes.map((note) => (
          <p key={note} className="text-xs text-muted-foreground">{note}</p>
        ))}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t("common.cancel")}</AlertDialogCancel>
          <Button variant="outline" onClick={onStartOver} data-testid="resume-run-start-over">{t("runner.startOver")}</Button>
          <Button
            autoFocus
            disabled={!text.canRetry}
            onClick={onConfirm}
            className="bg-[#ff0073] text-white hover:bg-[#ff0073]/90"
            data-testid="resume-run-confirm"
          >
            {t("common.retry")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
