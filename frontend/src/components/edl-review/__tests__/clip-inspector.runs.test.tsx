import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))
// `patches`: the newest ended run's changes, when the canvas does not show it.
const newer = vi.hoisted(() => ({ patches: null as Record<string, unknown> | null, applied: vi.fn(() => true) }))
vi.mock("@/components/editor/workflow-editor/newer-run-check", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  newerRunOnServer: vi.fn(async () => newer.patches),
  applyNewerRun: newer.applied,
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { CLIPS, loadClipCanvas, mountClipInspector, patchNode, planNodeData, take } from "./clip-canvas"

/**
 * The Clip Pack inspector's footer and runs (A4-2; §4.2, M17, M19, M22): the
 * hooks note (R20 a), what Render final runs and re-bills (TA15 a), the gate's
 * reasons, the edit lock while a run is live (R9 a) and the flush before Render
 * final, so a hook typed just before the click is in the run's plan value.
 */
beforeEach(() => {
  newer.patches = null
  newer.applied.mockReset()
  newer.applied.mockReturnValue(true)
  loadClipCanvas()
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
  useWorkflowStore.setState({ renderFinal: null, renderCheck: null })
})

const footer = () => screen.getByTestId("clip-footer")
const finalButton = () => within(footer()).getByRole("button", { name: /^Render final/ }) as HTMLButtonElement
const card = (row: number) => screen.getByTestId(`clip-card-${row}`)
const keepOf = (row: number) => within(card(row)).getByRole("switch", { name: "Keep" })
const hookOf = (row: number) => within(card(row)).getByRole("textbox") as HTMLTextAreaElement
/** The gate has judged: the buttons are not held. */
const ready = () => waitFor(() => expect(finalButton().disabled).toBe(false))

describe("the footer", () => {
  it("says hooks are text only and that readers pick them up when they next run (R20 a)", () => {
    mountClipInspector()
    expect(footer().textContent).toContain(
      "Hooks are text only: editing one does not re-render the clip. Nodes that read the hook pick it up when they next run.",
    )
  })

  it("names what Render final runs: the render and what follows it, once per kept clip", () => {
    mountClipInspector()
    expect(screen.getByTestId("clip-chain").textContent).toBe("Render final: Render Clip ×4 → Caption Clip ×4.")
  })

  it("counts a dropped clip out of the chain and of the button", async () => {
    mountClipInspector()
    fireEvent.click(keepOf(1))
    await waitFor(() => expect(screen.getByTestId("clip-chain").textContent).toContain("Render Clip ×3 → Caption Clip ×3"))
    expect(finalButton().textContent).toContain("Render final · 3 clips")
  })

  it("names the unchanged clips, which still re-render and are billed again (TA15 a)", () => {
    patchNode("cut", { generatedResults: [take(0, "final"), take(1, "final"), take(2, "final", { planBasis: "0000000000000001" })] })
    mountClipInspector()
    expect(screen.getByTestId("clip-chain").textContent).toBe(
      "Render final: Render Clip ×4 → Caption Clip ×4. 2 of 4 unchanged; all 4 re-render and are billed again.",
    )
  })

  it("says nothing of re-billing when no final exists yet", () => {
    mountClipInspector()
    expect(screen.getByTestId("clip-chain").textContent).not.toContain("billed again")
  })

  it("an edited hook leaves a final unchanged: renderers never read meta (R2 a)", async () => {
    patchNode("cut", { generatedResults: [take(0, "final")] })
    mountClipInspector()
    fireEvent.change(hookOf(0), { target: { value: "rewritten" } })
    expect(screen.getByTestId("clip-chain").textContent).toContain("1 of 4 unchanged")
  })

  it("offers Close and Render final, and no Update preview (the design's footer names Render final only)", () => {
    mountClipInspector()
    expect(within(footer()).getByRole("button", { name: "Close" })).toBeTruthy()
    expect(within(footer()).getByRole("button", { name: /^Render final · 4 clips/ })).toBeTruthy()
    expect(within(footer()).queryByRole("button", { name: /Update preview/ })).toBeNull()
  })

  it("Close closes the inspector", () => {
    const { onClose } = mountClipInspector()
    fireEvent.click(within(footer()).getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe("the gate", () => {
  it("lets Render final go once the rule has judged the clips and no newer run waits", async () => {
    mountClipInspector()
    await ready()
  })

  it("holds it with Nothing is kept when every clip is dropped, and the chain goes (M22)", async () => {
    mountClipInspector()
    fireEvent.click(screen.getByRole("button", { name: "Drop all" }))
    await waitFor(() => expect(footer().textContent).toContain("Nothing is kept"))
    expect(finalButton().disabled).toBe(true)
    expect(screen.queryByTestId("clip-chain")).toBeNull()
  })

  it("holds it when the render's rule refuses a clip, listing the issues on request", async () => {
    const broken = CLIPS.map((c, i) => (i === 2 ? { ...c, sources: [] } : c))
    loadClipCanvas({ plan: broken })
    mountClipInspector()
    await waitFor(() => expect(footer().textContent).toMatch(/Fix \d+ issues? first/))
    expect(finalButton().disabled).toBe(true)
    fireEvent.click(within(footer()).getByRole("button", { name: /Fix \d+ issues? first/ }))
    expect(screen.getByTestId("footer-issues")).toBeTruthy()
  })

  it("holds it for a newer run, with a banner that loads it", async () => {
    newer.patches = { plan: { generatedJson: CLIPS } }
    useWorkflowStore.setState({ workflowId: "wf-1" })
    mountClipInspector()
    await waitFor(() => expect(footer().textContent).toContain("Load the newer run first"))
    expect(finalButton().disabled).toBe(true)
    fireEvent.click(within(screen.getByTestId("banner-newer-run")).getByRole("button", { name: "Load its results" }))
    expect(newer.applied).toHaveBeenCalled()
  })
})

describe("Render final", () => {
  it("writes a hook typed just before the click first, so the run reads it", async () => {
    let seen: unknown
    useWorkflowStore.setState({
      renderFinal: vi.fn(() => {
        seen = (planNodeData().editedEdl as { clips: unknown[] } | undefined)?.clips
      }),
    } as never)
    mountClipInspector()
    await ready()
    fireEvent.change(hookOf(0), { target: { value: "typed at the last moment" } })
    expect(planNodeData().editedEdl).toBeUndefined()
    fireEvent.click(finalButton())
    expect(useWorkflowStore.getState().renderFinal).toHaveBeenCalledWith("cut", "final")
    expect(seen).toEqual([{ keep: true, hook: "typed at the last moment" }, { keep: true }, { keep: true }, { keep: true }])
  })
})

describe("edits lock while a run includes the render (R9 a)", () => {
  it("makes hooks read-only and Keep inert, and says so in the footer", async () => {
    mountClipInspector()
    await ready()
    act(() => patchNode("cut", { executionStatus: "pending", __listRunning: true, __listTotal: 4, __listCompleted: 1 }))
    await waitFor(() => expect(footer().textContent).toContain("edits locked"))
    expect(hookOf(0).readOnly).toBe(true)
    expect((keepOf(0) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole("button", { name: "Keep all" }).hasAttribute("disabled")).toBe(true)
    fireEvent.change(hookOf(0), { target: { value: "ignored" } })
    expect(planNodeData().editedEdl).toBeUndefined()
  })

  it("shows each kept clip as rendering and the run's progress while the final runs", async () => {
    let started = false
    useWorkflowStore.setState({
      renderFinal: vi.fn(() => {
        started = true
        patchNode("cut", { executionStatus: "pending", __listRunning: true, __listTotal: 4, __listCompleted: 1, __listResults: [take(0, "final").url], generatedResults: [take(0, "final")] })
      }),
    } as never)
    mountClipInspector()
    await ready()
    fireEvent.click(finalButton())
    await waitFor(() => expect(started).toBe(true))
    await waitFor(() => expect(card(1).dataset.state).toBe("final-rendering"))
    expect(within(card(1)).getByText("Final 1/4…")).toBeTruthy()
    expect(card(0).dataset.state).toBe("final-ready")
    expect(footer().textContent).toContain("Rendering final… clip 2 of 4 · edits locked")
  })

  it("locks a read-only canvas too, with View only in the footer", async () => {
    loadClipCanvas({ readOnly: true })
    mountClipInspector()
    expect(hookOf(0).readOnly).toBe(true)
    expect(footer().textContent).toContain("View only")
  })
})
