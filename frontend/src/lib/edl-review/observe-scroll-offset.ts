/**
 * The transcript virtualizer's scroll observer: `@tanstack/virtual-core`'s
 * `observeElementOffset`, with an unsubscribe that also cancels the pending
 * is-scrolling reset.
 *
 * The library's own observer (3.16) reports the end of a scroll through a
 * debounced timer (`isScrollingResetDelay` after the last scroll event) and
 * its unsubscribe only removes the listeners. A scroll just before unmount
 * thus left the timer running, and it re-rendered the unmounted pane when it
 * fired. Under test that lands after jsdom is torn down, as "window is not
 * defined" from React. This copy clears the timer on unsubscribe, so nothing
 * of the virtualizer outlives the pane.
 */
import type { Virtualizer } from "@tanstack/react-virtual"

type OffsetCallback = (offset: number, isScrolling: boolean) => void

const PASSIVE = { passive: true } as const

export function observeScrollOffset<T extends Element>(instance: Virtualizer<T, Element>, cb: OffsetCallback): (() => void) | undefined {
  const element = instance.scrollElement
  const win = instance.targetWindow
  if (!element || !win) return undefined
  const { horizontal, isRtl, isScrollingResetDelay, useScrollendEvent } = instance.options
  const read = () => (horizontal ? element.scrollLeft * (isRtl ? -1 : 1) : element.scrollTop)
  const withScrollend = Boolean(useScrollendEvent) && "onscrollend" in win

  let offset = 0
  let resetTimer: number | undefined
  const cancelReset = () => {
    if (resetTimer !== undefined) win.clearTimeout(resetTimer)
    resetTimer = undefined
  }
  const onScroll = () => {
    offset = read()
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
    offset = read()
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
