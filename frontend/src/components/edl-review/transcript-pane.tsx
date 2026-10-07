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
 * Seeking the player on a kept word arrives with the player (A3-4); until then
 * a click on a kept word does nothing.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { ReviewEdits } from "@/hooks/use-review-edits"
import type { ReviewModel } from "@/hooks/use-review-model"
import { observeScrollOffset } from "@/lib/virtual/observe-scroll-offset"
import { collapseFindRuns, collapseRun, expandRun, focusedRun, innermostLayer, trackExpandedRuns, type ExpandedRun } from "@/lib/edl-review/escape-layers"
import { collapsedRunOfWord, expandedRuns, rowOfWord, runSpan, type CollapsedRow, type ReviewRow, type WordSpan } from "@/lib/edl-review/review-rows"
import {
  selectedWords,
  selectionCutMs,
  selectionRestoreMs,
  selectionText,
  selectionTouchesCut,
  type WordSelection,
} from "@/lib/edl-review/selection"
import { useT } from "@/lib/i18n"
import { copyToClipboard } from "@/lib/utils"
import { CutsOnlyRow } from "./cuts-only-row"
import { CLOSED_FIND, FindBar, useFindMatches, type FindState } from "./find-bar"
import { SelectionToolbar } from "./selection-toolbar"
import { SpanPopover, toastRestoreLock, type SpanTarget } from "./span-popover"
import { TranscriptRow } from "./transcript-row"
import { useTranscriptView } from "./use-transcript-view"
import { useWordDrag } from "./use-word-drag"

export const TRANSCRIPT_OVERSCAN = 6
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
}

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")

/** The expanded run the focused row of the transcript belongs to (escape-layers.ts). */
function focusedRunOf(scroller: HTMLElement | null, rows: readonly ReviewRow[]): { readonly run: string; readonly span: WordSpan } | undefined {
  const active = document.activeElement
  const row = scroller && active instanceof Element && scroller.contains(active) ? active.closest<HTMLElement>("[data-review-row]") : null
  const index = row ? Number(row.dataset.index) : -1
  const span = focusedRun(rows, index)
  const run = rows[index]
  return span && run?.kind === "paragraph" && run.run ? { run: run.run, span } : undefined
}

/**
 * Where focus was when find opened, to return it there when find closes
 * (decided 2026-10-07). The element itself while it is still in the page;
 * otherwise its stand-in, when it was a run's toggle, a row or the find button
 * (the virtualizer and the run toggles swap those elements, and the find
 * button unmounts while find is open). A toggle or a row also names the row it
 * lives in, so when find scrolled that row out of the DOM the transcript
 * scrolls back to it and focuses it once it renders.
 */
interface FocusMark {
  readonly el: HTMLElement
  readonly selector?: string
  /** The transcript row the stand-in lives in: by its key, or by its run's id (a toggle). */
  readonly row?: { readonly key: string } | { readonly run: string }
}

function focusMarkOf(active: Element | null): FocusMark | null {
  if (!(active instanceof HTMLElement)) return null
  const toggle = active.dataset.runToggle
  if (toggle !== undefined) return { el: active, selector: `[data-run-toggle="${CSS.escape(toggle)}"]`, row: { run: toggle } }
  if (active.hasAttribute("data-find-open")) return { el: active, selector: "[data-find-open]" }
  const row = active.closest<HTMLElement>("[data-row-key]")
  if (row) return { el: active, selector: `[data-row-key="${CSS.escape(row.dataset.rowKey!)}"]`, row: { key: row.dataset.rowKey! } }
  return { el: active }
}

/** The index in `rows` of the row a focus mark lives in; -1 when it is gone. */
function rowIndexOf(mark: FocusMark, rows: readonly ReviewRow[]): number {
  const row = mark.row
  if (!row) return -1
  // A run's toggle is on its collapsed row, or on its first paragraph once expanded.
  return "key" in row ? rows.findIndex((r) => r.key === row.key) : rows.findIndex((r) => r.run === row.run)
}

