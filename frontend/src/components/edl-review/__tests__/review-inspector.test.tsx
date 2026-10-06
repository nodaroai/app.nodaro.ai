import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))
const copy = vi.hoisted(() => vi.fn())
vi.mock("@/lib/utils", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), copyToClipboard: copy }))

import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { COLLAPSED_ROW_PX, PLAN, ROW_PX, layOut, loadCanvas, mountInspector, planData, wordEl } from "./review-test-canvas"

/**
 * The review inspector's frame (A3-3a): the header, the transcript and its
 * layers — span popover, selection toolbar, find bar — and Escape's order
 * (§2.4 of the inspectors design). Nothing in the editor opens it yet (A3-5),
 * so it is mounted directly.
 */
let page: ReturnType<typeof layOut>
beforeEach(() => {
  resetUndoStacks()
  copy.mockReset()
  page = layOut()
  loadCanvas()
})
afterEach(() => {
  cleanup()
  page.restore()
})

const dialog = () => screen.getByRole("dialog")
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? dialog(), { key: k, ...init })
const escape = () => key("Escape")

/** Press on word `from`, drag to word `to`, release. */
function drag(from: number, to: number) {
  fireEvent.pointerDown(wordEl(from)!, { button: 0 })
  page.pointAt(wordEl(to))
  fireEvent.pointerMove(window)
  fireEvent.pointerUp(window)
}
/** A click on word `i`: a press that never reaches another word. */
function click(i: number) {
  fireEvent.pointerDown(wordEl(i)!, { button: 0 })
  fireEvent.pointerUp(window)
}

describe("the frame", () => {
  it("is titled by the plan and the render, and badges the take and the render rule", () => {
    loadCanvas({ cut: { generatedResults: [{ url: "https://cdn.test/p.mp4", quality: "proxy" }] } })
    mountInspector()
    expect(screen.getByRole("dialog", { name: "Review cut · Tighten Plan → Apply Cut" })).toBeTruthy()
    expect(within(dialog()).getByText("Preview")).toBeTruthy()
    expect(within(dialog()).getByTestId("edl-validity-badge").dataset.ok).toBe("true")
  })

  it("lists the transcript as speaker paragraphs, the plan's cut struck in its reason's colour", () => {
    mountInspector()
    expect(document.querySelectorAll("[data-review-row]")).toHaveLength(2)
    expect(wordEl(0)!.dataset.state).toBe("kept")
    expect(wordEl(3)!.dataset.state).toBe("cut")
    expect(wordEl(3)!.className).toContain("decoration-amber-500")
    expect(within(dialog()).getByRole("button", { name: /Filler/ })).toBeTruthy()
  })

  it("says so when no Edit Plan cut feeds the render", () => {
    loadCanvas({ wired: { plan: false } })
    mountInspector()
    expect(screen.getByTestId("review-no-plan")).toBeTruthy()
  })

  it("lists cuts by time when the plan has no transcript (Cuts-only, R5 a)", () => {
    loadCanvas({ wired: { transcript: false } })
    mountInspector()
    expect(document.querySelectorAll("[data-row-kind='cuts-kept']")).toHaveLength(2)
    expect(document.querySelectorAll("[data-row-kind='cuts-cut']")).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Find in transcript" })).toBeNull()
  })

  it("shows the plan as JSON on the JSON tab", () => {
    mountInspector()
    fireEvent.click(within(dialog()).getByRole("button", { name: "JSON" }))
    expect(screen.getByTestId("review-json")).toBeTruthy()
    expect(screen.queryByTestId("review-transcript")).toBeNull()
  })

  it("switches to another render of the same plan from the header's picker (TA2 item 4)", async () => {
    loadCanvas({ extraRender: true })
    mountInspector()
    fireEvent.pointerDown(within(dialog()).getByRole("button", { name: "Choose the render to review" }), { button: 0 })
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Audio Master (Audio)" }))
    expect(screen.getByRole("dialog", { name: "Review cut · Tighten Plan → Audio Master" })).toBeTruthy()
  })
})

