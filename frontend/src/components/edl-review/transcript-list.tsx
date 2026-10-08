"use client"

/**
 * The transcript's laid-out rows (§2.3 of the inspectors design): the
 * virtualizer's items, each positioned and measured, as paragraph or
 * collapsed rows (transcript-row.tsx) or, with no transcript, Cuts-only rows.
 * Each row is handed only the selection, the find match and the word playing
 * that fall in it (-1 otherwise), so the memoised rows re-render only where
 * those change.
 */
import type { VirtualItem } from "@tanstack/react-virtual"
import type { EdlDropped } from "@nodaro/shared"
import type { CollapsedRow, CutsOnlyRow as CutsOnlyRowData, ReviewRow } from "@/lib/edl-review/review-rows"
import type { WordMark } from "@/lib/edl-review/word-index"
import { CutsOnlyRow } from "./cuts-only-row"
import { TranscriptRow } from "./transcript-row"
import type { TranscriptWords } from "./use-transcript-view"

interface WordRange {
  readonly first: number
  readonly last: number
}

export interface TranscriptListProps {
  readonly items: readonly VirtualItem[]
  readonly measure: (el: Element | null) => void
  readonly cutsOnly: readonly CutsOnlyRowData[] | null
  readonly rows: readonly ReviewRow[]
  readonly words: TranscriptWords
  readonly marks: readonly WordMark[]
  readonly dropped: readonly EdlDropped[]
  readonly selection: WordRange | null
  readonly match: WordRange | undefined
  /** The word playing (follow playback), or -1. */
  readonly activeWord: number
  readonly canEdit: boolean
  readonly onOpenDrop: (drop: number, anchor: HTMLElement) => void
  readonly onExpand: (run: string) => void
  readonly onCollapse: (run: string) => void
  readonly onRestoreRun: (row: CollapsedRow) => void
}

const inRow = (range: WordRange | null | undefined, row: ReviewRow): range is WordRange =>
  !!range && range.first < row.end && range.last >= row.first

export function TranscriptList(props: TranscriptListProps) {
  const { items, measure, cutsOnly, rows, selection: sel, match, activeWord } = props
  return (
    <>
      {items.map((item) => {
        const at = { transform: `translateY(${item.start}px)` }
        if (cutsOnly) {
          return (
            <div key={item.key} data-index={item.index} data-review-row ref={measure} className="absolute inset-x-0 top-0" style={at}>
              <CutsOnlyRow row={cutsOnly[item.index]!} onOpenDrop={props.onOpenDrop} />
            </div>
          )
        }
        const row = rows[item.index]!
        const prev = rows[item.index - 1]
        const playing = activeWord >= row.first && activeWord < row.end ? activeWord : -1
        return (
          <div key={row.key} data-index={item.index} data-review-row data-row-key={row.key} tabIndex={-1} ref={measure} className="absolute inset-x-0 top-0 outline-none" style={at}>
            <TranscriptRow
              row={row}
              words={props.words}
              marks={props.marks}
              dropped={props.dropped}
              selFirst={inRow(sel, row) ? sel.first : -1}
              selLast={inRow(sel, row) ? sel.last : -1}
              matchFirst={inRow(match, row) ? match.first : -1}
              matchLast={inRow(match, row) ? match.last : -1}
              activeWord={playing}
              runStart={row.kind === "paragraph" && !!row.run && prev?.run !== row.run}
              canEdit={props.canEdit}
              onOpenDrop={props.onOpenDrop}
              onExpand={props.onExpand}
              onCollapse={props.onCollapse}
              onRestoreRun={props.onRestoreRun}
            />
          </div>
        )
      })}
    </>
  )
}
