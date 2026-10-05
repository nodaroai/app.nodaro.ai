/**
 * Restoring dropped time, under the restore lock: a restore that adds a problem
 * the plan did not already have is locked (decided 2026-10-05, the review
 * inspector's restore lock). Restored time takes the look of a neighbouring
 * segment (build-edited.ts), so restoring it can make an edit the renderer
 * refuses: time before a camera's first segment that the camera did not film,
 * an edit that grows past the 180-minute cap. The lock asks the render rule
 * itself (`@nodaro/render-rules`, the code every ingress and the Apply EDL badge
 * run), with the render's own settings, never a copy of it.
 *
 * A problem is a check of the rule, named by its code (`ApplyEdlIssueCode`),
 * and for the checks of one source (`reads-before-source`, `missing-url`,
 * `unknown-role`) by that source too (decided 2026-10-05): a camera read too
 * early is a different problem from another camera read too early. A restore
 * is locked when the edit it would produce has a problem that neither the plan
 * nor the current edit has. More of a problem the plan already has (another
 * cropped segment on a plan that crops, a longer early read of the camera the
 * plan already reads early) is not a new one. So on a plan the rule already
 * refuses, the reviewer can always undo their own cuts: time the plan kept
 * brings back only its own segments' looks, so only problems, and (check,
 * source) pairs, the plan already has. The plan's own refusal is review state of its own
 * (`planIssues`), never a lock. Cuts are never locked (kept-set.ts). A locked
 * restore leaves K unchanged and says why: the code of the check it adds (which
 * the inspector can label), and the rule's own messages.
 */
import { buildEffectiveEdl, findEffectiveEdlIssues, type ApplyEdlIssue, type ApplyEdlIssueCode } from "@nodaro/render-rules"
import type { Edl } from "@nodaro/shared"
import type { ApplyEdlRenderContext } from "@/lib/edl-validity"
import { buildEdited } from "./build-edited"
import { spanMinus, toIntervalSet, unionIntervals, type Interval } from "./intervals"
import { keptSetOf, MANUAL_REASON, type KeptSet } from "./kept-set"

/** The render the review is for: the Apply EDL node's settings and its wired
 *  `sources`, as its panel badge judges them. */
export type ReviewRenderContext = Pick<ApplyEdlRenderContext, "output" | "crossfadeMs" | "sources">

/** Why a restore is locked. */
export interface RestoreLock {
  /** The code of the render rule's check that refuses the restored edit. */
  readonly reason: ApplyEdlIssueCode
  /** Every issue the rule finds in the restored edit, in its words. */
  readonly issues: readonly string[]
}

export type RestoreVerdict = { readonly ok: true } | ({ readonly ok: false } & RestoreLock)

/** A restore's outcome: the new K, unchanged when the restore is locked. */
export interface RestoreResult {
  readonly kept: KeptSet
  readonly lock?: RestoreLock
}

/** A span a reason's restore left dropped, and why. */
export interface LockedSpan extends RestoreLock {
  readonly span: Interval
}

export interface RestoreReasonResult {
  readonly kept: KeptSet
  /** The reason's time still dropped because its restore is locked, in time
   *  order: of each locked span, only the pieces K does not keep (the whole
   *  span is what the lock judged). */
  readonly locked: readonly LockedSpan[]
}

/** The render rule's findings on the edit K gives, with the render's settings. */
function renderFindings(base: Edl, kept: KeptSet, render: ReviewRenderContext): readonly ApplyEdlIssue[] {
  const effective = buildEffectiveEdl(buildEdited(base, kept), {
    crossfadeMs: render.crossfadeMs,
    sourceOverrides: render.sources,
  })
  return findEffectiveEdlIssues(effective, render.output)
}

const keepsAll = (kept: KeptSet, span: Interval): boolean => spanMinus(span, kept).length === 0

/** The render rule's findings on the plan as the reviewer received it: the
 *  plan's own refusal, which no review edit is blamed for. Empty when the
 *  render accepts the plan. */
export function planIssues(base: Edl, render: ReviewRenderContext): readonly ApplyEdlIssue[] {
  return renderFindings(base, keptSetOf(base), render)
}

