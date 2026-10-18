import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))
const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>()
  return { ...actual, toast: Object.assign(vi.fn(), { ...actual.toast, error: toastError }) }
})

import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { PLAN, dialog, key, layOut, loadCanvas, mountInspector, planData, wordEl, wordGestures } from "./review-test-canvas"
import { BEFORE_SOURCE, LOCKED_NO_PICTURE, OVERLAPPING, TWO_FILLERS, narrowWindow } from "./review-panel-fixtures"

/**
 * The review inspector's reasons panel, banners and below-`sm` tabs (A3-3b,
 * §2.3 and §2.4 of the inspectors design). It is mounted directly here; the
 * editor's ways in are in review-entry-flow.test.tsx.
 */
let page: ReturnType<typeof layOut>
beforeEach(() => {
  resetUndoStacks()
  toastError.mockReset()
  page = layOut()
  loadCanvas()
})
afterEach(() => {
  cleanup()
  page.restore()
  delete (window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__
  delete (window as { matchMedia?: unknown }).matchMedia
})

const drag = (from: number, to: number) => wordGestures(page).drag(from, to)
const click = (i: number) => wordGestures(page).click(i)
const panel = () => screen.getByTestId("reasons-panel")
const reasonRow = (label: string) => within(panel()).getByText(label).closest<HTMLElement>("[data-reason]")!
const box = (label: string) => within(reasonRow(label)).getByRole("checkbox")
const showTab = (name: string) => fireEvent.mouseDown(within(dialog()).getByRole("tab", { name }), { button: 0 })
/** Whether `el`'s tab panel is the one showing. */
const shownPanel = (el: HTMLElement) => el.closest("[role='tabpanel']")!.getAttribute("data-state") === "active"

describe("the reasons panel", () => {
  it("lists one row per reason: its swatch, label, count and cut time, and a box ticked while all of it is cut", () => {
    mountInspector()
    const row = reasonRow("Filler")
    expect(row.textContent).toContain("1 · 1 s")
    expect(row.querySelector(".bg-amber-500")).not.toBeNull()
    expect(box("Filler").getAttribute("aria-checked")).toBe("true")
  })

  it("restores a reason whose spans are all cut with its box, and cuts it again", async () => {
    mountInspector()
    fireEvent.click(box("Filler"))
    await waitFor(() => expect(wordEl(3)!.dataset.state).toBe("kept"))
    expect(box("Filler").getAttribute("aria-checked")).toBe("false")
    fireEvent.click(box("Filler"))
    await waitFor(() => expect(wordEl(3)!.dataset.state).toBe("cut"))
  })

  it("shows a reason partly restored as mixed; its box cuts all of it again (◐ → cut)", async () => {
    loadCanvas({ plan: TWO_FILLERS })
    mountInspector()
    click(1)
    fireEvent.click(within(await screen.findByTestId("span-popover")).getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(box("Filler").getAttribute("aria-checked")).toBe("mixed"))
    expect(reasonRow("Filler").textContent).toContain("1 · 1 s")
    fireEvent.click(box("Filler"))
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("cut"))
    expect(wordEl(3)!.dataset.state).toBe("cut")
  })

  it("restores the rest of a partly restored reason with ↺", async () => {
    loadCanvas({ plan: TWO_FILLERS })
    mountInspector()
    click(1)
    fireEvent.click(within(await screen.findByTestId("span-popover")).getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(box("Filler").getAttribute("aria-checked")).toBe("mixed"))
    fireEvent.click(within(reasonRow("Filler")).getByRole("button", { name: "Restore all Filler cuts (1)" }))
    await waitFor(() => expect(wordEl(3)!.dataset.state).toBe("kept"))
    expect(within(reasonRow("Filler")).getByRole("button", { name: "Cut all Filler again (2)" })).toBeTruthy()
  })

  it("lists the reviewer's own cuts as Manual cut, restored with its box", async () => {
    mountInspector()
    drag(0, 1)
    key("Delete")
    await waitFor(() => expect(within(panel()).getByText("Manual cut")).toBeTruthy())
    fireEvent.click(box("Manual cut"))
    await waitFor(() => expect(wordEl(0)!.dataset.state).toBe("kept"))
    expect(within(panel()).queryByText("Manual cut")).toBeNull()
  })

  it("shows 🔒 once hovered when no span of the reason can be restored, and its box names the lock", async () => {
    loadCanvas(LOCKED_NO_PICTURE)
    mountInspector()
    expect(within(reasonRow("No picture")).queryByTestId("reason-locked")).toBeNull()
    fireEvent.pointerEnter(reasonRow("No picture"))
    expect(within(reasonRow("No picture")).getByTestId("reason-locked").getAttribute("title")).toBe("Can't restore: no camera filmed this")
    fireEvent.click(box("No picture"))
    expect(toastError).toHaveBeenCalledWith("1 span can't be restored: no camera filmed this")
    expect(wordEl(0)!.dataset.state).toBe("cut")
    expect(planData().editedEdl).toBeUndefined()
  })

  it("says No issues under the list, or lists the plan's own issues left-to-right", () => {
    mountInspector()
    expect(within(panel()).getByText("No issues")).toBeTruthy()
    cleanup()
    loadCanvas(BEFORE_SOURCE)
    mountInspector()
    const issues = within(panel()).getByTestId("review-issues")
    expect(issues.getAttribute("dir")).toBe("ltr")
    expect(issues.textContent).toMatch(/before/)
  })

  it("offers no box while edits are locked (R9 a)", () => {
    loadCanvas({ readOnly: true })
    mountInspector()
    expect((box("Filler") as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("the banners", () => {
  it("says a take predates the edit once the reviewer cuts (R4 a), with Update preview when the flag is on", async () => {
    ;(window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__ = { previewStopRule: true }
    loadCanvas({ cut: { generatedResults: [{ url: "https://cdn.test/p.mp4", quality: "proxy" }] } })
    mountInspector()
    expect(screen.queryByTestId("banner-stale-take")).toBeNull()
    drag(0, 1)
    key("Delete")
    const banner = await screen.findByTestId("banner-stale-take")
    expect(banner.textContent).toContain("This preview was made before your latest changes. Until you update it, clicking a word plays from the original.")
    expect(within(banner).getByRole("button", { name: /Update preview/ })).toBeTruthy()
  })

  it("offers to discard an edit made on an earlier plan (TA13)", async () => {
    loadCanvas()
    const stale = { v: 1, kind: "edl", basis: "0000000000000000", edl: { segments: PLAN.segments, dropped: [] } }
    const { useWorkflowStore } = await import("@/hooks/use-workflow-store")
    useWorkflowStore.setState({ nodes: useWorkflowStore.getState().nodes.map((n) => (n.id === "plan" ? { ...n, data: { ...n.data, editedEdl: stale } } : n)) as never })
    mountInspector()
    const banner = screen.getByTestId("banner-stale-edit")
    expect(banner.textContent).toContain("Your edits were made on an earlier plan and no longer apply.")
    fireEvent.click(within(banner).getByRole("button", { name: "Discard them" }))
    await waitFor(() => expect(planData().editedEdl).toBeUndefined())
  })

  it("says a plan it cannot edit opens read-only, and hides the footer", () => {
    loadCanvas({ plan: OVERLAPPING })
    mountInspector()
    expect(screen.getByTestId("banner-not-reviewable").textContent).toContain("This plan can't be edited here")
    expect(screen.queryByTestId("review-footer")).toBeNull()
    // No empty bordered band where the footer would be.
    expect(dialog().querySelector('[data-slot="inspector-footer"]')).toBeNull()
  })

  it("says cuts are listed by time with no transcript (Cuts-only)", () => {
    loadCanvas({ wired: { transcript: false } })
    mountInspector()
    expect(screen.getByTestId("banner-cuts-only").textContent).toContain("No transcript is loaded, so cuts are listed by time.")
  })

  it("says the plan as made breaks the render's rules", () => {
    loadCanvas(BEFORE_SOURCE)
    mountInspector()
    expect(screen.getByTestId("banner-plan-refused").textContent).toContain("The plan as made has 1 issue with this render.")
  })
})

describe("below sm: the tabs", () => {
  it("stacks Transcript, Cuts and Issues as tabs, the transcript first", () => {
    narrowWindow()
    mountInspector()
    const tabs = within(dialog()).getByRole("tablist")
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Transcript", "Cuts", "Issues"])
    expect(shownPanel(screen.getByTestId("review-transcript"))).toBe(true)
    expect(shownPanel(screen.getByTestId("reasons-panel"))).toBe(false)
    showTab("Cuts")
    expect(shownPanel(screen.getByTestId("reasons-panel"))).toBe(true)
    expect(shownPanel(screen.getByTestId("review-transcript"))).toBe(false)
    showTab("Issues")
    expect(shownPanel(within(dialog()).getByText("No issues"))).toBe(true)
    expect(screen.getByTestId("review-footer")).toBeTruthy()
  })

  // Decided 2026-10-07: the inactive tabs stay mounted, hidden.
  it("keeps the transcript mounted behind another tab, with its scroll, selection and find", async () => {
    narrowWindow()
    mountInspector()
    const scroller = screen.getByTestId("review-transcript")
    key("f", { metaKey: true })
    const input = await screen.findByRole("textbox", { name: "Find in transcript" })
    fireEvent.change(input, { target: { value: "thing" } })
    await waitFor(() => expect(within(dialog()).getByText("1 of 1")).toBeTruthy())
    drag(0, 1)
    expect(screen.getByRole("toolbar", { name: "Selection" })).toBeTruthy()
    scroller.scrollTop = 40
    showTab("Cuts")
    // Hidden, not unmounted: still laid out (invisible, not display:none), out of reach.
    const panel = scroller.closest<HTMLElement>("[role='tabpanel']")!
    expect(panel.hasAttribute("hidden")).toBe(false)
    expect(panel.hasAttribute("inert")).toBe(true)
    expect(panel.className).toContain("invisible")
    showTab("Transcript")
    expect(screen.getByTestId("review-transcript")).toBe(scroller)
    expect(scroller.scrollTop).toBe(40)
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Find in transcript" }).value).toBe("thing")
    expect(screen.getByRole("toolbar", { name: "Selection" })).toBeTruthy()
    expect(panel.hasAttribute("inert")).toBe(false)
  })

  it("leaves the hidden transcript's layers alone: Escape on another tab closes the dialog", async () => {
    narrowWindow()
    const { onClose } = mountInspector()
    key("f", { metaKey: true })
    await screen.findByRole("textbox", { name: "Find in transcript" })
    showTab("Cuts")
    fireEvent.keyDown(dialog(), { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("does not cut the hidden transcript's selection from another tab", () => {
    narrowWindow()
    mountInspector()
    drag(0, 1)
    showTab("Cuts")
    key("Delete")
    expect(wordEl(0)!.dataset.state).toBe("kept")
    showTab("Transcript")
    expect(screen.getByRole("toolbar", { name: "Selection" })).toBeTruthy()
  })

  // Decided 2026-10-07: ⌘F on Cuts or Issues switches to Transcript and opens find.
  it.each(["Cuts", "Issues"])("switches to Transcript and opens find on ⌘F from %s", async (name) => {
    narrowWindow()
    mountInspector()
    showTab(name)
    // A click on a tab focuses it (Radix activates a tab on focus).
    within(dialog()).getByRole("tab", { name }).focus()
    key("f", { metaKey: true })
    const input = await screen.findByRole("textbox", { name: "Find in transcript" })
    expect(shownPanel(screen.getByTestId("review-transcript"))).toBe(true)
    expect(within(dialog()).getByRole("tab", { name: "Transcript" }).getAttribute("aria-selected")).toBe("true")
    await waitFor(() => expect(document.activeElement).toBe(input))
  })

  it("stays on Transcript when that find closes, with focus in the transcript", async () => {
    narrowWindow()
    const { onClose } = mountInspector()
    showTab("Cuts")
    within(dialog()).getByRole("tab", { name: "Cuts" }).focus()
    key("f", { metaKey: true })
    const input = await screen.findByRole("textbox", { name: "Find in transcript" })
    await waitFor(() => expect(document.activeElement).toBe(input))
    key("Escape")
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Find in transcript" })).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    expect(shownPanel(screen.getByTestId("review-transcript"))).toBe(true)
    // Not the Cuts tab it came from: focusing that would open Cuts again.
    expect(screen.getByTestId("review-transcript").contains(document.activeElement)).toBe(true)
  })

  it("leaves Cuts open on ⌘F when there is no transcript to find in (Cuts-only)", () => {
    narrowWindow()
    loadCanvas({ wired: { transcript: false } })
    mountInspector()
    showTab("Cuts")
    within(dialog()).getByRole("tab", { name: "Cuts" }).focus()
    key("f", { metaKey: true })
    expect(shownPanel(screen.getByTestId("reasons-panel"))).toBe(true)
    expect(screen.queryByRole("textbox", { name: "Find in transcript" })).toBeNull()
  })

  it("shows the reasons beside the transcript, with no tabs, from sm up", () => {
    mountInspector()
    expect(within(dialog()).queryByRole("tablist")).toBeNull()
    expect(screen.getByTestId("reasons-panel")).toBeTruthy()
    expect(screen.getByTestId("review-transcript")).toBeTruthy()
  })
})
