/**
 * The canvas and the layout the review inspector's tests mount it on.
 *
 * jsdom lays nothing out, and the transcript is virtualised: with no size, the
 * virtualizer would show no row at all (and, measuring every row as 0 px, would
 * keep mounting rows). `layOut()` gives the transcript's scroller a height and
 * every row its height (`offsetHeight`, what the virtualizer reads; a collapsed
 * run's chip is shorter than a paragraph), so the virtualizer windows the rows as a browser does,
 * and stands in for `elementFromPoint` (the drag's hit test), `scrollTo` and
 * the first report a browser's `ResizeObserver` makes of each row.
 */
import { vi } from "vitest"
import { render } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { ReviewInspector } from "../review-inspector"

export const VIEWPORT_PX = 600
export const ROW_PX = 80
/** A collapsed run's row is a single chip: shorter than a paragraph. */
export const COLLAPSED_ROW_PX = 32

export const PLAN = {
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
  segments: [
    { id: "s0", inMs: 0, outMs: 4000, video: "cam" },
    { id: "s1", inMs: 5000, outMs: 9000, video: "cam" },
  ],
  dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }],
}
// Words 0..4: So the thing [um] | is — "um" is the filler the plan cut.
export const TRANSCRIPT = {
  version: 1,
  words: [
    { text: "So", startMs: 100, endMs: 400, speaker: "A" },
    { text: "the", startMs: 500, endMs: 800, speaker: "A" },
    { text: "thing", startMs: 900, endMs: 1300, speaker: "A" },
    { text: "um", startMs: 4200, endMs: 4600, speaker: "A" },
    { text: "is", startMs: 5100, endMs: 5400, speaker: "B" },
  ],
}

const at = { x: 0, y: 0 }
const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: at, data })

export interface CanvasOptions {
  readonly plan?: unknown
  readonly transcript?: unknown
  readonly wired?: { readonly transcript?: boolean; readonly plan?: boolean }
  readonly cut?: Record<string, unknown>
  readonly readOnly?: boolean
  readonly extraRender?: boolean
}

export function loadCanvas(opts: CanvasOptions = {}): void {
  const nodes = [
    node("tr", "transcribe", { label: "Transcribe", generatedJson: opts.transcript ?? TRANSCRIPT }),
    node("plan", "edit-plan", { label: "Tighten Plan", mode: "tighten", generatedJson: opts.plan ?? PLAN }),
    node("cut", "apply-edl", { label: "Apply Cut", quality: "proxy", ...opts.cut }),
    ...(opts.extraRender ? [node("cut2", "apply-edl", { label: "Audio Master", output: "audio" })] : []),
  ]
  const edges = [
    ...(opts.wired?.transcript === false ? [] : [{ id: "t", source: "tr", sourceHandle: "json", target: "plan", targetHandle: "transcript" }]),
    ...(opts.wired?.plan === false ? [] : [{ id: "e", source: "plan", sourceHandle: "edl", target: "cut", targetHandle: "edl" }]),
    ...(opts.extraRender ? [{ id: "e2", source: "plan", sourceHandle: "edl", target: "cut2", targetHandle: "edl" }] : []),
  ]
  useWorkflowStore.setState({ nodes: nodes as never, edges: edges as never, isReadOnly: !!opts.readOnly, workflowId: null })
}

export const planData = () => useWorkflowStore.getState().nodes.find((n) => n.id === "plan")!.data as Record<string, unknown>

/** The height jsdom does not compute: the transcript's scroller and each of its rows. */
function heightOf(el: HTMLElement): number {
  if (el.dataset.testid === "review-transcript") return VIEWPORT_PX
  if (el.hasAttribute("data-review-row")) return el.querySelector("[data-row-kind='collapsed']") ? COLLAPSED_ROW_PX : ROW_PX
  return 0
}

/** Give the transcript a height and its rows theirs; route the drag's hit test. */
export function layOut(): { readonly pointAt: (el: Element | null) => void; readonly restore: () => void } {
  // The virtualizer measures with offsetWidth / offsetHeight.
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return heightOf(this) } })
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get(this: HTMLElement) { return heightOf(this) > 0 ? 800 : 0 } })
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
