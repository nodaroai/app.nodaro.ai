import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { TRANSCRIPT, dialog, key, loadCanvas, mountInspector, wordGestures } from "./review-test-canvas"
import { at, freshTake, h, loaded, media, player, tab, useHarness, withTake } from "./review-player-fixtures"

/**
 * The selection toolbar's Play (A3-4, decided 2026-10-07): it plays the
 * selection through the take's clock when the take is fresh, else the Original
 * ± 1.5 s — a kept word's click rule. Words: So 0.1–0.4, the 0.5–0.8, thing
 * 0.9–1.3, um 4.2–4.6 (cut), is 5.1–5.4; the take is 0–4 s then 5–9 s.
 */
useHarness()

const toolbar = () => screen.getByRole("toolbar", { name: "Selection" })
const playSelection = () => fireEvent.click(within(toolbar()).getByRole("button", { name: "Play selection" }))

describe("Play on the selection toolbar", () => {
  it("on a fresh take plays the selection through the take's clock, and stops where it ends", () => {
    withTake(freshTake())
    mountInspector()
    const take = media("take")!
    loaded(take)
    // thing … is: kept 0.9–4 s, then 5–5.4 s, which the take plays at 4–4.4 s.
    wordGestures(h.page).drag(2, 4)
    playSelection()
    expect(take.currentTime).toBeCloseTo(0.9)
    expect(h.played).toContain(take)
    expect(media("original")).toBeNull()
    at(take, 4.3)
    expect(h.paused).not.toContain(take)
    at(take, 4.4)
    expect(h.paused).toContain(take)
    // The selection stays for the reviewer's next move.
    expect(screen.getByRole("toolbar", { name: "Selection" })).toBeTruthy()
  })

  it("on a take that predates the edits plays the Original, the selection ± 1.5 s", () => {
    withTake({ url: "https://cdn.test/old.mp4", quality: "proxy" })
    mountInspector()
    wordGestures(h.page).drag(3, 4)
    playSelection()
    expect(tab(/^Original$/).getAttribute("aria-checked")).toBe("true")
    const original = media("original")!
    loaded(original)
    // um … is: 4.2–5.4 s.
    expect(original.currentTime).toBeCloseTo(2.7)
    expect(h.played).toContain(original)
    at(original, 6.8)
    expect(h.paused).not.toContain(original)
    at(original, 6.9)
    expect(h.paused).toContain(original)
  })

  it("with no take at all plays the Original", () => {
    mountInspector()
    wordGestures(h.page).drag(0, 1)
    playSelection()
    const original = media("original")!
    loaded(original)
    expect(original.currentTime).toBe(0)
    expect(h.played).toContain(original)
  })

  it("on the Original tab plays the Original even when the take is fresh", () => {
    withTake(freshTake())
    mountInspector()
    fireEvent.click(tab(/^Original$/))
    wordGestures(h.page).drag(2, 4)
    playSelection()
    const original = media("original")!
    loaded(original)
    expect(original.currentTime).toBeCloseTo(0)
    expect(h.played).toContain(original)
  })

  it("on a fresh take, a selection with nothing kept plays the Original", () => {
    // Two fillers, "um" and "uh" (4.2–4.9 s), are all cut: none of them is on the take.
    const transcript = { ...TRANSCRIPT, words: [...TRANSCRIPT.words.slice(0, 4), { text: "uh", startMs: 4700, endMs: 4900, speaker: "A" }, TRANSCRIPT.words[4]] }
    loadCanvas({ transcript, cut: { generatedResults: [freshTake()], activeResultIndex: 0 } })
    mountInspector()
    wordGestures(h.page).drag(3, 4)
    playSelection()
    expect(tab(/^Original$/).getAttribute("aria-checked")).toBe("true")
    const original = media("original")!
    loaded(original)
    expect(original.currentTime).toBeCloseTo(2.7)
  })

  it("a seek of the reviewer's own cancels the stop", () => {
    withTake(freshTake())
    mountInspector()
    const take = media("take")!
    loaded(take)
    wordGestures(h.page).drag(2, 4)
    playSelection()
    wordGestures(h.page).click(0)
    at(take, 6)
    expect(h.paused).not.toContain(take)
  })

  it("stops at the selection's end between timeupdate events (a frame loop watches the clock)", () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb))
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined)
    const frame = () => frames.splice(0).forEach((cb) => cb(0))
    withTake(freshTake())
    mountInspector()
    const take = media("take")!
    loaded(take)
    wordGestures(h.page).drag(2, 4)
    playSelection()
    // The clock passes 4.4 s with no timeupdate in between (they come ~4 Hz).
    take.currentTime = 4.2
    frame()
    expect(h.paused).not.toContain(take)
    take.currentTime = 4.41
    frame()
    expect(h.paused).toContain(take)
  })

  it("Space after Play selection pauses the player instead of playing the selection again", () => {
    withTake(freshTake())
    mountInspector()
    const take = media("take")!
    loaded(take)
    wordGestures(h.page).drag(2, 4)
    playSelection()
    expect(h.played).toHaveLength(1)
    // A mouse click leaves the toolbar button focused; Space goes to the player.
    const button = within(toolbar()).getByRole("button", { name: "Play selection" })
    act(() => button.focus())
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    h.played = []
    key(" ")
    expect(h.paused).toContain(take)
    expect(h.played).toHaveLength(0)
  })
})
