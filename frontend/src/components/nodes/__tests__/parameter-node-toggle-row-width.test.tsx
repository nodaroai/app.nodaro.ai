/**
 * A picker node is wide enough for its toggle row (Prompt hint + Picks /
 * Prompt / Both) to sit on ONE line, whatever the locale's labels measure:
 *
 *  1. The floor is measured from the controls (their fractional widths + the
 *     row gap + content padding + the card border, rounded up, plus 1px of
 *     slack for flex-wrap's fractional line breaking) and passed to the card
 *     as its minimum width AND to BaseNode as the resizer's minimum — so
 *     neither the default width nor a manual resize can wrap the row.
 *  2. Below the long-standing 220px minimum nothing changes (a node without
 *     the hint toggle keeps 220).
 *  3. A node saved narrower than its floor (resized before the row grew) is
 *     raised TO the floor, never cleared (a zoomed node must keep a width);
 *     a wider one is left alone. In read-only mode, where the store refuses
 *     the write, the content does not demand more than the saved width.
 *  4. A control growing later (label change, ResizeObserver) moves the floor.
 *
 * jsdom lays nothing out, so widths are stubbed per control and the computed
 * styles the hook reads (gap, padding, border) are stubbed on the row, the
 * content div and the card: what is under test is the arithmetic and the
 * wiring, including every term of the sum.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"

let mockNodes: Array<{ id: string; type: string; data: Record<string, unknown>; width?: number; className?: string }> = []
const updateNodeData = vi.fn()
const updateNode = vi.fn()
const baseNodeProps: Array<Record<string, unknown>> = []

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "n1"),
  useUpdateNodeInternals: vi.fn(() => vi.fn()),
  useConnection: vi.fn(() => ({ inProgress: false })),
}))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: () => null,
}))
vi.mock("../handle-icon", () => ({ HandleIcon: () => null }))
vi.mock("../base-node", () => ({
  BaseNode: (props: any) => {
    baseNodeProps.push(props)
    return <div className="card-stub">{props.children}</div>
  },
}))
vi.mock("../run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("@/hooks/use-workflow-store", () => ({
  EXECUTION_DATA_KEYS: new Set(["executionStatus"]),
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({ updateNodeData, updateNode, runFromHere: () => {}, openFullscreenSettings: () => {}, nodes: mockNodes, edges: [], loadGeneration: 0 }),
    { getState: () => ({ nodes: mockNodes, edges: [] }) },
  ),
}))

import { MoodNode } from "../mood-node"
import { EraNode } from "../era-node"
import { ToneNode } from "../tone-node"

let hintW = 44.5
let pillW = 168.25
const GAP = 4
const PADDING = 24
const BORDER = 4
// ceil(44.5 + 4 + 168.25 + 24 + 4) + 1 = ceil(244.75) + 1 = 246
const floorFor = (hint: number, pill: number) => Math.ceil(hint + GAP + pill + PADDING + BORDER) + 1

const isRow = (el: Element) => el.classList.contains("toggle-row")
const isContent = (el: Element) => el.firstElementChild !== null && isRow(el.firstElementChild)
const isCard = (el: Element) => el.classList.contains("card-stub")
const controlWidth = (el: Element): number => {
  if (el.getAttribute("role") !== "tablist" || !el.parentElement || !isRow(el.parentElement)) return 0
  // First control of the row = hint toggle (when present), last = display pill.
  return el === el.parentElement.lastElementChild ? pillW : hintW
}

const originalGCS = window.getComputedStyle
const resizeCallbacks: Array<(entries: unknown[]) => void> = []

beforeEach(() => {
  updateNodeData.mockClear()
  updateNode.mockClear()
  baseNodeProps.length = 0
  resizeCallbacks.length = 0
  hintW = 44.5
  pillW = 168.25
  window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
    const real = originalGCS.call(window, el, pseudo)
    const w = controlWidth(el)
    return new Proxy(real, {
      get(target, prop) {
        if (prop === "width" && w > 0) return `${w}px`
        if (prop === "columnGap" && isRow(el)) return `${GAP}px`
        if ((prop === "paddingLeft" || prop === "paddingRight") && isContent(el)) return `${PADDING / 2}px`
        if ((prop === "borderLeftWidth" || prop === "borderRightWidth") && isCard(el)) return `${BORDER / 2}px`
        return Reflect.get(target, prop)
      },
    })
  }) as typeof window.getComputedStyle
  globalThis.ResizeObserver = class {
    constructor(cb: (entries: unknown[]) => void) {
      resizeCallbacks.push(cb)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => {
  window.getComputedStyle = originalGCS
})

function renderNode(Node: any, type: string, data: Record<string, unknown>, width?: number) {
  mockNodes = [{ id: "n1", type, data, ...(width !== undefined ? { width } : {}) }]
  return render(<Node id="n1" data={data} selected type={type} {...({} as any)} />)
}

const lastBaseNode = () => baseNodeProps[baseNodeProps.length - 1]!
const contentDivOf = (container: HTMLElement) => container.querySelector(".toggle-row")!.parentElement as HTMLElement
const wrapperOf = (container: HTMLElement) => container.querySelector(".group.relative") as HTMLElement

describe("picker node width follows its toggle row", () => {
  it("sums fractional control widths, gap, padding and border, rounds up, and adds 1px slack", () => {
    const { container } = renderNode(MoodNode, "mood", { label: "Mood", mood: "calm" })
    const floor = floorFor(hintW, pillW)
    expect(floor).toBe(246)
    expect(lastBaseNode().minWidth).toBe(floor)
    expect(contentDivOf(container).style.minWidth).toBe(`${floor - BORDER}px`)
  })

  it("never drops below the long-standing 220px minimum", () => {
    // Tone has no hint toggle: the pill alone is under the minimum.
    const { container } = renderNode(ToneNode, "tone", { label: "Tone", tone: "calm" })
    expect(lastBaseNode().minWidth).toBe(220)
    expect(contentDivOf(container).style.minWidth).toBe(`${220 - BORDER}px`)
  })

  it("caps a compact (non-fluid) picker at exactly the floor", () => {
    const { container } = renderNode(EraNode, "era", { label: "Era", era: "1920s-flapper" })
    const floor = floorFor(hintW, pillW)
    expect(lastBaseNode().minWidth).toBe(floor)
    expect(wrapperOf(container).style.maxWidth).toBe(`${floor}px`)
    expect(contentDivOf(container).style.minWidth).toBe(`${floor - BORDER}px`)
  })

  it("the resizer floor follows the node's zoom, like the rest of its geometry", () => {
    renderNode(MoodNode, "mood", { label: "Mood", mood: "calm", zoom: 0.5 })
    expect(lastBaseNode().minWidth).toBe(Math.round(floorFor(hintW, pillW) * 0.5))
  })

  it("raises a saved width narrower than the floor to the floor, and leaves a wider one alone", () => {
    // Not user-resized: the derived height is cleared too, so the card re-fits the one-line row.
    renderNode(MoodNode, "mood", { label: "Mood", mood: "calm", zoom: 2 }, 440)
    expect(updateNode).toHaveBeenCalledWith("n1", { width: floorFor(hintW, pillW) * 2, height: undefined })
    expect(updateNode).not.toHaveBeenCalledWith("n1", { width: undefined })
    updateNode.mockClear()
    renderNode(MoodNode, "mood", { label: "Mood", mood: "calm" }, 300)
    expect(updateNode).not.toHaveBeenCalledWith("n1", expect.objectContaining({ width: expect.anything() }))
  })

  it("keeps a height the user chose (rf-resized) when raising the width", () => {
    mockNodes = [{ id: "n1", type: "mood", data: { label: "Mood", mood: "calm" }, width: 230, className: "rf-resized" } as any]
    render(<MoodNode id="n1" data={{ label: "Mood", mood: "calm" }} selected type="mood" {...({} as any)} />)
    expect(updateNode).toHaveBeenCalledWith("n1", { width: floorFor(hintW, pillW) })
  })

  it("never caps a compact picker below a width it already carries", () => {
    const { container } = renderNode(EraNode, "era", { label: "Era", era: "1920s-flapper" }, 300)
    expect(wrapperOf(container).style.maxWidth).toBe("300px")
  })

  it("while a too-narrow width is still saved (read-only), the content asks for no more than it", () => {
    const { container } = renderNode(MoodNode, "mood", { label: "Mood", mood: "calm" }, 230)
    expect(contentDivOf(container).style.minWidth).toBe(`${230 - BORDER}px`)
  })

  it("moves the floor when a control grows later", () => {
    renderNode(MoodNode, "mood", { label: "Mood", mood: "calm" })
    expect(lastBaseNode().minWidth).toBe(floorFor(44.5, 168.25))
    pillW = 183.5 // Hebrew labels
    act(() => resizeCallbacks.forEach((cb) => cb([])))
    expect(lastBaseNode().minWidth).toBe(floorFor(44.5, 183.5))
  })
})
