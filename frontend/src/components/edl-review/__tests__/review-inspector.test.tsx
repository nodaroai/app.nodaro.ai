import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))
const copy = vi.hoisted(() => vi.fn())
vi.mock("@/lib/utils", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), copyToClipboard: copy }))

import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { PLAN, dialog, escape, key, layOut, loadCanvas, mountInspector, planData, wordEl, wordGestures } from "./review-test-canvas"

/**
 * The review inspector's frame (A3-3a): the header, the transcript and its
 * layers — span popover, selection toolbar, find bar. Collapsed runs and
 * Escape's order are in review-inspector.runs.test.tsx. It is mounted
 * directly here; the editor's ways in are in review-entry-flow.test.tsx.
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

const drag = (from: number, to: number) => wordGestures(page).drag(from, to)
const click = (i: number) => wordGestures(page).click(i)

describe("the frame", () => {
  it("is titled by the plan and the render, and badges the take and the render rule", () => {
    loadCanvas({ cut: { generatedResults: [{ url: "https://cdn.test/p.mp4", quality: "proxy" }] } })
    mountInspector()
    expect(screen.getByRole("dialog", { name: "Review cut · Tighten Plan → Apply Cut" })).toBeTruthy()
    // The header's badge (the player's Preview | Original switch says "Preview" too).
    expect(within(dialog()).getByTitle("A 720p preview, kept private").textContent).toBe("Preview")
    expect(within(dialog()).getByTestId("edl-validity-badge").dataset.ok).toBe("true")
  })

  it("lists the transcript as speaker paragraphs, the plan's cut struck in its reason's colour", () => {
    mountInspector()
    expect(document.querySelectorAll("[data-review-row]")).toHaveLength(2)
    expect(wordEl(0)!.dataset.state).toBe("kept")
    expect(wordEl(3)!.dataset.state).toBe("cut")
    expect(wordEl(3)!.className).toContain("decoration-amber-500")
    expect(within(screen.getByTestId("review-transcript")).getByRole("button", { name: /Filler/ })).toBeTruthy()
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

  it("takes Del from the find box once a word is pressed: the press moves focus to the word's row", async () => {
    mountInspector()
    key("f", { metaKey: true })
    const input = await screen.findByRole("textbox", { name: "Find in transcript" })
    fireEvent.change(input, { target: { value: "thing" } })
    drag(0, 2)
    expect(document.activeElement).toBe(wordEl(0)!.closest("[data-review-row]"))
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
