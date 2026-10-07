import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { editPlanBasis } from "@nodaro/shared"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { threeHourSession } from "@/lib/edl-review/__tests__/three-hour-fixture"
import { TRANSCRIPT_OVERSCAN } from "../transcript-pane"
import { ROW_PX, VIEWPORT_PX, escape, key, layOut, loadCanvas, mountInspector, planData, wordEl, wordGestures } from "./review-test-canvas"

/**
 * The inspector on the 3-hour episode (§7 of the inspectors design): ~30k
 * words, 3k dropped spans. The transcript is virtualised, and the selection is
 * by word index, so a drag that scrolls its anchor row out of the DOM still
 * acts on the right words.
 */
const { base, transcript } = threeHourSession()
const plan = JSON.parse(JSON.stringify(base)) as Record<string, unknown>

let page: ReturnType<typeof layOut>
beforeEach(() => {
  resetUndoStacks()
  page = layOut()
  loadCanvas({ plan, transcript })
})
afterEach(() => {
  cleanup()
  page.restore()
})

const rowsInDom = () => document.querySelectorAll("[data-review-row]").length
const scroller = () => screen.getByTestId("review-transcript")

function scrollTo(top: number) {
  act(() => {
    scroller().scrollTop = top
    scroller().dispatchEvent(new Event("scroll"))
  })
}

/** Press on word `from`, scroll `rows` rows down, drag to the last word on screen, release. */
function dragAcross(from: number, rows: number): number {
  fireEvent.pointerDown(wordEl(from)!, { button: 0 })
  scrollTo(rows * ROW_PX)
  const words = [...document.querySelectorAll<HTMLElement>("[data-w]")]
  const target = words[words.length - 1]!
  page.pointAt(target)
  fireEvent.pointerMove(window)
  fireEvent.pointerUp(window)
  return Number(target.dataset.w)
}

describe("the 3-hour transcript", () => {
  it("opens with at most 40 rows in the DOM", () => {
    mountInspector()
    expect(rowsInDom()).toBeGreaterThan(0)
    expect(rowsInDom()).toBeLessThanOrEqual(40)
    expect(rowsInDom()).toBeLessThanOrEqual(Math.ceil(VIEWPORT_PX / ROW_PX) + 2 * TRANSCRIPT_OVERSCAN + 1)
  })

  it("cuts a drag selection whose anchor row scrolled out of the DOM, by word index", async () => {
    const { onClose } = mountInspector()
    const to = dragAcross(0, 200)
    // The anchor row is gone: a DOM selection would have lost it.
    expect(wordEl(0)).toBeNull()
    expect(to).toBeGreaterThan(1000)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Delete" })
    // The paragraphs it cut whole collapse into one run at the top (R11).
    scrollTo(0)
    await waitFor(() => expect(document.querySelector("[data-row-kind='collapsed']")).not.toBeNull())
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    const edit = planData().editedEdl as { basis: string; edl: { segments: Array<{ inMs: number; outMs: number }>; dropped: Array<{ inMs: number; outMs: number; reason: string }> } }
    // Written against the plan's basis; nothing is kept from the anchor's first word to the focus's last…
    expect(edit.basis).toBe(editPlanBasis(plan))
    const words = transcript.words
    const from = words[0]!.startMs
    const until = words[to]!.endMs
    expect(edit.edl.segments.filter((g) => g.inMs < until && g.outMs > from)).toEqual([])
    expect(edit.edl.dropped).toContainEqual({ inMs: from, outMs: 3000, reason: "manual" })
    // …and the first word after it is still kept.
    expect(edit.edl.segments.some((g) => g.inMs <= words[to + 1]!.startMs && g.outMs >= words[to + 1]!.endMs)).toBe(true)
  })

  it("restores a selection across unmounted rows the same way (R10 a)", async () => {
    const { onClose } = mountInspector()
    const to = dragAcross(0, 120)
    expect(wordEl(0)).toBeNull()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "r" })
    // No restore here is locked (no camera starts late; the output stays short).
    await waitFor(() => {
      const shown = [...document.querySelectorAll<HTMLElement>("[data-w]")].filter((w) => Number(w.dataset.w) <= to)
      expect(shown.length).toBeGreaterThan(0)
      expect(shown.every((w) => w.dataset.state === "kept")).toBe(true)
    })
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    const words = transcript.words
    const edit = planData().editedEdl as { edl: { dropped: Array<{ inMs: number; outMs: number }> } }
    const inside = edit.edl.dropped.filter((d) => d.inMs >= words[0]!.startMs && d.outMs <= words[to]!.endMs)
    expect(inside).toEqual([])
    // …and nothing past the block the selection ends in changed (each block is 3.6 s).
    const after = words[to]!.endMs + 3600
    expect(edit.edl.dropped.filter((d) => d.inMs >= after)).toEqual(
      base.dropped!.filter((d) => d.inMs >= after).map(({ inMs, outMs, reason }) => ({ inMs, outMs, reason })),
    )
  })

  it("returns focus to the row that had it when find scrolled it out of the DOM, and shows it again (decided 2026-10-07)", async () => {
    mountInspector()
    wordGestures(page).click(0)
    const row = () => wordEl(0)?.closest("[data-review-row]") ?? null
    await waitFor(() => expect(document.activeElement).toBe(row()))
    key("f", { metaKey: true })
    const input = await screen.findByRole("textbox", { name: "Find in transcript" })
    fireEvent.change(input, { target: { value: "word2500" } })
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByText(/^1 of \d+$/)).toBeTruthy())
    // The match is far down: the row that had focus is no longer in the DOM.
    await waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(0))
    await waitFor(() => expect(wordEl(0)).toBeNull())
    escape()
    // Keys never fall to <body> while the row comes back into view.
    expect(scroller().contains(document.activeElement)).toBe(true)
    await waitFor(() => expect(row()).not.toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row()))
    expect(scroller().scrollTop).toBeLessThan(VIEWPORT_PX)
  })
})
