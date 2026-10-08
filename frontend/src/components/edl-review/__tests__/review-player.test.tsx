import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { PLAN, dialog, key, loadCanvas, mountInspector, wordEl, wordGestures } from "./review-test-canvas"
import { at, freshTake, h, loaded, media, player, tab, useHarness, withTake } from "./review-player-fixtures"

/**
 * The review inspector's player (A3-4, §2.3 of the inspectors design): the
 * take (Preview or Final) and Original audition, a kept word's click seeking
 * the take through its clock or the original (R3 a), Hear it (R6 a), Space,
 * follow playback, and the no-take and load-error states (M24).
 */
useHarness()

describe("no take, and a take that fails to load (M24)", () => {
  it("with no take, says so and offers Render final (and Update preview with the stop rule on)", () => {
    ;(window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__ = { previewStopRule: true }
    const renderFinal = vi.fn()
    useWorkflowStore.setState({ renderFinal })
    mountInspector()
    expect(within(player()).getByText("No preview yet.")).toBeTruthy()
    expect(media("take")).toBeNull()
    expect(within(player()).getByRole("button", { name: /^Update preview/ })).toBeTruthy()
    fireEvent.click(within(player()).getByRole("button", { name: /^Render final/ }))
    expect(renderFinal).toHaveBeenCalledWith("cut", "final")
  })

  it("with the stop rule off, offers Render final only", () => {
    mountInspector()
    expect(within(player()).queryByRole("button", { name: /^Update preview/ })).toBeNull()
    expect(within(player()).getByRole("button", { name: /^Render final/ })).toBeTruthy()
  })

  it("a take whose file errors says it can't be loaded, and Original stays available", () => {
    withTake({ url: "https://cdn.test/expired.mp4", quality: "proxy" })
    mountInspector()
    const el = media("take")!
    expect(el.getAttribute("src")).toBe("https://cdn.test/expired.mp4")
    expect(el.getAttribute("preload")).toBe("metadata")
    fireEvent.error(el)
    expect(within(player()).getByText("This take can't be loaded. It may have expired or been deleted.")).toBeTruthy()
    expect(within(player()).getByRole("button", { name: /^Render final/ })).toBeTruthy()
    fireEvent.click(tab(/^Original$/))
    expect(media("original")?.getAttribute("src")).toBe("https://cdn.test/cam.mp4")
  })

  it("labels a take on display Final when it is one", () => {
    withTake({ url: "https://cdn.test/final.mp4", quality: "final" })
    mountInspector()
    expect(tab(/^Final$/).getAttribute("aria-checked")).toBe("true")
  })
})

describe("a click on a kept word seeks the player (R3)", () => {
  it("on a fresh Preview, seeks the take through its clock and stays on it", () => {
    withTake(freshTake())
    mountInspector()
    const el = media("take")!
    loaded(el)
    // "is" (5.1 s on the master clock) plays 4.1 s into the cut: 0–4 s, then 5–9 s.
    wordGestures(h.page).click(4)
    expect(el.currentTime).toBeCloseTo(4.1)
    expect(tab(/^Preview$/).getAttribute("aria-checked")).toBe("true")
    expect(media("original")).toBeNull()
  })

  it("beside a Final on display, offers the newest Preview, which seeks through its own clock", () => {
    loadCanvas({ cut: { generatedResults: [{ url: "https://cdn.test/final.mp4", quality: "final" }, freshTake()], activeResultIndex: 0 } })
    mountInspector()
    expect(tab(/^Final$/).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(tab(/^Preview$/))
    const preview = player().querySelector<HTMLMediaElement>('[data-testid="review-preview-media"]')!
    expect(preview.getAttribute("src")).toBe("https://cdn.test/preview.mp4")
    loaded(preview)
    wordGestures(h.page).click(4)
    expect(preview.currentTime).toBeCloseTo(4.1)
    // The Final carries no stamp: on it, the same click plays the original.
    fireEvent.click(tab(/^Final$/))
    wordGestures(h.page).click(4)
    expect(tab(/^Original$/).getAttribute("aria-checked")).toBe("true")
  })

  it("on a take that predates the edits, switches to Original at that word (R3 a)", () => {
    withTake({ url: "https://cdn.test/old.mp4", quality: "proxy" })
    mountInspector()
    wordGestures(h.page).click(1)
    expect(tab(/^Original$/).getAttribute("aria-checked")).toBe("true")
    const original = media("original")!
    expect(original.getAttribute("src")).toBe("https://cdn.test/cam.mp4")
    expect(original.getAttribute("preload")).toBe("metadata")
    // The seek waits for the file's metadata, then lands at the word's start.
    loaded(original)
    expect(original.currentTime).toBeCloseTo(0.5)
  })

  it("with no take at all, plays the original at that word", () => {
    mountInspector()
    wordGestures(h.page).click(2)
    loaded(media("original")!)
    expect(media("original")!.currentTime).toBeCloseTo(0.9)
  })

  it("a click on a struck word still opens its span, and seeks nothing", () => {
    withTake(freshTake())
    mountInspector()
    wordGestures(h.page).click(3)
    expect(screen.getByTestId("span-popover")).toBeTruthy()
    expect(media("original")).toBeNull()
  })
})

describe("Hear it: the span ± 1.5 s from the original (R6 a)", () => {
  it("plays from 1.5 s before the span and stops 1.5 s after it", () => {
    withTake(freshTake())
    mountInspector()
    wordGestures(h.page).click(3)
    fireEvent.click(within(screen.getByTestId("span-popover")).getByRole("button", { name: /Hear it/ }))
    expect(tab(/^Original$/).getAttribute("aria-checked")).toBe("true")
    const original = media("original")!
    loaded(original)
    // The filler is 4–5 s.
    expect(original.currentTime).toBeCloseTo(2.5)
    expect(h.played).toContain(original)
    at(original, 6.4)
    expect(h.paused).not.toContain(original)
    at(original, 6.5)
    expect(h.paused).toContain(original)
  })

  it("stays offered while edits are locked: playback is never locked (R9 a)", () => {
    loadCanvas({ readOnly: true })
    mountInspector()
    wordGestures(h.page).click(3)
    expect(within(screen.getByTestId("span-popover")).getByRole("button", { name: /Hear it/ })).toBeTruthy()
  })

  it("shows the original loading while it seeks", () => {
    mountInspector()
    wordGestures(h.page).click(3)
    fireEvent.click(within(screen.getByTestId("span-popover")).getByRole("button", { name: /Hear it/ }))
    const original = media("original")!
    fireEvent.loadStart(original)
    expect(within(player()).getByText("Loading original…")).toBeTruthy()
    loaded(original)
    fireEvent.canPlay(original)
    expect(within(player()).queryByText("Loading original…")).toBeNull()
  })
})

describe("multicam: the original of the camera the time takes (R6 a)", () => {
  const MULTI = {
    ...PLAN,
    sources: [
      { id: "cam-1", url: "https://cdn.test/cam1.mp4", kind: "video" },
      { id: "cam-2", url: "https://cdn.test/cam2.mp4", kind: "video" },
      { id: "mix", url: "https://cdn.test/mix.wav", kind: "audio", role: "master-audio" },
    ],
    segments: [
      { id: "s0", inMs: 0, outMs: 4000, video: "cam-1" },
      { id: "s1", inMs: 5000, outMs: 9000, video: "cam-2" },
    ],
  }

  it("names the camera and says its sound is the camera's, not the render's", () => {
    loadCanvas({ plan: MULTI })
    mountInspector()
    wordGestures(h.page).click(4)
    expect(media("original")!.getAttribute("src")).toBe("https://cdn.test/cam2.mp4")
    expect(within(player()).getByText("cam-2")).toBeTruthy()
    expect(within(player()).getByText("camera audio")).toBeTruthy()
  })

  it("a seek into another camera's file waits for that file, not the one playing", () => {
    loadCanvas({ plan: MULTI })
    mountInspector()
    wordGestures(h.page).click(4)
    const original = media("original")!
    loaded(original)
    expect(original.currentTime).toBeCloseTo(5.1)
    // The filler (4–5 s) takes the look before it: camera 1.
    wordGestures(h.page).click(3)
    fireEvent.click(within(screen.getByTestId("span-popover")).getByRole("button", { name: /Hear it/ }))
    // The seek was not made on the file that was playing.
    expect(original.currentTime).toBeCloseTo(5.1)
    expect(h.played).not.toContain(original)
    const next = media("original")!
    expect(next.getAttribute("src")).toBe("https://cdn.test/cam1.mp4")
    expect(h.played).not.toContain(next)
    loaded(next)
    expect(next.currentTime).toBeCloseTo(2.5)
    expect(h.played).toContain(next)
  })
})

describe("Space and the transport", () => {
  it("Space plays and pauses the player on show", () => {
    withTake(freshTake())
    mountInspector()
    const el = media("take")!
    act(() => dialog().focus())
    key(" ")
    expect(h.played).toContain(el)
    expect(within(player()).getByRole("button", { name: "Pause" })).toBeTruthy()
    key(" ")
    expect(h.paused).toContain(el)
    expect(within(player()).getByRole("button", { name: "Play" })).toBeTruthy()
  })

  it("Space typed in the find box is a space, not play", () => {
    withTake(freshTake())
    mountInspector()
    key("f", { metaKey: true })
    const box = screen.getByPlaceholderText("Find in transcript…")
    fireEvent.keyDown(box, { key: " " })
    expect(h.played).toEqual([])
  })
})

describe("follow playback", () => {
  it("marks the word playing, and stops when turned off", async () => {
    mountInspector()
    wordGestures(h.page).click(0)
    const original = media("original")!
    loaded(original)
    at(original, 5.2)
    await waitFor(() => expect(wordEl(4)!.dataset.active).toBe("true"))
    expect(wordEl(0)!.dataset.active).toBeUndefined()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Follow playback" }))
    await waitFor(() => expect(wordEl(4)!.dataset.active).toBeUndefined())
  })

  it("follows a fresh take through its clock", async () => {
    withTake(freshTake())
    mountInspector()
    const el = media("take")!
    loaded(el)
    wordGestures(h.page).click(0)
    at(el, 4.2)
    await waitFor(() => expect(wordEl(4)!.dataset.active).toBe("true"))
  })
})

describe("the minimap", () => {
  // Sixty one-word paragraphs, one a second (the speaker changes on every word).
  const LONG = {
    version: 1,
    words: Array.from({ length: 60 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000 + 100, endMs: i * 1000 + 600, speaker: i % 2 ? "B" : "A" })),
  }
  const LONG_PLAN = { ...PLAN, segments: [{ id: "s0", inMs: 0, outMs: 60_000, video: "cam" }], dropped: [] }

  it("names the source's length and the rows on screen", () => {
    loadCanvas({ transcript: LONG, plan: LONG_PLAN })
    mountInspector()
    const strip = screen.getByTestId("review-minimap")
    expect(strip.getAttribute("aria-valuemax")).toBe("60000")
    expect(screen.getByTestId("minimap-window")).toBeTruthy()
    expect(strip.parentElement!.textContent).toContain("1:00")
  })

  it("a click scrolls the transcript to that time, and so does →", () => {
    loadCanvas({ transcript: LONG, plan: LONG_PLAN })
    mountInspector()
    const strip = screen.getByTestId("review-minimap")
    strip.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 14, right: 600, bottom: 14, x: 0, y: 0, toJSON: () => ({}) })
    expect(wordEl(30)).toBeNull()
    fireEvent.pointerDown(strip, { button: 0, clientX: 300 })
    fireEvent.pointerUp(strip)
    expect(wordEl(30)).not.toBeNull()
    const before = screen.getByTestId("review-transcript").scrollTop
    fireEvent.keyDown(strip, { key: "ArrowRight" })
    expect(screen.getByTestId("review-transcript").scrollTop).toBeGreaterThan(before)
  })

  it("shows the playhead once the player has a position", () => {
    loadCanvas({ transcript: LONG, plan: LONG_PLAN })
    mountInspector()
    expect(screen.queryByTestId("minimap-playhead")).toBeNull()
    wordGestures(h.page).click(1)
    loaded(media("original")!)
    at(media("original")!, 1.2)
    expect(screen.getByTestId("minimap-playhead").style.left).toBe("2%")
  })
})
