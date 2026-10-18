import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { COLLAPSED_ROW_PX, ROW_PX, dialog, escape, key, layOut, loadCanvas, mountInspector, planData, wordEl, wordGestures } from "./review-test-canvas"
import { COLLAPSING, THREE_PARAGRAPH_RUN, TWO_RUNS, manyTurns } from "./review-run-fixtures"

/**
 * The review inspector's collapsed runs (R11 of the inspectors design) and
 * Escape's order (§2.4): the span popover, then the selection toolbar, then
 * the find bar, then the expanded run that has focus (decided 2026-10-06),
 * then the dialog.
 */
let page: ReturnType<typeof layOut>
beforeEach(() => {
  resetUndoStacks()
  page = layOut()
  loadCanvas()
})
afterEach(() => {
  cleanup()
  page.restore()
})

const drag = (from: number, to: number) => wordGestures(page).drag(from, to)
const click = (i: number) => wordGestures(page).click(i)
const showWords = () => fireEvent.click(within(dialog()).getByRole("button", { name: "Show these words" }))

describe("collapsed runs (R11)", () => {
  it("collapse a cut of 60 s or more into one row", () => {
    loadCanvas(COLLAPSING)
    mountInspector()
    expect(wordEl(1)).toBeNull()
    expect(within(dialog()).getByRole("button", { name: "Show these words" }).textContent).toContain("Tangent · 1:15 · 2 words")
  })

  it("restores a collapsed run whole with its ↺", async () => {
    loadCanvas(COLLAPSING)
    mountInspector()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("kept"))
    expect(wordEl(2)!.dataset.state).toBe("kept")
  })

  it("stay expanded while the reviewer restores the run's first paragraph", async () => {
    loadCanvas(THREE_PARAGRAPH_RUN)
    mountInspector()
    showWords()
    expect(wordEl(3)).not.toBeNull()
    drag(1, 2)
    key("r")
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("kept"))
    // C and D are still a run of cut paragraphs, and still open.
    expect(wordEl(3)).not.toBeNull()
    expect(wordEl(5)).not.toBeNull()
    expect(within(dialog()).queryByRole("button", { name: "Show these words" })).toBeNull()
  })

  it("keep each row's measured height when a run above them expands", () => {
    loadCanvas(manyTurns())
    mountInspector()
    const scroller = screen.getByTestId("review-transcript")
    const spacer = scroller.firstElementChild as HTMLElement
    // Lay every row out once, as a reviewer scrolling through would.
    for (let top = 0; top <= 40 * ROW_PX; top += 4 * ROW_PX) {
      act(() => {
        scroller.scrollTop = top
        scroller.dispatchEvent(new Event("scroll"))
      })
    }
    act(() => {
      scroller.scrollTop = 0
      scroller.dispatchEvent(new Event("scroll"))
    })
    // 34 paragraphs and two collapsed runs.
    expect(spacer.style.height).toBe(`${34 * ROW_PX + 2 * COLLAPSED_ROW_PX}px`)
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Show these words" })[0]!)
    // 37 paragraphs and one collapsed run: every row past the first keeps its own height.
    expect(spacer.style.height).toBe(`${37 * ROW_PX + COLLAPSED_ROW_PX}px`)
  })
})

