import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Virtualizer } from "@tanstack/react-virtual"
import { observeScrollOffset, observeWindowScrollOffset } from "../observe-scroll-offset"

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

/** A window virtualizer: its scroll element is the window itself. */
function windowInstance(options: Partial<Virtualizer<Window, Element>["options"]> = {}) {
  return {
    scrollElement: window,
    targetWindow: window,
    options: { horizontal: false, isRtl: false, isScrollingResetDelay: 150, useScrollendEvent: false, ...options },
  } as unknown as Virtualizer<Window, Element>
}

function scrollWindow(y: number, x = 0) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true })
  Object.defineProperty(window, "scrollX", { value: x, configurable: true })
  window.dispatchEvent(new Event("scroll"))
}

describe("observeWindowScrollOffset", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    scrollWindow(0)
  })

  it("reports the window's scroll as scrolling, then its end once the reset delay passes", () => {
    const cb = vi.fn()
    const off = observeWindowScrollOffset(windowInstance(), cb)!
    scrollWindow(120)
    expect(cb).toHaveBeenLastCalledWith(120, true)
    vi.advanceTimersByTime(150)
    expect(cb).toHaveBeenLastCalledWith(120, false)
    off()
  })

  it("reads scrollX when horizontal", () => {
    const cb = vi.fn()
    const off = observeWindowScrollOffset(windowInstance({ horizontal: true }), cb)!
    scrollWindow(0, 64)
    expect(cb).toHaveBeenLastCalledWith(64, true)
    off()
  })

  it("cancels the pending reset on unsubscribe", () => {
    const cb = vi.fn()
    const off = observeWindowScrollOffset(windowInstance(), cb)!
    scrollWindow(40)
    off()
    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    scrollWindow(80)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("observes nothing without a window", () => {
    const none = { scrollElement: null, targetWindow: null, options: {} } as unknown as Virtualizer<Window, Element>
    expect(observeWindowScrollOffset(none, vi.fn())).toBeUndefined()
  })
})
