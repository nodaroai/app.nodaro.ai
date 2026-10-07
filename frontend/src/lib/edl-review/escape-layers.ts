/**
 * Escape in the review inspector closes the innermost layer first (§2.4 of the
 * inspectors design): the span popover, then the selection toolbar, then the
 * find bar, then the expanded run that has focus, then the dialog.
 *
 * Only the popover is a Radix layer, and Radix closes it on its own (the
 * dialog never sees that Escape). The other three are the inspector's own, so
 * the dialog's `onEscapeKeyDown` asks `innermostLayer`: while one is open it
 * closes that layer and keeps the dialog open; with none open, the dialog
 * closes (after the pending write is flushed).
 *
 * AN EXPANDED RUN (R11) is a layer only while it has focus (decided
 * 2026-10-06): focus is on one of its rows (a word pressed in it, or its
 * "Hide these words" control, where expanding it puts focus). Escape then
 * collapses that run; with no expanded run focused, Escape moves on to the
 * dialog, however many runs are open — a run find opened to show a match
 * included. `focusedRun` names the run from the focused row.
 *
 * Expanded runs are kept by word range and follow the rows as the edit
 * changes (`trackExpandedRuns`): a run whose first paragraph is restored stays
 * open, and a run that is gone (its words all restored) is forgotten.
 *
 * A RUN FIND OPENED to show a match is marked `byFind`, and closing find
 * collapses the runs ONLY find opened (`collapseFindRuns`, decided
 * 2026-10-07). A run the reviewer opened stays open: one the reviewer
 * expands is theirs even if find opened it first, find reaching one they
 * opened leaves it theirs, and two runs that merge are the reviewer's when
 * either was.
 */
import { expandedRuns, spansOverlap, type ReviewRow, type WordSpan } from "./review-rows"

export type ReviewLayer = "selection" | "find" | "expanded"

export interface OpenLayers {
  /** A selection is showing its toolbar. */
  readonly selection: boolean
  readonly find: boolean
  /** An expanded run has focus. */
  readonly expanded: boolean
}

/** The layer an Escape closes, or null when the dialog itself should close. */
export function innermostLayer(open: OpenLayers): ReviewLayer | null {
  if (open.selection) return "selection"
  if (open.find) return "find"
  if (open.expanded) return "expanded"
  return null
}

/** An open run: the words it covers, and whether only find opened it. */
export interface ExpandedRun extends WordSpan {
  readonly byFind?: true
}

/** Who expands a run: the reviewer (its chip) or find (to show a match). */
export type RunOpener = "reviewer" | "find"

const run = (span: WordSpan, byFind: boolean): ExpandedRun => (byFind ? { first: span.first, end: span.end, byFind: true } : { first: span.first, end: span.end })

/**
 * The word range of the expanded run row `rowIndex` belongs to; undefined
 * when that row is no paragraph of an expanded run (or there is no such row).
 */
export function focusedRun(rows: readonly ReviewRow[], rowIndex: number): WordSpan | undefined {
  const row = rows[rowIndex]
  if (!row || row.kind !== "paragraph" || !row.run) return undefined
  const open = expandedRuns(rows).find((r) => r.first <= row.first && row.first < r.end)
  return open ? { first: open.first, end: open.end } : undefined
}

/** `runs` with `span` open; find's mark holds only while no reviewer opened any of it. */
export function expandRun(runs: readonly ExpandedRun[], span: WordSpan, by: RunOpener = "reviewer"): readonly ExpandedRun[] {
  const over = runs.filter((r) => spansOverlap(r, span))
  const byFind = by === "find" && over.every((r) => r.byFind)
  return [...runs.filter((r) => !spansOverlap(r, span)), run(span, byFind)]
}

/** `runs` without the ones only find opened: what closing find leaves open. Returns `runs` itself when find opened none. */
export function collapseFindRuns(runs: readonly ExpandedRun[]): readonly ExpandedRun[] {
  return runs.some((r) => r.byFind) ? runs.filter((r) => !r.byFind) : runs
}

/** `runs` with the run over `span` collapsed. */
export function collapseRun(runs: readonly ExpandedRun[], span: WordSpan): readonly ExpandedRun[] {
  return runs.filter((r) => !spansOverlap(r, span))
}

/**
 * `runs` re-keyed to the open runs the rows show now (`expandedRuns`): each
 * takes the range of the runs it overlaps, and one that overlaps none (its
 * words were restored) is dropped. Two that now cover the same run merge.
 * Returns `runs` itself when nothing changed.
 */
export function trackExpandedRuns(runs: readonly ExpandedRun[], open: readonly WordSpan[]): readonly ExpandedRun[] {
  let tracked: ExpandedRun[] = []
  for (const was of runs) {
    const over = open.filter((span) => spansOverlap(span, was))
    if (over.length === 0) continue
    const span = { first: over[0]!.first, end: over[over.length - 1]!.end }
    const merged = tracked.filter((r) => spansOverlap(r, span))
    tracked = [
      ...tracked.filter((r) => !spansOverlap(r, span)),
      run(
        { first: Math.min(span.first, ...merged.map((r) => r.first)), end: Math.max(span.end, ...merged.map((r) => r.end)) },
        !!was.byFind && merged.every((r) => r.byFind),
      ),
    ]
  }
  const same = tracked.length === runs.length && tracked.every((r, i) => r.first === runs[i]!.first && r.end === runs[i]!.end && r.byFind === runs[i]!.byFind)
  return same ? runs : tracked
}
