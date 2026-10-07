/**
 * The transcript's pointer selection, by word index (§2.3 of the inspectors
 * design; `lib/edl-review/selection.ts`).
 *
 * The DOM `Selection` is not used: the transcript is virtualised, and once a
 * drag auto-scrolls past the overscan the row it started in unmounts and a
 * native selection loses its anchor node. Instead:
 *  - `pointerdown` on a word (`[data-w]`) stores its index as the anchor;
 *  - `pointermove`, on the window so it outlives the anchor's row, hit-tests
 *    the word under the pointer (`elementFromPoint`) and moves the focus;
 *  - near the top or bottom edge of the scroller the transcript scrolls on its
 *    own (one step per frame) and the focus follows;
 *  - shift-click moves the focus of the selection there is;
 *  - a press on a word focuses its row (cancelling pointerdown would
 *    otherwise leave focus where it was, e.g. in the find box), so Escape
 *    knows which expanded run the reviewer is in (escape-layers.ts); the
 *    scroller takes it when the word is in no focusable row;
 *  - a press that never reaches another word is a CLICK on that word
 *    (`onWordClick`), and leaves no selection.
 * Words carry `user-select: none`, so the browser draws no selection of its own.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { extendSelection, startSelection, type WordSelection } from "@/lib/edl-review/selection"

/** How close to the scroller's top or bottom edge a drag starts scrolling, in px. */
export const AUTO_SCROLL_EDGE_PX = 36
const AUTO_SCROLL_MAX_STEP_PX = 24

export interface WordDragOptions {
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly selection: WordSelection | null
  readonly onSelect: (selection: WordSelection | null) => void
  readonly onWordClick: (word: number) => void
}

export interface WordDrag {
  /** A drag is in progress: the selection toolbar waits for it to end. */
  readonly dragging: boolean
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
}

const wordOf = (target: EventTarget | null): number | null => {
  const el = target instanceof Element ? target.closest<HTMLElement>("[data-w]") : null
  const word = el ? Number(el.dataset.w) : NaN
  return Number.isInteger(word) && word >= 0 ? word : null
}

const raf = (fn: FrameRequestCallback): number => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : 0)
const cancelRaf = (id: number): void => {
  if (id && typeof cancelAnimationFrame === "function") cancelAnimationFrame(id)
}

export function useWordDrag(options: WordDragOptions): WordDrag {
  const [dragging, setDragging] = useState(false)
  const latest = useRef(options)
  latest.current = options
  const stopRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopRef.current?.(), [])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if ((event.button ?? 0) !== 0) return
    const word = wordOf(event.target)
    if (word === null) {
      // A press outside the words (and outside a control) clears the selection.
      if (!(event.target instanceof Element && event.target.closest("button, input, a"))) latest.current.onSelect(null)
      return
    }
    // No native selection or text drag; but the press must still take focus,
    // which preventDefault on pointerdown suppresses: Del and R go to the
    // transcript, not to the find box the reviewer typed in before.
    event.preventDefault()
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-review-row]") : null
    ;(row ?? latest.current.scrollRef.current)?.focus({ preventScroll: true })
    const current = latest.current.selection
    if (event.shiftKey && current) {
      latest.current.onSelect(extendSelection(current, word))
      return
    }
    stopRef.current?.()

    const anchor = word
    let focus = word
    let moved = false
    let x = event.clientX
    let y = event.clientY
    let frame = 0
    latest.current.onSelect(startSelection(anchor))
    setDragging(true)

    const hitTest = () => {
      const under = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null
      const w = wordOf(under)
      if (w === null || w === focus) return
      focus = w
      moved = true
      latest.current.onSelect({ anchor, focus })
    }
    const autoScroll = () => {
      const scroller = latest.current.scrollRef.current
      if (scroller) {
        const box = scroller.getBoundingClientRect()
        const over = y < box.top + AUTO_SCROLL_EDGE_PX ? y - (box.top + AUTO_SCROLL_EDGE_PX) : y > box.bottom - AUTO_SCROLL_EDGE_PX ? y - (box.bottom - AUTO_SCROLL_EDGE_PX) : 0
        if (over !== 0 && box.height > 0) {
          scroller.scrollTop += Math.sign(over) * Math.min(AUTO_SCROLL_MAX_STEP_PX, Math.ceil(Math.abs(over) / 2))
          hitTest()
        }
      }
      frame = raf(autoScroll)
    }
    const onMove = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      hitTest()
    }
    const stop = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      cancelRaf(frame)
      stopRef.current = null
    }
    const onUp = () => {
      stop()
      setDragging(false)
      if (!moved) {
        latest.current.onSelect(null)
        latest.current.onWordClick(anchor)
      }
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    frame = raf(autoScroll)
    stopRef.current = stop
  }, [])

  return { dragging, onPointerDown }
}