/** The problem an issue is an instance of: its check's code, and for a check
 *  of one source, that source. */
const problemOf = (issue: ApplyEdlIssue): string => ("sourceId" in issue ? `${issue.code}\u0000${issue.sourceId}` : issue.code)

const problemsOf = (issues: readonly ApplyEdlIssue[]): ReadonlySet<string> => new Set(issues.map(problemOf))

/** The judge of one plan's restores: its own problems are found once. */
function restoreJudge(base: Edl, render: ReviewRenderContext): (kept: KeptSet, span: Interval) => RestoreVerdict {
  const planProblems = problemsOf(planIssues(base, render))
  return (kept, span) => {
    if (keepsAll(kept, span)) return { ok: true }
    const after = renderFindings(base, unionIntervals(kept, toIntervalSet([span])), render)
    if (after.every((issue) => planProblems.has(problemOf(issue)))) return { ok: true }
    const had = problemsOf(renderFindings(base, kept, render))
    const added = after.find((issue) => !planProblems.has(problemOf(issue)) && !had.has(problemOf(issue)))
    if (!added) return { ok: true }
    return { ok: false, reason: added.code, issues: after.map((issue) => issue.message) }
  }
}

/**
 * May `span` be restored? Restoring time K already keeps changes nothing and
 * is allowed. Otherwise the render rule judges the edit the restore produces;
 * when it has a problem (a check, per source for a check of one source) that
 * neither the plan nor the current edit has, the restore is locked, with that
 * check's code as the reason.
 */
export function canRestore(base: Edl, kept: KeptSet, span: Interval, render: ReviewRenderContext): RestoreVerdict {
  return restoreJudge(base, render)(kept, span)
}

/** Keep a dropped span's time again: one of the plan's dropped spans, or a
 *  piece of the edit's. Everything inside it comes back, including a shorter
 *  span of another reason nested in it (a filler inside a tangent). A locked
 *  restore returns K unchanged, with the lock. */
export function restoreSpan(kept: KeptSet, base: Edl, span: Interval, render: ReviewRenderContext): RestoreResult {
  const verdict = canRestore(base, kept, span, render)
  if (!verdict.ok) return { kept, lock: { reason: verdict.reason, issues: verdict.issues } }
  return { kept: keepsAll(kept, span) ? kept : unionIntervals(kept, toIntervalSet([span])) }
}

/** The time `reason` dropped, as canonical spans: the plan's spans of that
 *  reason, or for "manual" the plan's kept time (the reviewer's own cuts are
 *  the part of it K no longer keeps). */
export function reasonSpans(base: Edl, reason: string): readonly Interval[] {
  const spans: Interval[] = (base.dropped ?? []).filter((d) => d.reason === reason)
  if (reason === MANUAL_REASON) spans.push(...keptSetOf(base))
  return toIntervalSet(spans)
}

/**
 * Keep every span dropped for `reason`, except those whose restore is locked.
 * For the plan's reasons these are its spans of that reason (two that overlap
 * or abut are one span); for "manual" they are the reviewer's own cuts, so
 * restoring the reason undoes them. A reason nothing was dropped for changes
 * nothing.
 *
 * Whether a span may be restored depends on what else is kept (a neighbour's
 * restore can move the segment its time joins), so the spans are tried in time
 * order, again and again, until a pass restores nothing more. Every span left
 * was refused against the K returned, so restoring the reason again changes
 * nothing: the operation stays idempotent.
 */
export function restoreReason(kept: KeptSet, base: Edl, reason: string, render: ReviewRenderContext): RestoreReasonResult {
  const spans = reasonSpans(base, reason)
  const judge = restoreJudge(base, render)
  let current = kept
  let locked: LockedSpan[] = []
  for (let restored = true; restored; ) {
    restored = false
    locked = []
    for (const span of spans) {
      if (keepsAll(current, span)) continue
      const verdict = judge(current, span)
      if (verdict.ok) {
        current = unionIntervals(current, toIntervalSet([span]))
        restored = true
      } else {
        for (const piece of spanMinus(span, current)) locked.push({ span: piece, reason: verdict.reason, issues: verdict.issues })
      }
    }
  }
  return { kept: current, locked }
}

