"use client"

/**
 * The review transcript (§2.3 of the inspectors design): the edit as words,
 * virtualised with `@tanstack/react-virtual` (dynamic row measurement,
 * overscan 6), so a 3-hour episode keeps a few dozen rows in the DOM.
 *
 * It owns the transcript's own layers and hands the inspector two entry
 * points (`TranscriptPaneHandle`):
 *  - `closeLayer()`: Escape's innermost custom layer (escape-layers.ts) — the
 *    selection toolbar, then the find bar, then the expanded run that has
 *    focus (decided 2026-10-06). The span popover is a Radix layer and closes
 *    on its own first.
 *  - `handleKey()`: ⌘F find; with a selection, ⌘C copies its words (from the
 *    model, never the DOM), Del cuts it and R restores it.
 * The selection is by word index (`use-word-drag.ts`), so it survives its
 * anchor row unmounting mid-drag; pressing a word moves focus to its row, so
 * Del and R reach it even from the find box, and Escape knows the run the
 * reviewer is in. Expanding a run moves focus to its "Hide these words"
 * control, and collapsing one moves it back to the run's chip. Expanded runs are
 * kept by word range and follow the edit (`trackExpandedRuns`), and the
 * virtualizer caches each row's height by the row's key, so expanding a run
 * never hands one row's height to another. With no transcript (R5 a) the pane lists
 * the kept segments and dropped spans by time (Cuts-only).
 *
 * Find marks the runs it expands to show a match; closing find (Escape or its
 * ✕) collapses those again, leaves the runs the reviewer opened open, and
 * returns focus to where it was before find opened (decided 2026-10-07),
 * scrolling back to that row first when find scrolled it out of the DOM.
 * Below `sm` the pane stays mounted behind another tab (`active` false): it
 * then has no Escape layers and takes no keys. ⌘F there switches to the
 * transcript and opens find (`openFindFromTab`, decided 2026-10-07).
 *
 * THE PLAYER (A3-4). A click on a kept word seeks the player (`seekWord`:
 * the take through its clock, else the original, R3 a); a struck word or a
 * pause chip opens its span, whose popover offers Hear it (the original, R6
 * a); the selection toolbar's Play plays the selection (`playRange`, decided
 * 2026-10-07). Follow playback marks the word playing and keeps its row on screen
 * (use-transcript-follow.ts), and the minimap above the find row shows the
 * whole source, the rows on screen and the playhead; a click or drag on it
 * scrolls the transcript there.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { EdlDropped } from "@nodaro/shared"
import type { ReviewEdits } from "@/hooks/use-review-edits"
import type { ReviewModel } from "@/hooks/use-review-model"
import type { ReviewPlayback } from "@/hooks/use-review-playback"
import { indexAtMs } from "@/lib/edl-review/minimap"
import { observeScrollOffset } from "@/lib/virtual/observe-scroll-offset"
import { collapseFindRuns, collapseRun, expandRun, innermostLayer, trackExpandedRuns, type ExpandedRun } from "@/lib/edl-review/escape-layers"
import { collapsedRunOfWord, expandedRuns, rowOfWord, runSpan, type CollapsedRow } from "@/lib/edl-review/review-rows"
import {
  selectedWords,
  selectionText,
  type WordSelection,
} from "@/lib/edl-review/selection"
import { useT } from "@/lib/i18n"
import { copyToClipboard } from "@/lib/utils"
import { CLOSED_FIND, FindBar, useFindMatches, type FindState } from "./find-bar"
import { FollowToggle, ReviewMinimap } from "./review-minimap"
import { SelectionToolbar } from "./selection-toolbar"
import { SpanPopover, toastRestoreLock, type SpanTarget } from "./span-popover"
import { TranscriptList } from "./transcript-list"
import { useFindFocus } from "./use-find-focus"
import { focusedRunOf, selectionKeyAction } from "./transcript-keys"
import { useTranscriptFollow } from "./use-transcript-follow"
import { useTranscriptView } from "./use-transcript-view"
import { useSelectionActions } from "./use-selection-actions"
import { useWordDrag } from "./use-word-drag"

export const TRANSCRIPT_OVERSCAN = 6
const NO_DROPS: readonly EdlDropped[] = []
/** A paragraph row's height before it is measured, in px. */
const ESTIMATED_ROW_PX = 88