describe("Escape closes the innermost layer first (§2.4)", () => {
  it("closes the span popover, and leaves the dialog open", async () => {
    const { onClose } = mountInspector()
    click(3)
    await screen.findByTestId("span-popover")
    escape()
    await waitFor(() => expect(screen.queryByTestId("span-popover")).toBeNull())
    expect(dialog()).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("clears the selection toolbar, and leaves the dialog open", () => {
    const { onClose } = mountInspector()
    drag(0, 2)
    escape()
    expect(screen.queryByRole("toolbar", { name: "Selection" })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes the find bar, and leaves the dialog open with focus in it", async () => {
    const { onClose } = mountInspector()
    key("f", { metaKey: true })
    await screen.findByRole("textbox", { name: "Find in transcript" })
    escape()
    expect(screen.queryByRole("textbox", { name: "Find in transcript" })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog().contains(document.activeElement)).toBe(true)
  })

  it("moves focus into a run it expands, so one Escape collapses it and the next closes the dialog", () => {
    loadCanvas(COLLAPSING)
    const { onClose } = mountInspector()
    expect(wordEl(1)).toBeNull()
    showWords()
    expect(wordEl(1)).not.toBeNull()
    expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "Hide these words" }))
    escape()
    expect(wordEl(1)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    // Focus is back on the run's chip, outside every expanded run.
    expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "Show these words" }))
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("collapses the expanded run a word was pressed in", () => {
    loadCanvas(THREE_PARAGRAPH_RUN)
    const { onClose } = mountInspector()
    showWords()
    // Pressing "more" (in C, inside the run) focuses its row.
    drag(3, 4)
    escape()
    expect(screen.queryByRole("toolbar", { name: "Selection" })).toBeNull()
    expect(wordEl(3)).not.toBeNull()
    escape()
    expect(wordEl(3)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("collapses the focused run, not the one expanded last", async () => {
    loadCanvas(TWO_RUNS)
    const { onClose } = mountInspector()
    const [first, second] = within(dialog()).getAllByRole("button", { name: "Show these words" })
    fireEvent.click(first!)
    fireEvent.click(second!)
    await waitFor(() => expect(wordEl(5)).not.toBeNull())
    // Focus in the first run ("off"), though the second was expanded last.
    drag(1, 2)
    escape()
    escape()
    expect(wordEl(1)).toBeNull()
    expect(wordEl(5)).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("moves on to the dialog when no expanded run has focus, though one is open", async () => {
    loadCanvas(THREE_PARAGRAPH_RUN)
    const { onClose } = mountInspector()
    showWords()
    // "hello" is outside the run: its row takes focus.
    click(0)
    await waitFor(() => expect(document.activeElement).toBe(wordEl(0)!.closest("[data-review-row]")))
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("closes the dialog with one Escape once the focused run's words are restored", async () => {
    loadCanvas(COLLAPSING)
    const { onClose } = mountInspector()
    showWords()
    drag(1, 2)
    key("r")
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("kept"))
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("keeps a run open after its first paragraph is restored; focus on that paragraph is no longer in it", async () => {
    loadCanvas(THREE_PARAGRAPH_RUN)
    const { onClose } = mountInspector()
    showWords()
    drag(1, 2)
    key("r")
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("kept"))
    // C and D are still an open run, but focus is on B, which left it.
    expect(wordEl(3)).not.toBeNull()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("does not stack the runs find expanded: one Escape closes find, the next the dialog", async () => {
    loadCanvas(TWO_RUNS)
    const { onClose } = mountInspector()
    key("f", { metaKey: true })
    const input = await screen.findByRole("textbox", { name: "Find in transcript" })
    fireEvent.change(input, { target: { value: "topic" } })
    await waitFor(() => expect(within(dialog()).getByText("1 of 2")).toBeTruthy())
    await waitFor(() => expect(wordEl(2)).not.toBeNull())
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(within(dialog()).getByText("2 of 2")).toBeTruthy())
    await waitFor(() => expect(wordEl(5)).not.toBeNull())
    escape()
    expect(screen.queryByRole("textbox", { name: "Find in transcript" })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/**
 * Closing find (decided 2026-10-07): the runs ONLY find opened collapse again,
 * the runs the reviewer opened stay open, and focus goes back to where it was
 * before find opened.
 */
describe("closing find", () => {
  const findBox = () => screen.getByRole("textbox", { name: "Find in transcript" })
  async function findTopicTwice() {
    key("f", { metaKey: true })
    const input = await screen.findByRole("textbox", { name: "Find in transcript" })
    fireEvent.change(input, { target: { value: "topic" } })
    await waitFor(() => expect(within(dialog()).getByText("1 of 2")).toBeTruthy())
    await waitFor(() => expect(wordEl(2)).not.toBeNull())
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(wordEl(5)).not.toBeNull())
  }

  it("collapses the runs find opened again", async () => {
    loadCanvas(TWO_RUNS)
    mountInspector()
    await findTopicTwice()
    escape()
    expect(screen.queryByRole("textbox", { name: "Find in transcript" })).toBeNull()
    expect(wordEl(2)).toBeNull()
    expect(wordEl(5)).toBeNull()
    expect(within(dialog()).getAllByRole("button", { name: "Show these words" })).toHaveLength(2)
  })

  it("keeps the run the reviewer opened open, and collapses only the one find opened", async () => {
    loadCanvas(TWO_RUNS)
    mountInspector()
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Show these words" })[0]!)
    expect(wordEl(2)).not.toBeNull()
    await findTopicTwice()
    escape()
    expect(wordEl(2)).not.toBeNull()
    expect(wordEl(5)).toBeNull()
  })

  it("collapses them the same way from the find bar's close button", async () => {
    loadCanvas(TWO_RUNS)
    mountInspector()
    await findTopicTwice()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close find" }))
    expect(screen.queryByRole("textbox", { name: "Find in transcript" })).toBeNull()
    expect(wordEl(2)).toBeNull()
    expect(wordEl(5)).toBeNull()
    expect(dialog().contains(document.activeElement)).toBe(true)
  })

  it("keeps a run open that find opened and the reviewer then expanded again", async () => {
    loadCanvas(TWO_RUNS)
    mountInspector()
    await findTopicTwice()
    // The reviewer hides the first run find opened, then opens it again: it is theirs now.
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Hide these words" })[0]!)
    await waitFor(() => expect(wordEl(2)).toBeNull())
    fireEvent.click(within(dialog()).getByRole("button", { name: "Show these words" }))
    await waitFor(() => expect(wordEl(2)).not.toBeNull())
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close find" }))
    expect(wordEl(2)).not.toBeNull()
    expect(wordEl(5)).toBeNull()
  })

  it("returns focus to the row that had it before find opened", async () => {
    loadCanvas(TWO_RUNS)
    mountInspector()
    click(0)
    const row = wordEl(0)!.closest("[data-review-row]")
    await waitFor(() => expect(document.activeElement).toBe(row))
    await findTopicTwice()
    expect(document.activeElement).toBe(findBox())
    escape()
    expect(document.activeElement).toBe(wordEl(0)!.closest("[data-review-row]"))
  })

  it("returns focus into the run the reviewer had open, so the next Escape collapses it", async () => {
    loadCanvas(TWO_RUNS)
    const { onClose } = mountInspector()
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Show these words" })[0]!)
    const hide = within(dialog()).getByRole("button", { name: "Hide these words" })
    expect(document.activeElement).toBe(hide)
    await findTopicTwice()
    escape()
    expect(document.activeElement).toBe(within(dialog()).getAllByRole("button", { name: "Hide these words" })[0])
    escape()
    expect(wordEl(2)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("returns focus to the transcript when what had it is gone", async () => {
    loadCanvas(TWO_RUNS)
    mountInspector()
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Show these words" })[0]!)
    expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "Hide these words" }))
    await findTopicTwice()
    // The run that held focus is restored whole while find is open: its control is gone.
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Hide these words" })[0]!)
    await waitFor(() => expect(wordEl(2)).toBeNull())
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Restore" })[0]!)
    await waitFor(() => expect(wordEl(2)!.dataset.state).toBe("kept"))
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close find" }))
    expect(document.activeElement).toBe(screen.getByTestId("review-transcript"))
  })

  it("closes the dialog when no layer is open, writing the edit made just before", async () => {
    const { onClose } = mountInspector()
    drag(0, 2)
    key("Delete")
    await waitFor(() => expect(wordEl(0)!.dataset.state).toBe("cut"))
    // The debounced write has not run yet: Escape-to-close flushes it.
    expect(planData().editedEdl).toBeUndefined()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
    const edit = planData().editedEdl as { kind: string; edl: { dropped: Array<{ reason: string; inMs: number; outMs: number }> } }
    expect(edit.kind).toBe("edl")
    expect(edit.edl.dropped).toContainEqual(expect.objectContaining({ reason: "manual", inMs: 100, outMs: 1300 }))
  })

  it("closes one layer per Escape, innermost first", async () => {
    const { onClose } = mountInspector()
    key("f", { metaKey: true })
    await screen.findByRole("textbox", { name: "Find in transcript" })
    // The press on a word takes focus from the find box (no hand-focusing here).
    drag(0, 1)
    escape()
    expect(screen.queryByRole("toolbar", { name: "Selection" })).toBeNull()
    expect(screen.getByRole("textbox", { name: "Find in transcript" })).toBeTruthy()
    escape()
    expect(screen.queryByRole("textbox", { name: "Find in transcript" })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