describe("the span popover", () => {
  it("opens on a struck word and restores its span", async () => {
    mountInspector()
    click(3)
    const popover = await screen.findByTestId("span-popover")
    expect(popover.textContent).toContain("Filler")
    fireEvent.click(within(popover).getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(wordEl(3)!.dataset.state).toBe("kept"))
  })

  it("names the lock instead of offering Restore when the render rule would refuse it", async () => {
    // cam-b starts 700 ms into the master clock; the plan dropped what came before.
    loadCanvas({
      plan: {
        version: 1,
        clock: "master",
        sources: [{ id: "cam-b", url: "https://cdn.test/b.mp4", kind: "video", role: "camera", offsetMs: 700 }],
        segments: [{ id: "s0", inMs: 1000, outMs: 3000, video: "cam-b" }],
        dropped: [{ inMs: 0, outMs: 1000, reason: "no-picture" }],
      },
      transcript: { version: 1, words: [{ text: "early", startMs: 200, endMs: 600 }, { text: "late", startMs: 1200, endMs: 1600 }] },
    })
    mountInspector()
    click(0)
    const popover = await screen.findByTestId("span-popover")
    expect(within(popover).getByTestId("restore-lock").textContent).toContain("Can't restore: no camera filmed this")
    expect(within(popover).queryByRole("button", { name: "Restore" })).toBeNull()
    expect(planData().editedEdl).toBeUndefined()
  })

  it("keeps naming and restoring its own span when an undo renumbers the cuts", async () => {
    // Two cuts: "the" (a false start), then "um" (filler).
    loadCanvas({
      plan: {
        ...PLAN,
        segments: [
          { id: "s0", inMs: 0, outMs: 450, video: "cam" },
          { id: "s1", inMs: 850, outMs: 4000, video: "cam" },
          { id: "s2", inMs: 5000, outMs: 9000, video: "cam" },
        ],
        dropped: [{ inMs: 450, outMs: 850, reason: "false-start" }, { inMs: 4000, outMs: 5000, reason: "filler" }],
      },
    })
    mountInspector()
    click(1)
    fireEvent.click(within(await screen.findByTestId("span-popover")).getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("kept"))
    // The filler is now the edit's first dropped span.
    click(3)
    await waitFor(() => expect(screen.getByTestId("span-popover").textContent).toContain("Filler"))
    // Undoing the restore puts the false start back in front of it.
    key("z", { metaKey: true })
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("cut"))
    expect(screen.getByTestId("span-popover").textContent).toContain("Filler")
    fireEvent.click(within(screen.getByTestId("span-popover")).getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(wordEl(3)!.dataset.state).toBe("kept"))
    expect(wordEl(1)!.dataset.state).toBe("cut")
  })

  it("offers no edit while edits are locked (R9 a)", async () => {
    loadCanvas({ readOnly: true })
    mountInspector()
    click(3)
    const popover = await screen.findByTestId("span-popover")
    expect(within(popover).queryByRole("button", { name: "Restore" })).toBeNull()
  })
})

