/**
 * The canvas and the layout the review inspector's tests mount it on.
 *
 * jsdom lays nothing out, and the transcript is virtualised: with no size, the
 * virtualizer would show no row at all (and, measuring every row as 0 px, would
 * keep mounting rows). `layOut()` gives the transcript's scroller a height and
 * every row its height (`offsetHeight`, what the virtualizer reads; a collapsed
 * run's chip is shorter than a paragraph), so the virtualizer windows the rows as a browser does,
 * gives the scroller the scroll range its rows span (`scrollHeight`, which caps
 * how far the virtualizer's `scrollToIndex` goes), and stands in for `elementFromPoint` (the drag's hit test), `scrollTo` and
 * the first report a browser's `ResizeObserver` makes of each row.
 */
import { vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { ReviewInspector } from "../review-inspector"

export { PLAN, TRANSCRIPT, loadCanvas, type CanvasOptions } from "./review-canvas"

export const VIEWPORT_PX = 600
export const ROW_PX = 80
/** A collapsed run's row is a single chip: shorter than a paragraph. */
export const COLLAPSED_ROW_PX = 32

export const planData = () => useWorkflowStore.getState().nodes.find((n) => n.id === "plan")!.data as Record<string, unknown>

/** The height jsdom does not compute: the transcript's scroller and each of its rows. */
function heightOf(el: HTMLElement): number {
  if (el.dataset.testid === "review-transcript") return VIEWPORT_PX
  if (el.hasAttribute("data-review-row")) return el.querySelector("[data-row-kind='collapsed']") ? COLLAPSED_ROW_PX : ROW_PX
  return 0
}

/** The scroller's content height: the height the virtualizer gives its inner list. */
function scrollHeightOf(el: HTMLElement): number {
  if (el.dataset.testid !== "review-transcript") return 0
  const list = el.firstElementChild as HTMLElement | null
  return Math.max(VIEWPORT_PX, Number.parseFloat(list?.style.height ?? "") || 0)
}

/** Give the transcript a height and its rows theirs; route the drag's hit test. */
export function layOut(): { readonly pointAt: (el: Element | null) => void; readonly restore: () => void } {
  // The virtualizer measures with offsetWidth / offsetHeight.
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")
  const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")
  const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return heightOf(this) } })
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get(this: HTMLElement) { return heightOf(this) > 0 ? 800 : 0 } })
  Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get(this: Element) { return this instanceof HTMLElement ? scrollHeightOf(this) : 0 } })
  Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get(this: Element) { return this instanceof HTMLElement && this.dataset.testid === "review-transcript" ? VIEWPORT_PX : 0 } })
  const scrollTo = vi.fn(function (this: HTMLElement, opts: ScrollToOptions) {
    this.scrollTop = opts.top ?? this.scrollTop
    this.dispatchEvent(new Event("scroll"))
  })
  ;(Element.prototype as unknown as { scrollTo: unknown }).scrollTo = scrollTo
  let under: Element | null = null
  ;(document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => under
  // A browser's ResizeObserver reports each element once it is observed: the
  // virtualizer measures a row that mounts mid-scroll that way (its own
  // measure-on-mount stands down while a scroll is in progress).
  const resizeObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const blockSize = target instanceof HTMLElement ? heightOf(target) : 0
      const entry = { target, borderBoxSize: [{ blockSize, inlineSize: blockSize > 0 ? 800 : 0 }] }
      this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  return {
    pointAt: (el) => {
      under = el
    },
    restore: () => {
      if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height)
      if (width) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width)
      if (scrollHeight) Object.defineProperty(Element.prototype, "scrollHeight", scrollHeight)
      if (clientHeight) Object.defineProperty(Element.prototype, "clientHeight", clientHeight)
      delete (Element.prototype as unknown as { scrollTo?: unknown }).scrollTo
      delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
      globalThis.ResizeObserver = resizeObserver
    },
  }
}

export function mountInspector(renderId = "cut") {
  const onClose = vi.fn()
  const view = render(<ReviewInspector open renderId={renderId} onClose={onClose} />)
  return { ...view, onClose }
}

/** The transcript's word span `i`, when its row is mounted. */
export const wordEl = (i: number): HTMLElement | null => document.querySelector<HTMLElement>(`[data-w="${i}"]`)

export const dialog = (): HTMLElement => screen.getByRole("dialog")
/** A key pressed where focus is (the dialog when nothing inside has it). */
export const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? dialog(), { key: k, ...init })
export const escape = () => key("Escape")

/** The pointer gestures on words, routed through the page's hit test. */
export function wordGestures(page: ReturnType<typeof layOut>) {
  return {
    /** Press on word `from`, drag to word `to`, release. */
    drag(from: number, to: number) {
      fireEvent.pointerDown(wordEl(from)!, { button: 0 })
      page.pointAt(wordEl(to))
      fireEvent.pointerMove(window)
      fireEvent.pointerUp(window)
    },
    /** A click on word `i`: a press that never reaches another word. */
    click(i: number) {
      fireEvent.pointerDown(wordEl(i)!, { button: 0 })
      fireEvent.pointerUp(window)
    },
  }
}