export interface TranscriptPaneHandle {
  /** Close the innermost open layer; false when none is open (the dialog closes). */
  readonly closeLayer: () => boolean
  readonly handleKey: (event: KeyboardEvent<HTMLElement>) => void
  /** The transcript has words to find in (not Cuts-only), whether or not it is showing. */
  readonly canFind: boolean
  /**
   * Open find for a ⌘F pressed on another tab, once this pane is showing
   * again (review-body.tsx). Closing it returns focus to the transcript, never
   * to the tab it came from: focusing that tab would open it again.
   */
  readonly openFindFromTab: () => void
}

export interface TranscriptPaneProps {
  readonly model: ReviewModel
  readonly edits: ReviewEdits
  /**
   * The pane is showing (default). Below `sm` it stays mounted behind another
   * tab; there it has no Escape layers and takes no keys.
   */
  readonly active?: boolean
  /** The review's player: kept-word clicks seek it, Hear it plays the original, follow playback reads it. */
  readonly playback?: ReviewPlayback
}

export const TranscriptPane = forwardRef<TranscriptPaneHandle, TranscriptPaneProps>(function TranscriptPane({ model, edits, active = true, playback }, ref) {
  const t = useT()
  const [expanded, setExpanded] = useState<readonly ExpandedRun[]>([])
  const view = useTranscriptView(model, edits, expanded)
  const { shown, words, wordIndex, rows, cutsOnly, findIndex } = view
  const marks = wordIndex?.marks ?? []
  const canEdit = edits.canEdit

  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const [selection, setSelection] = useState<WordSelection | null>(null)
  const [target, setTarget] = useState<SpanTarget | null>(null)
  const [find, setFind] = useState<FindState>(CLOSED_FIND)
  const [scrollToWord, setScrollToWord] = useState<number | null>(null)
  // A run's toggle to move focus to once the rows show it (expanded or collapsed).
  const [focusToggle, setFocusToggle] = useState<string | null>(null)
  const matches = useFindMatches(findIndex, find)
  const match = find.current >= 0 ? matches[find.current] : undefined

  const count = cutsOnly ? cutsOnly.length : rows.length
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (cutsOnly ? 36 : ESTIMATED_ROW_PX),
    // By the row, not its index: expanding a run inserts rows, and a height
    // cached by index would land on whichever row moved into that slot.
    getItemKey: (i) => {
      if (cutsOnly) {
        const row = cutsOnly[i]
        return row ? `${row.kind}:${row.inMs}:${row.outMs}:${row.kind === "cut" ? row.drop : ""}` : i
      }
      return rows[i]?.key ?? i
    },
    overscan: TRANSCRIPT_OVERSCAN,
    // The library's observer leaves its is-scrolling reset timer running after unmount.
    observeElementOffset: observeScrollOffset,
  })
  const items = virtualizer.getVirtualItems()
  const findFocus = useFindFocus({ rootRef, scrollRef, rows, items, virtualizer })

  // The rows' drop indices are into the edit they were drawn from: the latest one.
  const shownRef = useRef(shown)
  shownRef.current = shown
  const openDrop = useCallback((drop: number, anchor: HTMLElement) => {
    const span = shownRef.current?.dropped?.[drop]
    if (!span) return
    setSelection(null)
    setTarget({ span, anchor, rect: anchor.getBoundingClientRect() })
  }, [])

  const onWordClick = useCallback((word: number) => {
    const mark = marks[word]
    if (mark?.state === "kept") playback?.seekWord(word)
    if (!mark || mark.state === "kept" || mark.drop === undefined) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-w="${word}"]`)
    if (el) openDrop(mark.drop, el)
  }, [marks, openDrop, playback])

  const drag = useWordDrag({ scrollRef, selection, onSelect: setSelection, onWordClick })
  const expandForFollow = useCallback((run: string) => {
    const span = runSpan(rows, run)
    if (span) setExpanded((runs) => expandRun(runs, span))
  }, [rows])
  const activeWord = useTranscriptFollow({ playback, words, offsetMs: model.offsetMs, rows, virtualizer, expand: expandForFollow })

  const onExpand = useCallback((run: string) => {
    const span = runSpan(rows, run)
    if (!span) return
    setExpanded((runs) => expandRun(runs, span))
    setFocusToggle(run)
  }, [rows])
  const onCollapse = useCallback((run: string) => {
    const span = runSpan(rows, run)
    if (!span) return
    setExpanded((runs) => collapseRun(runs, span))
    setFocusToggle(run)
  }, [rows])
  // The toggle the reviewer pressed unmounts: its partner takes focus, so the
  // run just expanded is the one Escape collapses.
  useEffect(() => {
    if (focusToggle === null) return
    const toggle = scrollRef.current?.querySelector<HTMLElement>(`[data-run-toggle="${focusToggle}"]`)
    ;(toggle ?? scrollRef.current)?.focus({ preventScroll: true })
    setFocusToggle(null)
  }, [focusToggle, rows])

  // The open runs follow the edit: a restore or a cut that moves a run's first
  // paragraph keeps it open under its new id, and a run that is gone is
  // forgotten. Only against the rows built from this very list: when the list
  // moved on since (find expanded another run), the next rows bring this back.
  useEffect(() => {
    const open = expandedRuns(rows)
    setExpanded((runs) => (runs === expanded ? trackExpandedRuns(runs, open) : runs))
  }, [rows, expanded])
  const onRestoreRun = useCallback((row: CollapsedRow) => {
    const span = { inMs: row.inMs, outMs: row.outMs }
    const lock = edits.restoreSpan(span)
    if (lock) toastRestoreLock(lock)
  }, [edits])

  // A new current match: scroll to it (expanding a run that hides it first).
  useEffect(() => {
    if (match) setScrollToWord(match.first)
  }, [match])
  useEffect(() => {
    if (scrollToWord === null) return
    const run = collapsedRunOfWord(rows, scrollToWord)
    const span = run ? runSpan(rows, run) : undefined
    if (span) {
      // Opened for the reviewer to see the match; focus stays in the find box.
      // Marked as find's, so it collapses again when find closes.
      setExpanded((runs) => expandRun(runs, span, "find"))
      return
    }
    virtualizer.scrollToIndex(rowOfWord(rows, scrollToWord), { align: "center" })
    setScrollToWord(null)
  }, [scrollToWord, rows, virtualizer])

  const firstWordOnScreen = useCallback(() => {
    const first = virtualizer.getVirtualItems()[0]
    return first ? (rows[first.index]?.first ?? 0) : 0
  }, [virtualizer, rows])

  const openFind = useCallback(() => {
    if (!find.open) findFocus.remember()
    setFind((f) => ({ ...f, open: true }))
    findInputRef.current?.focus()
  }, [find.open, findFocus])
  useEffect(() => {
    if (find.open) findInputRef.current?.focus()
  }, [find.open])

  // Closing find, by Escape or its ✕ (decided 2026-10-07): the runs only find
  // opened collapse again, and focus goes back to where it was before find
  // opened (in the same commit, so keys never fall to <body> in between).
  const closeFind = useCallback(() => {
    setFind((f) => ({ ...f, open: false, current: -1 }))
    setExpanded(collapseFindRuns)
    findFocus.restore()
  }, [findFocus])
  const onFindChange = useCallback((next: FindState) => {
    if (find.open && !next.open) closeFind()
    else {
      if (!find.open && next.open) findFocus.remember()
      setFind(next)
    }
  }, [find.open, closeFind, findFocus])

  const { cutSelection, restoreSelection, playSelection, touchesCut, selectionMs } = useSelectionActions({ selection, setSelection, model, edits, words, marks, playback })
  // The selection stays after Play, so the button a mouse click focused stays
  // too, and Space on it would press it again: hand focus back to the
  // transcript, where Space is the player's pause.
  const onPlaySelection = useMemo(
    () =>
      playSelection
        ? () => {
            playSelection()
            scrollRef.current?.focus({ preventScroll: true })
          }
        : undefined,
    [playSelection],
  )
  const toolbarShown = selection !== null && !drag.dragging && canEdit && !cutsOnly

  useImperativeHandle(ref, () => ({
    closeLayer: () => {
      if (!active) return false
      const open = trackExpandedRuns(expanded, expandedRuns(rows))
      const focused = focusedRunOf(scrollRef.current, rows)
      const layer = innermostLayer({ selection: selection !== null, find: find.open, expanded: focused !== undefined })
      if (layer === "selection") setSelection(null)
      else if (layer === "find") closeFind()
      else if (focused) {
        setExpanded(collapseRun(open, focused.span))
        setFocusToggle(focused.run)
      }
      return layer !== null
    },
    handleKey: (e) => {
      if (!active) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === "f" && !cutsOnly && findIndex) {
        e.preventDefault()
        openFind()
        return
      }
      const action = selectionKeyAction(e, { hasSelection: selection !== null, dragging: drag.dragging, canEdit, touchesCut })
      if (!action || !selection) return
      e.preventDefault()
      if (action === "copy") copyToClipboard(selectionText(selection, words), t("common.copied"))
      else if (action === "cut") cutSelection()
      else restoreSelection()
    },
    canFind: !cutsOnly && !!findIndex,
    openFindFromTab: () => {
      if (!active || cutsOnly || !findIndex) return
      if (!find.open) findFocus.rememberTranscript()
      setFind((f) => ({ ...f, open: true }))
      findInputRef.current?.focus()
    },
  }), [active, selection, find.open, closeFind, expanded, rows, cutsOnly, findIndex, openFind, drag.dragging, words, t, canEdit, cutSelection, touchesCut, restoreSelection, findFocus])

  const sel = selection ? selectedWords(selection) : null
  // The toolbar floats over the row the selection ends in while that row is
  // laid out (it scrolls with the rows), else at the bottom of the scroller.
  const focusRow = selection ? rowOfWord(rows, selection.focus) : -1
  const focusItem = items.find((item) => item.index === focusRow)

  // The rows on screen, for the minimap's window, and a time to scroll to.
  const timed: readonly { readonly inMs: number; readonly outMs: number }[] = cutsOnly ?? rows
  const scrollTop = virtualizer.scrollOffset ?? 0
  const onScreen = items.filter((i) => i.end > scrollTop && i.start < scrollTop + (virtualizer.scrollRect?.height ?? 0))
  const firstOn = onScreen.length > 0 ? timed[onScreen[0]!.index] : undefined
  const lastOn = onScreen.length > 0 ? timed[onScreen[onScreen.length - 1]!.index] : undefined
  const onScreenMs = firstOn && lastOn ? { inMs: firstOn.inMs, outMs: lastOn.outMs } : null
  const scrollToMs = useCallback((ms: number) => {
    virtualizer.scrollToIndex(Math.max(0, indexAtMs(timed, ms)), { align: "start" })
  }, [virtualizer, timed])

  if (!shown) return null

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {playback && model.base && (
        <ReviewMinimap base={model.base} edited={shown} kept={edits.kept} onScreen={onScreenMs} playback={playback} onScrollTo={scrollToMs} />
      )}
      {!cutsOnly && findIndex && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <FindBar find={find} matches={matches} inputRef={findInputRef} fromWord={firstWordOnScreen} onChange={onFindChange} />
          {playback && <FollowToggle on={playback.follow} onChange={playback.setFollow} />}
        </div>
      )}
      <div
        ref={scrollRef}
        tabIndex={0}
        aria-label={t("node.transcript")}
        data-testid="review-transcript"
        className="relative min-h-0 flex-1 overflow-auto outline-none"
        onPointerDown={cutsOnly ? undefined : drag.onPointerDown}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          <TranscriptList
            items={items}
            measure={virtualizer.measureElement}
            cutsOnly={cutsOnly}
            rows={rows}
            words={words}
            marks={marks}
            dropped={shown.dropped ?? NO_DROPS}
            selection={sel}
            match={match}
            activeWord={activeWord}
            canEdit={canEdit}
            onOpenDrop={openDrop}
            onExpand={onExpand}
            onCollapse={onCollapse}
            onRestoreRun={onRestoreRun}
          />
        </div>
        {toolbarShown && (
          <div className={focusItem ? "absolute inset-x-0 z-10 flex justify-center" : "sticky bottom-2 z-10 flex justify-center"} style={focusItem ? { top: Math.max(0, focusItem.start - 36) } : undefined}>
            <SelectionToolbar
              cutMs={selectionMs.cut}
              restoreMs={selectionMs.restore}
              touchesCut={touchesCut}
              onPlay={onPlaySelection}
              onCut={cutSelection}
              onRestore={restoreSelection}
              onClear={() => setSelection(null)}
            />
          </div>
        )}
      </div>
      <SpanPopover
        target={target}
        onClose={() => setTarget(null)}
        shown={shown}
        base={model.base}
        kept={edits.kept}
        render={model.render}
        canEdit={canEdit}
        onRestore={edits.restoreSpan}
        onRestoreReason={edits.restoreReason}
        onHear={playback?.hear}
      />
    </div>
  )
})
