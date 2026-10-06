/**
 * Escape in the review inspector closes the innermost layer first (§2.4 of the
 * inspectors design): the span popover, then the selection toolbar, then the
 * find bar, then a run the reviewer expanded, then the dialog.
 *
 * Only the popover is a Radix layer, and Radix closes it on its own (the
 * dialog never sees that Escape). The other three are the inspector's own, so
 * the dialog's `onEscapeKeyDown` asks `innermostLayer`: while one is open it
 * closes that layer and keeps the dialog open; with none open, the dialog
 * closes (after the pending write is flushed).
 *
 * EXPANDED RUNS (R11) are kept by word range, most recent last, and follow
 * the rows as the edit changes (`trackExpandedRuns`): a run whose first
 * paragraph is restored stays open, and a run that is gone (its words all
 * restored) is forgotten. Only the runs the reviewer opened (Show these words)
 * are Escape layers; one Escape collapses the one opened last. A run that find
 * opened to show a match stays open but is not a layer, so stepping through
 * matches never stacks Escapes the reviewer cannot see.
 */
import { spansOverlap, type WordSpan } from "./review-rows"

export type ReviewLayer = "selection" | "find" | "expanded"

export interface OpenLayers {
  /** A selection is showing its toolbar. */
  readonly selection: boolean
  readonly find: boolean
  /** A run the reviewer expanded is open. */
  readonly expanded: boolean
}

/** The layer an Escape closes, or null when the dialog itself should close. */
export function innermostLayer(open: OpenLayers): ReviewLayer | null {
  if (open.selection) return "selection"
  if (open.find) return "find"
  if (open.expanded) return "expanded"
  return null
}

/** An open run: the words it covers, and whether the reviewer opened it (an Escape layer). */
export interface ExpandedRun extends WordSpan {
  readonly byReviewer: boolean
}

/** `runs` with `span` open, as the most recent; a run the reviewer opened stays theirs. */
export function expandRun(runs: readonly ExpandedRun[], span: WordSpan, byReviewer: boolean): readonly ExpandedRun[] {
  const same = runs.filter((r) => spansOverlap(r, span))
  const rest = runs.filter((r) => !spansOverlap(r, span))
  return [...rest, { first: span.first, end: span.end, byReviewer: byReviewer || same.some((r) => r.byReviewer) }]
}

/** `runs` with the run over `span` collapsed. */
export function collapseRun(runs: readonly ExpandedRun[], span: WordSpan): readonly ExpandedRun[] {
  return runs.filter((r) => !spansOverlap(r, span))
}

/** `runs` with the run the reviewer opened last collapsed (an Escape). */
export function collapseLastRun(runs: readonly ExpandedRun[]): readonly ExpandedRun[] {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i]!.byReviewer) return [...runs.slice(0, i), ...runs.slice(i + 1)]
  }
  return runs
}

/** A run the reviewer opened is open: Escape has one to collapse. */
export const hasReviewerRun = (runs: readonly ExpandedRun[]): boolean => runs.some((r) => r.byReviewer)

/**
 * `runs` re-keyed to the open runs the rows show now (`expandedRuns`): each
 * takes the range of the runs it overlaps, and one that overlaps none (its
 * words were restored) is dropped. Two that now cover the same run merge, in
 * the later one's place. Returns `runs` itself when nothing changed.
 */
export function trackExpandedRuns(runs: readonly ExpandedRun[], open: readonly WordSpan[]): readonly ExpandedRun[] {
  let tracked: ExpandedRun[] = []
  for (const run of runs) {
    const over = open.filter((span) => spansOverlap(span, run))
    if (over.length === 0) continue
    const span = { first: over[0]!.first, end: over[over.length - 1]!.end }
    const merged = tracked.filter((r) => spansOverlap(r, span))
    tracked = [
      ...tracked.filter((r) => !spansOverlap(r, span)),
      {
        first: Math.min(span.first, ...merged.map((r) => r.first)),
        end: Math.max(span.end, ...merged.map((r) => r.end)),
        byReviewer: run.byReviewer || merged.some((r) => r.byReviewer),
      },
    ]
  }
  const same = tracked.length === runs.length && tracked.every((r, i) => r.first === runs[i]!.first && r.end === runs[i]!.end && r.byReviewer === runs[i]!.byReviewer)
  return same ? runs : tracked
}
