/**
 * Scroll observers for every virtualizer in the frontend: `@tanstack/virtual-core`'s
 * `observeElementOffset` and `observeWindowOffset`, with an unsubscribe that also
 * cancels the pending is-scrolling reset.
 *
 * The library's own observers (3.16) report the end of a scroll through a
 * debounced timer (`isScrollingResetDelay` after the last scroll event) and
 * their unsubscribe only removes the listeners. A scroll just before unmount
 * thus left the timer running, and it re-rendered the unmounted component when
 * it fired. Under test that lands after jsdom is torn down, as "window is not
 * defined" from React. These copies clear the timer on unsubscribe, so nothing
 * of the virtualizer outlives its component.
 *
 * Pass `observeElementOffset: observeScrollOffset` to `useVirtualizer` and
 * `observeElementOffset: observeWindowScrollOffset` to `useWindowVirtualizer`;
 * `__tests__/virtualizer-observer-guard.test.ts` fails a call that does not.
 *
 * One consequence of cancelling: when a virtualizer swaps its scroll element
 * (its `_willUpdate` unsubscribes the old one) within the reset delay of a
 * scroll, the dropped reset leaves `isScrolling` true until the next scroll on
 * the new element. That only gates measuring during a scroll.
 */
import type { Virtualizer } from "@tanstack/react-virtual"

type OffsetCallback = (offset: number, isScrolling: boolean) => void

const PASSIVE = { passive: true } as const

function observeOffset<S extends Element | Window, I extends Element>(
  instance: Virtualizer<S, I>,
  cb: OffsetCallback,
  read: (scrollElement: S) => number,
): (() => void) | undefined {
  const element = instance.scrollElement
  const win = instance.targetWindow
  if (!element || !win) return undefined
  const { isScrollingResetDelay, useScrollendEvent } = instance.options
  const withScrollend = Boolean(useScrollendEvent) && "onscrollend" in win

  let offset = 0
  let resetTimer: number | undefined
  const cancelReset = () => {
    if (resetTimer !== undefined) win.clearTimeout(resetTimer)
    resetTimer = undefined
  }
  const onScroll = () => {
    offset = read(element)
    if (!withScrollend) {
      cancelReset()
      resetTimer = win.setTimeout(() => {
        resetTimer = undefined
        cb(offset, false)
      }, isScrollingResetDelay)
    }
    cb(offset, true)
  }
  const onScrollEnd = () => {
    offset = read(element)
    cb(offset, false)
  }

  element.addEventListener("scroll", onScroll, PASSIVE)
  if (withScrollend) element.addEventListener("scrollend", onScrollEnd, PASSIVE)
  return () => {
    element.removeEventListener("scroll", onScroll)
    if (withScrollend) element.removeEventListener("scrollend", onScrollEnd)
    cancelReset()
  }
}

/** For `useVirtualizer`: the scroll element's offset (negative when horizontal right-to-left). */
export function observeScrollOffset<T extends Element, I extends Element>(
  instance: Virtualizer<T, I>,
  cb: OffsetCallback,
): (() => void) | undefined {
  return observeOffset(instance, cb, (el) => {
    const { horizontal, isRtl } = instance.options
    return horizontal ? el.scrollLeft * (isRtl ? -1 : 1) : el.scrollTop
  })
}

/** For `useWindowVirtualizer`: the window's scroll offset. */
export function observeWindowScrollOffset<I extends Element>(
  instance: Virtualizer<Window, I>,
  cb: OffsetCallback,
): (() => void) | undefined {
  return observeOffset(instance, cb, (win) => (instance.options.horizontal ? win.scrollX : win.scrollY))
}