export const TranscriptPane = forwardRef<TranscriptPaneHandle, TranscriptPaneProps>(function TranscriptPane({ model, edits, active = true }, ref) {
  const t = useT()
  const [expanded, setExpanded] = useState<readonly ExpandedRun[]>([])
  const view = useTranscriptView(model, edits, expanded)
  const { shown, words, wordIndex, rows, cutsOnly, findIndex } = view
  const marks = wordIndex?.marks ?? []
  const canEdit = edits.canEdit

  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  // Where focus was before find opened, and a request to return it there.
  const beforeFind = useRef<FocusMark | null>(null)
  const [refocus, setRefocus] = useState(0)
  // The stand-in to focus once the virtualizer renders it (find scrolled it away).
  const [pendingFocus, setPendingFocus] = useState<FocusMark | null>(null)
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
    if (!mark || mark.state === "kept" || mark.drop === undefined) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-w="${word}"]`)
    if (el) openDrop(mark.drop, el)
  }, [marks, openDrop])

  const drag = useWordDrag({ scrollRef, selection, onSelect: setSelection, onWordClick })

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
    if (!find.open) {
      beforeFind.current = focusMarkOf(document.activeElement)
      setPendingFocus(null)
    }
    setFind((f) => ({ ...f, open: true }))
    findInputRef.current?.focus()
  }, [find.open])
  useEffect(() => {
    if (find.open) findInputRef.current?.focus()
  }, [find.open])

  // Closing find, by Escape or its ✕ (decided 2026-10-07): the runs only find
  // opened collapse again, and focus goes back to where it was before find
  // opened (in the same commit, so keys never fall to <body> in between).
  const closeFind = useCallback(() => {
    setFind((f) => ({ ...f, open: false, current: -1 }))
    setExpanded(collapseFindRuns)
    setRefocus((n) => n + 1)
  }, [])
  // The rows of this render (after find's runs collapse), for the refocus below.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  useLayoutEffect(() => {
    if (refocus === 0) return
    const mark = beforeFind.current
    beforeFind.current = null
    setPendingFocus(null)
    const dialog = rootRef.current?.closest("[role='dialog']")
    const stillThere = mark !== null && mark.el.isConnected && (!dialog || dialog.contains(mark.el))
    const standIn = !stillThere && mark?.selector ? rootRef.current?.querySelector<HTMLElement>(mark.selector) : null
    const target = stillThere ? mark.el : standIn
    if (target) {
      target.focus()
      return
    }
    // Its row is out of the DOM (find scrolled away from it): scroll back and
    // focus it once it renders. The scroller holds focus meanwhile.
    scrollRef.current?.focus({ preventScroll: true })
    const index = mark ? rowIndexOf(mark, rowsRef.current) : -1
    if (mark && index >= 0) {
      virtualizer.scrollToIndex(index, { align: "auto" })
      setPendingFocus(mark)
    }
  }, [refocus, virtualizer])
  useEffect(() => {
    if (!pendingFocus?.selector) return
    const el = rootRef.current?.querySelector<HTMLElement>(pendingFocus.selector)
    if (el) {
      // Only while the reviewer has not moved focus elsewhere in the meantime.
      if (document.activeElement === scrollRef.current) el.focus({ preventScroll: true })
      setPendingFocus(null)
    } else if (rowIndexOf(pendingFocus, rows) < 0) setPendingFocus(null)
  }, [pendingFocus, items, rows])
  const onFindChange = useCallback((next: FindState) => {
    if (find.open && !next.open) closeFind()
    else {
      if (!find.open && next.open) {
        beforeFind.current = focusMarkOf(document.activeElement)
        setPendingFocus(null)
      }
      setFind(next)
    }
  }, [find.open, closeFind])

  const cutSelection = useCallback(() => {
    if (!selection) return
    edits.cutSelection(selection)
    setSelection(null)
  }, [edits, selection])

  const restoreSelection = useCallback(() => {
    if (!selection) return
    const lock = edits.restoreSelection(selection)
    if (lock) toastRestoreLock(lock)
    setSelection(null)
  }, [edits, selection])

  const touchesCut = selection !== null && selectionTouchesCut(selection, marks)
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
      if (isTextField(e.target) || !selection || drag.dragging) return
      if (mod && key === "c") {
        e.preventDefault()
        copyToClipboard(selectionText(selection, words), t("common.copied"))
        return
      }
      if (!canEdit || mod || e.altKey) return
      if (key === "delete" || key === "backspace") {
        e.preventDefault()
        cutSelection()
      } else if (key === "r" && touchesCut) {
        e.preventDefault()
        restoreSelection()
      }
    },
    canFind: !cutsOnly && !!findIndex,
    openFindFromTab: () => {
      if (!active || cutsOnly || !findIndex) return
      if (!find.open) {
        beforeFind.current = scrollRef.current ? { el: scrollRef.current } : null
        setPendingFocus(null)
      }
      setFind((f) => ({ ...f, open: true }))
      findInputRef.current?.focus()
    },
  }), [active, selection, find.open, closeFind, expanded, rows, cutsOnly, findIndex, openFind, drag.dragging, words, t, canEdit, cutSelection, touchesCut, restoreSelection])

  const sel = selection ? selectedWords(selection) : null
  const selectionMs = useMemo(() => {
    if (!selection || !edits.kept) return { cut: 0, restore: 0 }
    return {
      cut: selectionCutMs(selection, words, edits.kept, model.offsetMs),
      restore: selectionRestoreMs(selection, words, edits.kept, model.offsetMs),
    }
  }, [selection, words, edits.kept, model.offsetMs])

  // The toolbar floats over the row the selection ends in, while that row is laid out.
  const focusRow = selection ? rowOfWord(rows, selection.focus) : -1
  const focusItem = items.find((item) => item.index === focusRow)

  if (!shown) return null

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {!cutsOnly && findIndex && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <FindBar find={find} matches={matches} inputRef={findInputRef} fromWord={firstWordOnScreen} onChange={onFindChange} />
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
          {items.map((item) => {
            if (cutsOnly) {
              const row = cutsOnly[item.index]!
              return (
                <div key={item.key} data-index={item.index} data-review-row ref={virtualizer.measureElement} className="absolute inset-x-0 top-0" style={{ transform: `translateY(${item.start}px)` }}>
                  <CutsOnlyRow row={row} onOpenDrop={openDrop} />
                </div>
              )
            }
            const row = rows[item.index]!
            const inSel = sel && sel.first < row.end && sel.last >= row.first
            const inMatch = match && match.first < row.end && match.last >= row.first
            const prev = rows[item.index - 1]
            return (
              <div key={row.key} data-index={item.index} data-review-row data-row-key={row.key} tabIndex={-1} ref={virtualizer.measureElement} className="absolute inset-x-0 top-0 outline-none" style={{ transform: `translateY(${item.start}px)` }}>
                <TranscriptRow
                  row={row}
                  words={words}
                  marks={marks}
                  dropped={shown.dropped ?? []}
                  selFirst={inSel ? sel.first : -1}
                  selLast={inSel ? sel.last : -1}
                  matchFirst={inMatch ? match.first : -1}
                  matchLast={inMatch ? match.last : -1}
                  runStart={row.kind === "paragraph" && !!row.run && prev?.run !== row.run}
                  canEdit={canEdit}
                  onOpenDrop={openDrop}
                  onExpand={onExpand}
                  onCollapse={onCollapse}
                  onRestoreRun={onRestoreRun}
                />
              </div>
            )
          })}
          {toolbarShown && focusItem && (
            <SelectionToolbar
              className="absolute inset-x-0 z-10 mx-auto"
              style={{ top: Math.max(0, focusItem.start - 36) }}
              cutMs={selectionMs.cut}
              restoreMs={selectionMs.restore}
              touchesCut={touchesCut}
              onCut={cutSelection}
              onRestore={restoreSelection}
              onClear={() => setSelection(null)}
            />
          )}
        </div>
        {toolbarShown && !focusItem && (
          <div className="sticky bottom-2 z-10 flex justify-center">
            <SelectionToolbar
              cutMs={selectionMs.cut}
              restoreMs={selectionMs.restore}
              touchesCut={touchesCut}
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
      />
    </div>
  )
})