describe("the selection", () => {
  it("cuts a dragged selection's whole words, with Del", async () => {
    mountInspector()
    drag(0, 2)
    const bar = screen.getByRole("toolbar", { name: "Selection" })
    expect(within(bar).getByRole("button", { name: "Cut selection · 1.2 s" })).toBeTruthy()
    expect(within(bar).queryByRole("button", { name: /Restore selection/ })).toBeNull()
    key("Delete")
    await waitFor(() => expect(wordEl(0)!.dataset.state).toBe("cut"))
    expect(wordEl(2)!.dataset.state).toBe("cut")
    expect(wordEl(4)!.dataset.state).toBe("kept")
  })

  it("restores a selection that touches a struck word, with R (R10 a)", async () => {
    mountInspector()
    drag(2, 4)
    expect(within(screen.getByRole("toolbar", { name: "Selection" })).getByRole("button", { name: /Restore selection/ })).toBeTruthy()
    key("r")
    await waitFor(() => expect(wordEl(3)!.dataset.state).toBe("kept"))
  })

  it("extends with shift-click, and copies its words from the model with ⌘C", () => {
    mountInspector()
    drag(0, 1)
    fireEvent.pointerDown(wordEl(4)!, { button: 0, shiftKey: true })
    key("c", { metaKey: true })
    expect(copy).toHaveBeenCalledWith("So the thing um is", "Copied")
  })

  it("takes Del from the find box once a word is pressed: the press moves focus to the transcript", async () => {
    mountInspector()
    key("f", { metaKey: true })
    const input = await screen.findByRole("textbox", { name: "Find in transcript" })
    fireEvent.change(input, { target: { value: "thing" } })
    drag(0, 2)
    expect(document.activeElement).toBe(screen.getByTestId("review-transcript"))
    key("Delete")
    await waitFor(() => expect(wordEl(0)!.dataset.state).toBe("cut"))
    expect((input as HTMLInputElement).value).toBe("thing")
  })

  it("ignores keys typed in the header's menus", async () => {
    mountInspector()
    drag(2, 4)
    fireEvent.pointerDown(within(dialog()).getByRole("button", { name: "More actions" }), { button: 0 })
    const menu = await screen.findByRole("menu")
    // "r" is the menu's typeahead (Reset to plan), and Delete means nothing there.
    fireEvent.keyDown(menu, { key: "r" })
    expect(wordEl(3)!.dataset.state).toBe("cut")
    fireEvent.keyDown(menu, { key: "Delete" })
    expect(wordEl(2)!.dataset.state).toBe("kept")
  })

  it("shows no toolbar while edits are locked", () => {
    loadCanvas({ readOnly: true })
    mountInspector()
    drag(0, 2)
    expect(screen.queryByRole("toolbar", { name: "Selection" })).toBeNull()
  })

  it("undoes and redoes with ⌘Z and ⇧⌘Z (R8 a)", async () => {
    mountInspector()
    drag(0, 1)
    key("Delete")
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("cut"))
    key("z", { metaKey: true })
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("kept"))
    key("z", { metaKey: true, shiftKey: true })
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("cut"))
  })
})

describe("writing the edit", () => {
  it("writes the pending edit when the dialog is closed with its close button", async () => {
    const { onClose } = mountInspector()
    drag(0, 1)
    key("Delete")
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("cut"))
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect((planData().editedEdl as { kind: string }).kind).toBe("edl")
  })

  it("writes no edit once K is back at the plan's (R7 a)", async () => {
    mountInspector()
    drag(0, 1)
    key("Delete")
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("cut"))
    key("z", { metaKey: true })
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("kept"))
    escape()
    expect(planData().editedEdl).toBeUndefined()
  })

  it("resets to the plan from the ⋯ menu, clearing a saved edit", async () => {
    mountInspector()
    drag(0, 1)
    key("Delete")
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("cut"))
    fireEvent.pointerDown(within(dialog()).getByRole("button", { name: "More actions" }), { button: 0 })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reset to plan" }))
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("kept"))
    expect(planData().editedEdl).toBeUndefined()
  })
})

describe("find (⌘F)", () => {
  it("finds words case- and accent-insensitively, and counts the matches", async () => {
    mountInspector()
    key("f", { metaKey: true })
    const input = await screen.findByRole("textbox", { name: "Find in transcript" })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: "THING" } })
    await waitFor(() => expect(within(dialog()).getByText("1 of 1")).toBeTruthy())
    expect(wordEl(2)!.className).toContain("bg-amber-300/60")
  })
})

// A run of cut paragraphs 60 s or longer collapses (R11): "off topic" is one.
const COLLAPSING = {
  plan: {
    version: 1,
    clock: "master",
    sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
    segments: [
      { id: "s0", inMs: 0, outMs: 5000, video: "cam" },
      { id: "s1", inMs: 80000, outMs: 85000, video: "cam" },
    ],
    dropped: [{ inMs: 5000, outMs: 80000, reason: "tangent" }],
  },
  transcript: {
    version: 1,
    words: [
      { text: "hello", startMs: 100, endMs: 500, speaker: "A" },
      { text: "off", startMs: 20000, endMs: 20400, speaker: "B" },
      { text: "topic", startMs: 30000, endMs: 30400, speaker: "B" },
      { text: "back", startMs: 80100, endMs: 80500, speaker: "A" },
    ],
  },
}

