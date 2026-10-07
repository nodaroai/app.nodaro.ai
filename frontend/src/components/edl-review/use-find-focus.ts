/**
 * Focus around find (decided 2026-10-07): closing find returns focus to where
 * it was before find opened, scrolling back to that row first when find
 * scrolled it out of the DOM.
 *
 * Where focus was is a FocusMark: the element itself while it is still in the
 * page; otherwise its stand-in, when it was a run's toggle, a row or the find
 * button (the virtualizer and the run toggles swap those elements, and the
 * find button unmounts while find is open). A toggle or a row also names the
 * row it lives in, so when find scrolled that row out of the DOM the
 * transcript scrolls back to it and focuses it once it renders. The scroller
 * holds focus meanwhile, so keys never fall to <body>.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import type { Virtualizer, VirtualItem } from "@tanstack/react-virtual"
import type { ReviewRow } from "@/lib/edl-review/review-rows"

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

export interface FindFocusOptions {
  readonly rootRef: RefObject<HTMLElement | null>
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly rows: readonly ReviewRow[]
  readonly items: readonly VirtualItem[]
  readonly virtualizer: Virtualizer<HTMLDivElement, Element>
}

export interface FindFocus {
  /** Find is opening: remember where focus is now. */
  readonly remember: () => void
  /** Find is opening from another tab: return to the transcript itself. */
  readonly rememberTranscript: () => void
  /** Find closed: return focus to where it was (after the commit that closes it). */
  readonly restore: () => void
}

export function useFindFocus({ rootRef, scrollRef, rows, items, virtualizer }: FindFocusOptions): FindFocus {
  const beforeFind = useRef<FocusMark | null>(null)
  const [refocus, setRefocus] = useState(0)
  // The stand-in to focus once the virtualizer renders it (find scrolled it away).
  const [pendingFocus, setPendingFocus] = useState<FocusMark | null>(null)
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
    // Its row is out of the DOM: scroll back and focus it once it renders.
    scrollRef.current?.focus({ preventScroll: true })
    const index = mark ? rowIndexOf(mark, rowsRef.current) : -1
    if (mark && index >= 0) {
      virtualizer.scrollToIndex(index, { align: "auto" })
      setPendingFocus(mark)
    }
  }, [refocus, virtualizer, rootRef, scrollRef])
  useEffect(() => {
    if (!pendingFocus?.selector) return
    const el = rootRef.current?.querySelector<HTMLElement>(pendingFocus.selector)
    if (el) {
      // Only while the reviewer has not moved focus elsewhere in the meantime.
      if (document.activeElement === scrollRef.current) el.focus({ preventScroll: true })
      setPendingFocus(null)
    } else if (rowIndexOf(pendingFocus, rows) < 0) setPendingFocus(null)
  }, [pendingFocus, items, rows, rootRef, scrollRef])

  const remember = useCallback(() => {
    beforeFind.current = focusMarkOf(document.activeElement)
    setPendingFocus(null)
  }, [])
  const rememberTranscript = useCallback(() => {
    beforeFind.current = scrollRef.current ? { el: scrollRef.current } : null
    setPendingFocus(null)
  }, [scrollRef])
  const restore = useCallback(() => setRefocus((n) => n + 1), [])
  return { remember, rememberTranscript, restore }
}
