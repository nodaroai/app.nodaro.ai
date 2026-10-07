import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))
// applyNewerRun says whether it wrote (false on a read-only canvas).
// `answer`: when set, the listing answers only when it resolves (a hung listing never does).
const newer = vi.hoisted(() => ({
  patches: null as Record<string, unknown> | null,
  applied: vi.fn(() => true),
  answer: null as Promise<Record<string, unknown> | null> | null,
}))
vi.mock("@/components/editor/workflow-editor/newer-run-check", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  newerRunOnServer: vi.fn(async () => newer.answer ?? newer.patches),
  applyNewerRun: newer.applied,
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { dialog, key, layOut, loadCanvas, mountInspector, planData, wordEl, wordGestures } from "./review-test-canvas"
import { BEFORE_SOURCE, WORDS_ONLY } from "./review-panel-fixtures"

/**
 * The review inspector's footer (A3-3b, §2.3 and §2.5 of the inspectors
 * design): undo and redo, the lengths, Update preview and Render final, and
 * the gate that holds them. Render final re-runs every check itself; the
 * footer is a convenience, not the guard.
 */
let page: ReturnType<typeof layOut>
beforeEach(() => {
  resetUndoStacks()
  newer.patches = null
  newer.answer = null
  newer.applied.mockReset()
  newer.applied.mockReturnValue(true)
  page = layOut()
  loadCanvas()
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
  page.restore()
  delete (window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__
  useWorkflowStore.setState({ renderFinal: null, renderCheck: null })
})

const drag = (from: number, to: number) => wordGestures(page).drag(from, to)
const footer = () => screen.getByTestId("review-footer")
const button = (name: RegExp) => within(footer()).getByRole("button", { name }) as HTMLButtonElement
const previewOn = () => {
  ;(window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__ = { previewStopRule: true }
}
const setRenderData = (data: Record<string, unknown>) =>
  useWorkflowStore.setState({ nodes: useWorkflowStore.getState().nodes.map((n) => (n.id === "cut" ? { ...n, data: { ...n.data, ...data } } : n)) as never })

describe("the lengths", () => {
  it("shows the cut's length, the source's and the time removed", () => {
    mountInspector()
    expect(footer().textContent).toContain("Cut length 0:08 · source 0:09 · removed 0:01")
  })

  it("marks the cut's length as at most (≤) under a crossfade", () => {
    loadCanvas({ cut: { crossfadeMs: 200 } })
    mountInspector()
    expect(footer().textContent).toMatch(/Cut length ≤0:0\d · source 0:09/)
  })

  it("follows each cut, with ↶ and ↷ as undo and redo", async () => {
    mountInspector()
    expect(button(/^Undo$/).disabled).toBe(true)
    drag(0, 2)
    key("Delete")
    await waitFor(() => expect(footer().textContent).toContain("removed 0:02"))
    fireEvent.click(button(/^Undo$/))
    await waitFor(() => expect(footer().textContent).toContain("removed 0:01"))
    fireEvent.click(button(/^Redo$/))
    await waitFor(() => expect(footer().textContent).toContain("removed 0:02"))
  })
})

describe("Render final and Update preview", () => {
  it("writes the pending edit before Render final runs (a cut made just before the click is in the run)", async () => {
    let seen: unknown
    const renderFinal = vi.fn(() => {
      seen = planData().editedEdl
    })
    useWorkflowStore.setState({ renderFinal })
    mountInspector()
    drag(0, 1)
    key("Delete")
    await waitFor(() => expect(wordEl(1)!.dataset.state).toBe("cut"))
    expect(planData().editedEdl).toBeUndefined()
    await waitFor(() => expect(button(/^Render final/).disabled).toBe(false))
    fireEvent.click(button(/^Render final/))
    expect(renderFinal).toHaveBeenCalledWith("cut", "final")
    expect((seen as { edl: { dropped: Array<{ reason: string }> } }).edl.dropped).toContainEqual(expect.objectContaining({ reason: "manual" }))
  })

  it("offers Update preview only with the stop rule on, and writes the edit before it too", async () => {
    mountInspector()
    expect(within(footer()).queryByRole("button", { name: /Update preview/ })).toBeNull()
    cleanup()
    previewOn()
    let seen: unknown
    const renderFinal = vi.fn(() => {
      seen = planData().editedEdl
    })
    useWorkflowStore.setState({ renderFinal })
    mountInspector()
    drag(0, 1)
    key("Delete")
    await waitFor(() => expect(button(/^Update preview/).disabled).toBe(false))
    fireEvent.click(button(/^Update preview/))
    expect(renderFinal).toHaveBeenCalledWith("cut", "proxy")
    expect(seen).toBeDefined()
  })
})

// Decided 2026-10-07: while the click's own newer-run check is out (15 s at
// most, `handleRenderFinal`), the clicked button is busy: a spinner, disabled,
// aria-busy. The other run button is disabled too, without the spinner, and so
// are both for a check on any other render. The handler marks the check in the
// store (`renderCheck`).
describe("the run buttons while a newer-run check is out", () => {
  const busy = (b: HTMLButtonElement) => ({
    ariaBusy: b.getAttribute("aria-busy"),
    disabled: b.disabled,
    spinner: !!b.querySelector(".animate-spin"),
  })
  const IDLE = { ariaBusy: null, disabled: false, spinner: false }
  const BUSY = { ariaBusy: "true", disabled: true, spinner: true }
  const WAITING = { ariaBusy: null, disabled: true, spinner: false }

  it.each([
    ["final", /^Render final/, /^Update preview/],
    ["proxy", /^Update preview/, /^Render final/],
  ] as const)("%s: both buttons wait and only the clicked one spins, until the check settles", async (kind, clicked, other) => {
    previewOn()
    const renderFinal = vi.fn((renderId: string, k: "final" | "proxy") => {
      useWorkflowStore.getState().setRenderCheck({ renderId, kind: k })
    })
    useWorkflowStore.setState({ renderFinal })
    mountInspector()
    await waitFor(() => expect(button(clicked).disabled).toBe(false))
    expect(busy(button(clicked))).toEqual(IDLE)
    fireEvent.click(button(clicked))
    expect(renderFinal).toHaveBeenCalledWith("cut", kind)
    expect(busy(button(clicked))).toEqual(BUSY)
    expect(busy(button(other))).toEqual(WAITING)
    act(() => useWorkflowStore.getState().setRenderCheck(null))
    expect(busy(button(clicked))).toEqual(IDLE)
    expect(busy(button(other))).toEqual(IDLE)
  })

  // The editor holds one run click at a time (`handleRenderFinal`'s lock), so
  // a check on another render would swallow a click here: both buttons wait,
  // and neither spins, since the check is not theirs.
  it("waits, without the spinner, for a check on another render", async () => {
    previewOn()
    mountInspector()
    await waitFor(() => expect(button(/^Render final/).disabled).toBe(false))
    act(() => useWorkflowStore.getState().setRenderCheck({ renderId: "other", kind: "final" }))
    expect(busy(button(/^Render final/))).toEqual(WAITING)
    expect(busy(button(/^Update preview/))).toEqual(WAITING)
    act(() => useWorkflowStore.getState().setRenderCheck(null))
    expect(busy(button(/^Render final/))).toEqual(IDLE)
    expect(busy(button(/^Update preview/))).toEqual(IDLE)
  })
})

describe("the gate (§2.5)", () => {
  it("holds both runs when nothing is kept", async () => {
    previewOn()
    loadCanvas({ plan: WORDS_ONLY })
    mountInspector()
    drag(0, 2)
    key("Delete")
    await waitFor(() => expect(footer().textContent).toContain("Nothing is kept"))
    expect(button(/^Render final/).disabled).toBe(true)
    expect(button(/^Update preview/).disabled).toBe(true)
  })

  it("holds both runs while the render's rule refuses the cut, and lists the issues left-to-right", async () => {
    previewOn()
    loadCanvas(BEFORE_SOURCE)
    mountInspector()
    expect(footer().textContent).toContain("Fix 1 issue first")
    expect(button(/^Render final/).disabled).toBe(true)
    expect(button(/^Update preview/).disabled).toBe(true)
    fireEvent.click(within(footer()).getByRole("button", { name: /Fix 1 issue first/ }))
    const list = within(footer()).getByTestId("footer-issues")
    expect(list.getAttribute("dir")).toBe("ltr")
    expect(list.textContent).toContain("would read before the source starts")
  })

  it("holds both runs until a newer run's results are loaded (TA3 c)", async () => {
    newer.patches = { cut: { label: "Apply Cut" } }
    useWorkflowStore.setState({ workflowId: "wf-1" })
    mountInspector()
    await waitFor(() => expect(footer().textContent).toContain("Load the newer run first"))
    expect(button(/^Render final/).disabled).toBe(true)
    const banner = screen.getByTestId("banner-newer-run")
    expect(banner.textContent).toContain("A newer run finished while this was closed.")
    fireEvent.click(within(banner).getByRole("button", { name: "Load its results" }))
    expect(newer.applied).toHaveBeenCalledWith(newer.patches)
    await waitFor(() => expect(button(/^Render final/).disabled).toBe(false))
  })

  // Decided 2026-10-07: "Checking for a newer run" gives up after 15 s.
  it("lets both runs go with a warning when the newer-run check has not answered in 15 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    previewOn()
    newer.answer = new Promise(() => {})
    useWorkflowStore.setState({ workflowId: "wf-1" })
    mountInspector()
    await act(async () => {})
    expect(footer().textContent).toContain("Checking for a newer run…")
    expect(button(/^Render final/).disabled).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(14_999)
    })
    expect(button(/^Render final/).disabled).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(footer().textContent).not.toContain("Checking for a newer run…")
    expect(within(footer()).getByRole("status").textContent).toBe("Couldn't check for a newer run. You can still run this cut.")
    expect(button(/^Render final/).disabled).toBe(false)
    expect(button(/^Update preview/).disabled).toBe(false)
  })

  it("takes a newer run that answers after the timeout: the warning gives way to its hold", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    let answer: (patches: Record<string, unknown> | null) => void = () => {}
    newer.answer = new Promise((done) => {
      answer = done
    })
    useWorkflowStore.setState({ workflowId: "wf-1" })
    mountInspector()
    await act(async () => {
      vi.advanceTimersByTime(15_000)
    })
    expect(button(/^Render final/).disabled).toBe(false)
    await act(async () => {
      answer({ cut: { label: "Apply Cut" } })
    })
    expect(footer().textContent).toContain("Load the newer run first")
    expect(footer().textContent).not.toContain("Couldn't check for a newer run")
    expect(button(/^Render final/).disabled).toBe(true)
  })

  it("gives a render it returns to a fresh 15 s: an earlier visit's timeout does not carry over", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    newer.answer = new Promise(() => {})
    loadCanvas({ extraRender: true })
    useWorkflowStore.setState({ workflowId: "wf-1" })
    mountInspector()
    await act(async () => {
      vi.advanceTimersByTime(15_000)
    })
    expect(button(/^Render final/).disabled).toBe(false)
    const pick = async (name: string) => {
      fireEvent.pointerDown(within(dialog()).getByRole("button", { name: "Choose the render to review" }), { button: 0 })
      await act(async () => {})
      fireEvent.click(screen.getByRole("menuitemradio", { name }))
      await act(async () => {})
    }
    await pick("Audio Master (Audio)")
    await pick("Apply Cut (Video)")
    expect(screen.getByRole("dialog", { name: "Review cut · Tighten Plan → Apply Cut" })).toBeTruthy()
    expect(footer().textContent).toContain("Checking for a newer run…")
    expect(footer().textContent).not.toContain("Couldn't check for a newer run")
    expect(button(/^Render final/).disabled).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(14_999)
    })
    expect(button(/^Render final/).disabled).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(button(/^Render final/).disabled).toBe(false)
  })

  it("shows no warning when the check answers in time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    useWorkflowStore.setState({ workflowId: "wf-1" })
    mountInspector()
    await act(async () => {})
    await act(async () => {
      vi.advanceTimersByTime(20_000)
    })
    expect(footer().textContent).not.toContain("Couldn't check for a newer run")
    expect(button(/^Render final/).disabled).toBe(false)
  })

  it("offers no Load its results on a read-only canvas", async () => {
    newer.patches = { cut: { label: "Apply Cut" } }
    loadCanvas({ readOnly: true })
    useWorkflowStore.setState({ workflowId: "wf-1" })
    mountInspector()
    const banner = await screen.findByTestId("banner-newer-run")
    expect(within(banner).queryByRole("button", { name: "Load its results" })).toBeNull()
  })

  it("offers no Load its results while a run includes the render (R9 a)", async () => {
    newer.patches = { cut: { label: "Apply Cut" } }
    loadCanvas({ cut: { currentJobId: "job-1" } })
    useWorkflowStore.setState({ workflowId: "wf-1" })
    mountInspector()
    const banner = await screen.findByTestId("banner-newer-run")
    expect(within(banner).queryByRole("button", { name: "Load its results" })).toBeNull()
  })

  it("keeps the newer-run banner when loading wrote nothing", async () => {
    newer.patches = { cut: { label: "Apply Cut" } }
    newer.applied.mockReturnValue(false)
    useWorkflowStore.setState({ workflowId: "wf-1" })
    mountInspector()
    const banner = await screen.findByTestId("banner-newer-run")
    fireEvent.click(within(banner).getByRole("button", { name: "Load its results" }))
    expect(newer.applied).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("banner-newer-run")).toBeTruthy()
    expect(footer().textContent).toContain("Load the newer run first")
  })

  it("stacks the stale-preview banner above the newer-run banner (M2)", async () => {
    loadCanvas({ cut: { generatedResults: [{ url: "https://cdn.test/p.mp4", quality: "proxy" }] } })
    newer.patches = { cut: { label: "Apply Cut" } }
    useWorkflowStore.setState({ workflowId: "wf-1" })
    mountInspector()
    drag(0, 1)
    key("Delete")
    const stale = await screen.findByTestId("banner-stale-take")
    const newerRun = await screen.findByTestId("banner-newer-run")
    expect(stale.compareDocumentPosition(newerRun) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("locks edits while a run includes the render, and shows its progress (R9 a)", async () => {
    previewOn()
    // As the editor's handler does (markNodesStatus): the render is marked pending before the handler settles.
    const renderFinal = vi.fn(async () => setRenderData({ executionStatus: "pending" }))
    useWorkflowStore.setState({ renderFinal })
    mountInspector()
    await act(async () => {
      fireEvent.click(button(/^Render final/))
    })
    act(() => setRenderData({ currentJobId: "job-1", currentJobProgress: 34 }))
    expect(footer().textContent).toContain("Rendering final… 34%")
    expect(footer().textContent).toContain("edits locked")
    expect(within(footer()).queryByRole("button", { name: /Update preview/ })).toBeNull()
    expect(within(footer()).queryByRole("button", { name: /^Render final/ })).toBeNull()
    expect(button(/^Undo$/).disabled).toBe(true)
  })

  it("forgets a Render final that never began, so a later run is named neutrally", async () => {
    // The reviewer cancels the confirm (or the handler refuses): nothing is marked.
    const renderFinal = vi.fn(async () => {})
    useWorkflowStore.setState({ renderFinal })
    mountInspector()
    await act(async () => {
      fireEvent.click(button(/^Render final/))
    })
    expect(renderFinal).toHaveBeenCalledTimes(1)
    act(() => setRenderData({ currentJobId: "job-2", currentJobProgress: 20 }))
    expect(footer().textContent).toContain("A run is in progress…")
    expect(footer().textContent).not.toContain("Rendering final")
  })

  it("names a run it did not start without calling it a final", () => {
    loadCanvas({ cut: { currentJobId: "job-1" } })
    mountInspector()
    expect(footer().textContent).toContain("A run is in progress…")
    expect(footer().textContent).not.toContain("Rendering final")
  })

  it("runs nothing from a read-only canvas", () => {
    loadCanvas({ readOnly: true })
    mountInspector()
    expect(within(footer()).queryByRole("button", { name: /^Render final/ })).toBeNull()
    expect(footer().textContent).toContain("View only")
    expect(dialog()).toBeTruthy()
  })
})
