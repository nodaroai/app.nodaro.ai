import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { dialog, key, loadCanvas, mountInspector, wordGestures } from "./review-test-canvas"
import { at, freshTake, h, loaded, media, player, tab, useHarness, withTake } from "./review-player-fixtures"

/**
 * The review player's state follows the element on show (A3-4 review round): a
 * seek held for metadata never starts a hidden element, ▶/⏸ is read from the
 * element so a remount mid-play cannot leave it stuck, and another render does
 * not inherit the last render's held seek.
 */
useHarness()

describe("the player's state stays with the element on show", () => {
  const setTake = (renderId: string, take: Record<string, unknown>) =>
    act(() => {
      useWorkflowStore.setState({
        nodes: useWorkflowStore.getState().nodes.map((n) => (n.id === renderId ? { ...n, data: { ...n.data, generatedResults: [take], activeResultIndex: 0 } } : n)) as never,
      })
    })

  it("a seek waiting for the original's metadata does not play it once another tab is on show", () => {
    withTake({ url: "https://cdn.test/old.mp4", quality: "proxy" })
    mountInspector()
    act(() => dialog().focus())
    key(" ")
    // The take predates the edits: a kept word plays the original, which is still loading.
    wordGestures(h.page).click(1)
    const original = media("original")!
    fireEvent.click(tab(/^Preview$/))
    loaded(original)
    expect(h.played).not.toContain(original)
    expect(within(player()).getByRole("button", { name: "Play" })).toBeTruthy()
  })

  it("a seek waiting for the take's metadata does not play it once the Original is on show", () => {
    withTake(freshTake())
    mountInspector()
    const take = media("take")!
    act(() => dialog().focus())
    key(" ")
    wordGestures(h.page).click(4)
    fireEvent.click(tab(/^Original$/))
    h.played = []
    loaded(take)
    expect(take.currentTime).toBeCloseTo(4.1)
    expect(h.played).not.toContain(take)
  })

  it("a new take arriving mid-play shows Play, and Space plays the new take", () => {
    withTake(freshTake())
    mountInspector()
    act(() => dialog().focus())
    key(" ")
    expect(within(player()).getByRole("button", { name: "Pause" })).toBeTruthy()
    // Update preview lands: the take's element is a new one, and it is paused.
    setTake("cut", { ...freshTake(), url: "https://cdn.test/preview-2.mp4" })
    const next = media("take")!
    expect(next.getAttribute("src")).toBe("https://cdn.test/preview-2.mp4")
    expect(within(player()).getByRole("button", { name: "Play" })).toBeTruthy()
    key(" ")
    expect(h.played).toContain(next)
  })

  it("a seek held for the take does not carry over to a new take file", () => {
    withTake(freshTake())
    mountInspector()
    act(() => dialog().focus())
    key(" ")
    // The take is still loading: the click is held at 4.1 s, to play.
    wordGestures(h.page).click(4)
    setTake("cut", { ...freshTake(), url: "https://cdn.test/preview-2.mp4" })
    const next = media("take")!
    expect(next.getAttribute("src")).toBe("https://cdn.test/preview-2.mp4")
    h.played = []
    loaded(next)
    expect(next.currentTime).toBe(0)
    expect(h.played).not.toContain(next)
  })

  it("a Play selection stop does not carry over to a new take file", () => {
    withTake(freshTake())
    mountInspector()
    const take = media("take")!
    loaded(take)
    wordGestures(h.page).drag(2, 4)
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Selection" })).getByRole("button", { name: "Play selection" }))
    take.pause()
    // Update preview lands while the selection is half played.
    setTake("cut", { ...freshTake(), url: "https://cdn.test/preview-2.mp4" })
    const next = media("take")!
    loaded(next)
    act(() => dialog().focus())
    key(" ")
    expect(h.played).toContain(next)
    h.paused = []
    at(next, 4.5)
    expect(h.paused).not.toContain(next)
  })

  it("the Original keeps its place when the player remounts (JSON view and back)", () => {
    mountInspector()
    wordGestures(h.page).click(4)
    loaded(media("original")!)
    at(media("original")!, 7.3)
    fireEvent.click(within(dialog()).getByRole("button", { name: "JSON" }))
    expect(screen.queryByTestId("review-player")).toBeNull()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cut" }))
    const again = media("original")!
    loaded(again)
    expect(again.currentTime).toBeCloseTo(7.3)
    expect(within(player()).getByRole("button", { name: "Play" })).toBeTruthy()
  })

  it("another render does not inherit the last render's waiting seek", async () => {
    loadCanvas({ extraRender: true, cut: { generatedResults: [freshTake()], activeResultIndex: 0 } })
    setTake("cut2", { url: "https://cdn.test/master.mp4", quality: "proxy" })
    mountInspector()
    // The take has no metadata yet: the seek waits.
    wordGestures(h.page).click(4)
    fireEvent.pointerDown(within(dialog()).getByRole("button", { name: "Choose the render to review" }), { button: 0 })
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /^Audio Master/ }))
    const other = media("take")!
    expect(other.getAttribute("src")).toBe("https://cdn.test/master.mp4")
    loaded(other)
    expect(other.currentTime).toBe(0)
  })
})