// Three speaker turns cut whole (B, C, D): a run of three paragraphs, "off topic" its first.
const THREE_PARAGRAPH_RUN = {
  plan: COLLAPSING.plan,
  transcript: {
    version: 1,
    words: [
      { text: "hello", startMs: 100, endMs: 500, speaker: "A" },
      { text: "off", startMs: 20000, endMs: 20400, speaker: "B" },
      { text: "topic", startMs: 30000, endMs: 30400, speaker: "B" },
      { text: "more", startMs: 40000, endMs: 40400, speaker: "C" },
      { text: "stuff", startMs: 50000, endMs: 50400, speaker: "C" },
      { text: "again", startMs: 60000, endMs: 60400, speaker: "D" },
      { text: "back", startMs: 80100, endMs: 80500, speaker: "A" },
    ],
  },
}

// Two tangents of 75 s, each one paragraph that says "topic".
const TWO_RUNS = {
  plan: {
    version: 1,
    clock: "master",
    sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
    segments: [
      { id: "s0", inMs: 0, outMs: 5000, video: "cam" },
      { id: "s1", inMs: 80000, outMs: 85000, video: "cam" },
      { id: "s2", inMs: 160000, outMs: 165000, video: "cam" },
    ],
    dropped: [{ inMs: 5000, outMs: 80000, reason: "tangent" }, { inMs: 85000, outMs: 160000, reason: "tangent" }],
  },
  transcript: {
    version: 1,
    words: [
      { text: "hello", startMs: 100, endMs: 500, speaker: "A" },
      { text: "off", startMs: 20000, endMs: 20400, speaker: "B" },
      { text: "topic", startMs: 30000, endMs: 30400, speaker: "B" },
      { text: "back", startMs: 80100, endMs: 80500, speaker: "A" },
      { text: "another", startMs: 100000, endMs: 100400, speaker: "B" },
      { text: "topic", startMs: 110000, endMs: 110400, speaker: "B" },
      { text: "end", startMs: 160100, endMs: 160500, speaker: "A" },
    ],
  },
}

// Forty one-word turns, two seconds apart; turns 2–4 and 30–32 are cut whole.
function manyTurns() {
  const words = Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, startMs: i * 2000 + 100, endMs: i * 2000 + 500, speaker: i % 2 ? "B" : "A" }))
  return {
    plan: {
      version: 1,
      clock: "master",
      sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 4000, video: "cam" },
        { id: "s1", inMs: 10000, outMs: 60000, video: "cam" },
        { id: "s2", inMs: 66000, outMs: 80000, video: "cam" },
      ],
      dropped: [{ inMs: 4000, outMs: 10000, reason: "tangent" }, { inMs: 60000, outMs: 66000, reason: "tangent" }],
    },
    transcript: { version: 1, words },
  }
}

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
    fireEvent.click(within(dialog()).getByRole("button", { name: "Show these words" }))
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

  it("collapses an expanded run, and leaves the dialog open", () => {
    loadCanvas(COLLAPSING)
    const { onClose } = mountInspector()
    expect(wordEl(1)).toBeNull()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Show these words" }))
    expect(wordEl(1)).not.toBeNull()
    escape()
    expect(wordEl(1)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes the dialog with one Escape once an expanded run's words are restored", async () => {
    loadCanvas(COLLAPSING)
    const { onClose } = mountInspector()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Show these words" }))
    drag(1, 2)
    key("r")
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("kept"))
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("collapses a run the reviewer expanded even after its first paragraph is restored", async () => {
    loadCanvas(THREE_PARAGRAPH_RUN)
    const { onClose } = mountInspector()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Show these words" }))
    drag(1, 2)
    key("r")
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("kept"))
    expect(wordEl(3)).not.toBeNull()
    escape()
    expect(wordEl(3)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
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
