import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Virtualizer } from "@tanstack/react-virtual"
import { observeScrollOffset } from "../observe-scroll-offset"

/** The parts of a virtualizer the observer reads. */
function instance(el: HTMLElement, options: Partial<Virtualizer<HTMLElement, Element>["options"]> = {}) {
  return {
    scrollElement: el,
    targetWindow: window,
    options: { horizontal: false, isRtl: false, isScrollingResetDelay: 150, useScrollendEvent: false, ...options },
  } as unknown as Virtualizer<HTMLElement, Element>
}

function scroll(el: HTMLElement, top: number) {
  el.scrollTop = top
  el.dispatchEvent(new Event("scroll"))
}

describe("observeScrollOffset", () => {
  let el: HTMLElement
  beforeEach(() => {
    vi.useFakeTimers()
    el = document.createElement("div")
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reports each scroll as scrolling, then its end once the reset delay passes", () => {
    const cb = vi.fn()
    observeScrollOffset(instance(el), cb)
    scroll(el, 40)
    scroll(el, 80)
    expect(cb.mock.calls).toEqual([[40, true], [80, true]])
    vi.advanceTimersByTime(149)
    expect(cb).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(cb).toHaveBeenLastCalledWith(80, false)
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it("cancels the pending reset on unsubscribe: nothing fires after the pane unmounts", () => {
    const cb = vi.fn()
    const off = observeScrollOffset(instance(el), cb)!
    scroll(el, 40)
    off()
    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    scroll(el, 80)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("reads a horizontal right-to-left offset as negative", () => {
    const cb = vi.fn()
    observeScrollOffset(instance(el, { horizontal: true, isRtl: true }), cb)
    el.scrollLeft = 30
    el.dispatchEvent(new Event("scroll"))
    expect(cb).toHaveBeenCalledWith(-30, true)
  })

  it("ends a scroll on scrollend, with no timer, when asked to", () => {
    const cb = vi.fn()
    observeScrollOffset(instance(el, { useScrollendEvent: true }), cb)
    scroll(el, 40)
    expect(vi.getTimerCount()).toBe(0)
    el.dispatchEvent(new Event("scrollend"))
    expect(cb).toHaveBeenLastCalledWith(40, false)
  })

  it("observes nothing without a scroll element", () => {
    const none = { scrollElement: null, targetWindow: window, options: {} } as unknown as Virtualizer<HTMLElement, Element>
    expect(observeScrollOffset(none, vi.fn())).toBeUndefined()
  })
})
