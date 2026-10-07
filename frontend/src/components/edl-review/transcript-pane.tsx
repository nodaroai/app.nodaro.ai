"use client"

/**
 * The review transcript (§2.3 of the inspectors design): the edit as words,
 * virtualised with `@tanstack/react-virtual` (dynamic row measurement,
 * overscan 6), so a 3-hour episode keeps a few dozen rows in the DOM.
 *
 * It owns the transcript's own layers and hands the inspector two entry
 * points (`TranscriptPaneHandle`):
 *  - `closeLayer()`: Escape's innermost custom layer (escape-layers.ts) — the
 *    selection toolbar, then the find bar, then the run the reviewer expanded
 *    last (find's own expansions are not layers). The span popover is a Radix
 *    layer and closes on its own first.
 *  - `handleKey()`: ⌘F find; with a selection, ⌘C copies its words (from the
 *    model, never the DOM), Del cuts it and R restores it.
 * The selection is by word index (`use-word-drag.ts`), so it survives its
 * anchor row unmounting mid-drag; pressing a word moves focus to the
 * transcript, so Del and R reach it even from the find box. Expanded runs are
 * kept by word range and follow the edit (`trackExpandedRuns`), and the
 * virtualizer caches each row's height by the row's key, so expanding a run
 * never hands one row's height to another. With no transcript (R5 a) the pane lists
 * the kept segments and dropped spans by time (Cuts-only).
 *
 * Seeking the player on a kept word arrives with the player (A3-4); until then
 * a click on a kept word does nothing.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { ReviewEdits } from "@/hooks/use-review-edits"
import type { ReviewModel } from "@/hooks/use-review-model"
import {
  collapseLastRun,
  collapseRun,
  expandRun,
  hasReviewerRun,
  innermostLayer,
  trackExpandedRuns,
  type ExpandedRun,
} from "@/lib/edl-review/escape-layers"
import { collapsedRunOfWord, expandedRuns, rowOfWord, runSpan, type CollapsedRow } from "@/lib/edl-review/review-rows"
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
}

export interface TranscriptPaneProps {
  readonly model: ReviewModel
  readonly edits: ReviewEdits
}

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")

export const TranscriptPane = forwardRef<TranscriptPaneHandle, TranscriptPaneProps>(function TranscriptPane({ model, edits }, ref) {
  const t = useT()
  const [expanded, setExpanded] = useState<readonly ExpandedRun[]>([])
  const view = useTranscriptView(model, edits, expanded)
  const { shown, words, wordIndex, rows, cutsOnly, findIndex } = view
  const marks = wordIndex?.marks ?? []
  const canEdit = edits.canEdit

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const [selection, setSelection] = useState<WordSelection | null>(null)
  const [target, setTarget] = useState<SpanTarget | null>(null)
  const [find, setFind] = useState<FindState>(CLOSED_FIND)
  const [scrollToWord, setScrollToWord] = useState<number | null>(null)
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
    if (span) setExpanded((runs) => expandRun(runs, span, true))
  }, [rows])
  const onCollapse = useCallback((run: string) => {
    const span = runSpan(rows, run)
    if (span) setExpanded((runs) => collapseRun(runs, span))
  }, [rows])

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
      // Opened for the reviewer to see the match, not by them: not an Escape layer.
      setExpanded((runs) => expandRun(runs, span, false))
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
    setFind((f) => ({ ...f, open: true }))
    findInputRef.current?.focus()
  }, [])
  useEffect(() => {
    if (find.open) findInputRef.current?.focus()
  }, [find.open])

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
      const open = trackExpandedRuns(expanded, expandedRuns(rows))
      const layer = innermostLayer({ selection: selection !== null, find: find.open, expanded: hasReviewerRun(open) })
      if (layer === "selection") setSelection(null)
      else if (layer === "find") {
        setFind((f) => ({ ...f, open: false, current: -1 }))
        // Focus would fall to <body> with the input gone, out of the dialog's keys.
        scrollRef.current?.focus()
      } else if (layer === "expanded") setExpanded(collapseLastRun(open))
      return layer !== null
    },
    handleKey: (e) => {
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
  }), [selection, find.open, expanded, rows, cutsOnly, findIndex, openFind, drag.dragging, words, t, canEdit, cutSelection, touchesCut, restoreSelection])

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
    <div className="flex min-h-0 flex-1 flex-col">
      {!cutsOnly && findIndex && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <FindBar find={find} matches={matches} inputRef={findInputRef} fromWord={firstWordOnScreen} onChange={setFind} />
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
              <div key={row.key} data-index={item.index} data-review-row ref={virtualizer.measureElement} className="absolute inset-x-0 top-0" style={{ transform: `translateY(${item.start}px)` }}>
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
