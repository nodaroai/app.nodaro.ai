/**
 * The footer's gate (§2.5 of the inspectors design, TA1 a): whether the
 * review's Render final and Update preview may run now, and what holds them.
 * Pure: the inspector feeds it the review's own state.
 *
 *  - Hidden when the plan cannot be reviewed here (or there is none): the
 *    render's bar on the canvas still has both.
 *  - View only on a read-only canvas: nothing runs from here.
 *  - Running while a live run includes the render or its plan (R9 a): edits
 *    are locked, and neither button shows.
 *  - Otherwise ready, unless held, first match wins: nothing is kept; the
 *    render's rule refuses the cut (its issues); a newer run is waiting to be
 *    loaded (TA3 c); the newer-run check has not answered yet; the rule's
 *    verdict is not in yet.
 *  - The newer-run check holds them for 15 s at most (decided 2026-10-07):
 *    once it has timed out with no answer, it holds nothing and the footer
 *    warns instead (`warning`). An answer that comes later still counts.
 *
 * `handleRenderFinal` re-runs every check. The footer is a convenience, not
 * the guard.
 */
import type { RenderRuleVerdict } from "@/components/editor/workflow-editor/render-final-checks"
import type { KeptSet } from "./kept-set"

export type ReviewGateMode = "hidden" | "view-only" | "running" | "ready"

export type ReviewGateHold =
  | { readonly kind: "nothing-kept" }
  | { readonly kind: "issues"; readonly issues: readonly string[] }
  | { readonly kind: "newer-run" }
  | { readonly kind: "checking-newer" }
  | { readonly kind: "judging" }

/** The newer-run check timed out unanswered: the runs may go, unchecked. */
export type ReviewGateWarning = "newer-unchecked"

export interface ReviewGate {
  readonly mode: ReviewGateMode
  /** What holds both runs while `ready`; null when they may run. */
  readonly hold: ReviewGateHold | null
  /** A caveat shown beside the runs while `ready`; absent when there is none. */
  readonly warning?: ReviewGateWarning
}

export interface ReviewGateInput {
  /** The plan is a Tighten EDL the inspector can edit. */
  readonly reviewable: boolean
  readonly readOnly: boolean
  /** R9 a: read-only, or a live run includes the render or its plan. */
  readonly locked: boolean
  readonly kept: KeptSet | null
  readonly verdict: RenderRuleVerdict | undefined
  /** A newer run's changes; `undefined` while the check is out, `null` when there is none. */
  readonly newerRun: unknown
  /** The newer-run check has been out longer than its timeout (15 s). */
  readonly newerCheckTimedOut?: boolean
}

export function reviewGate(input: ReviewGateInput): ReviewGate {
  if (!input.reviewable) return { mode: "hidden", hold: null }
  if (input.readOnly) return { mode: "view-only", hold: null }
  if (input.locked) return { mode: "running", hold: null }
  const hold = holdOf(input)
  return unchecked(input) ? { mode: "ready", hold, warning: "newer-unchecked" } : { mode: "ready", hold }
}

const unchecked = ({ newerRun, newerCheckTimedOut }: ReviewGateInput): boolean => newerRun === undefined && !!newerCheckTimedOut

function holdOf(input: ReviewGateInput): ReviewGateHold | null {
  const { kept, verdict, newerRun } = input
  if (kept !== null && kept.length === 0) return { kind: "nothing-kept" }
  if (verdict && !verdict.ok) return { kind: "issues", issues: verdict.issues }
  if (newerRun !== null && newerRun !== undefined) return { kind: "newer-run" }
  if (newerRun === undefined && !unchecked(input)) return { kind: "checking-newer" }
  if (!verdict) return { kind: "judging" }
  return null
}
