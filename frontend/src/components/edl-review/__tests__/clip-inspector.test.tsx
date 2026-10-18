import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))
vi.mock("@/components/editor/workflow-editor/newer-run-check", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  newerRunOnServer: vi.fn(async () => null),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { REVIEW_WRITE_IDLE_MS } from "@/lib/edl-review/write-review"
import { ReviewInspector } from "../review-inspector"
import { loadCanvas } from "./review-canvas"
import { CLIPS, clip, keyOf, loadClipCanvas, mountClipInspector, patchNode, planNodeData, take } from "./clip-canvas"

/**
 * The Clip Pack inspector (A4-2; §4 of the inspectors design, M17–M22): one
 * card per planned clip the render's wire sends, with Keep and an editable
 * hook; the takes on each card matched by clipKey; the filter and bulk
 * controls (R15 a). The footer and the runs are in clip-inspector.runs.test.
 */
beforeEach(() => loadClipCanvas())
afterEach(() => {
  vi.useRealTimers()
  cleanup()
  useWorkflowStore.setState({ renderFinal: null, renderCheck: null })
})

const dlg = () => screen.getByRole("dialog")
const card = (row: number) => screen.getByTestId(`clip-card-${row}`)
const cards = () => screen.queryAllByTestId(/^clip-card-/)
const keepOf = (row: number) => within(card(row)).getByRole("switch", { name: "Keep" })
const hookOf = (row: number) => within(card(row)).getByRole("textbox") as HTMLTextAreaElement
const stored = () => planNodeData().editedEdl as { kind: string; clips: Array<{ keep: boolean; hook?: string }> } | undefined

describe("the cards", () => {
  it("opens one card per planned clip: title, source span, duration, hook and Keep", () => {
    mountClipInspector()
    expect(cards()).toHaveLength(4)
    const first = card(0)
    expect(within(first).getByText("Clip 1")).toBeTruthy()
    expect(within(first).getByText("0:00 → 1:00 in source")).toBeTruthy()
    expect(within(first).getByText("1:00")).toBeTruthy()
    expect(hookOf(0).value).toBe("Hook 1")
    expect(keepOf(0).getAttribute("aria-checked")).toBe("true")
    expect(within(first).getByText("No preview yet")).toBeTruthy()
  })

  it("titles the dialog Review clips with the plan and render, and sums the clips in the header", () => {
    mountClipInspector()
    expect(within(dlg()).getByText("Review clips · Find Clips → Render Clip")).toBeTruthy()
    expect(screen.getByTestId("clip-summary").textContent).toBe("4 clips · 4 kept · 4:00")
  })

  it("says so when the plan holds no clip set", () => {
    loadClipCanvas({ plan: clip(0) })
    mountClipInspector()
    expect(screen.getByTestId("clip-no-plan")).toBeTruthy()
    expect(cards()).toHaveLength(0)
  })

  it("only the clips the render's wire picks get a card; the rest are counted, not shown (R12 a)", () => {
    loadClipCanvas({ wire: { rangeFrom: "2", rangeTo: "3" } })
    mountClipInspector()
    expect(cards().map((c) => c.dataset.testid)).toEqual(["clip-card-1", "clip-card-2"])
    expect(screen.getByTestId("clip-not-sent").textContent).toBe("2 clips not sent to this render by its wire's selection.")
  })
})

describe("Keep and the filter", () => {
  it("Keep off writes the review at once, marks the card Dropped and frees its hook", async () => {
    mountClipInspector()
    fireEvent.click(keepOf(1))
    expect(stored()).toMatchObject({ kind: "clips", clips: [{ keep: true }, { keep: false }, { keep: true }, { keep: true }] })
    await waitFor(() => expect(card(1).dataset.keep).toBe("false"))
    expect(within(card(1)).getByText("Dropped")).toBeTruthy()
    expect(hookOf(1).readOnly).toBe(true)
    expect(screen.getByTestId("clip-summary").textContent).toBe("4 clips · 3 kept · 3:00")
  })

  it("Keep on again clears the review: an un-edited plan holds no edit", async () => {
    mountClipInspector()
    fireEvent.click(keepOf(1))
    await waitFor(() => expect(card(1).dataset.keep).toBe("false"))
    fireEvent.click(keepOf(1))
    await waitFor(() => expect(card(1).dataset.keep).toBe("true"))
    expect(stored()).toBeUndefined()
  })

  it("Drop all and Keep all set every card the render sends, in one write each (R15 a)", async () => {
    mountClipInspector()
    fireEvent.click(screen.getByRole("button", { name: "Drop all" }))
    await waitFor(() => expect(cards().every((c) => c.dataset.keep === "false")).toBe(true))
    expect(stored()?.clips.every((c) => !c.keep)).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Keep all" }))
    await waitFor(() => expect(cards().every((c) => c.dataset.keep === "true")).toBe(true))
    expect(stored()).toBeUndefined()
  })

  it("Drop all leaves the clips the wire never sends as they were", async () => {
    loadClipCanvas({ wire: { rangeFrom: "2", rangeTo: "3" } })
    mountClipInspector()
    fireEvent.click(screen.getByRole("button", { name: "Drop all" }))
    await waitFor(() => expect(cards().every((c) => c.dataset.keep === "false")).toBe(true))
    expect(stored()?.clips.map((c) => c.keep)).toEqual([true, false, false, true])
  })

  it("the Show filter lists All, Kept or Dropped with their counts", async () => {
    loadClipCanvas({ planData: { editedEdl: { v: 1, kind: "clips", basis: "", clips: [] } } })
    mountClipInspector()
    fireEvent.click(keepOf(2))
    await waitFor(() => expect(card(2).dataset.keep).toBe("false"))
    const show = screen.getByRole("radiogroup", { name: "Show" })
    expect(within(show).getByRole("radio", { name: "All 4" })).toBeTruthy()
    fireEvent.click(within(show).getByRole("radio", { name: "Dropped 1" }))
    expect(cards().map((c) => c.dataset.testid)).toEqual(["clip-card-2"])
    fireEvent.click(within(show).getByRole("radio", { name: "Kept 3" }))
    expect(cards()).toHaveLength(3)
    fireEvent.click(within(show).getByRole("radio", { name: "All 4" }))
    expect(cards()).toHaveLength(4)
  })

  it("an empty filter says so", async () => {
    mountClipInspector()
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Show" })).getByRole("radio", { name: "Dropped 0" }))
    expect(screen.getByTestId("clip-empty").textContent).toBe("No clips in this view.")
  })
})

describe("the hook (text only, TA20 a)", () => {
  it("typing shows at once and is written once the typing pauses", () => {
    vi.useFakeTimers()
    mountClipInspector()
    fireEvent.change(hookOf(0), { target: { value: "Nobody tells you this" } })
    expect(hookOf(0).value).toBe("Nobody tells you this")
    expect(within(card(0)).getByText("Edited")).toBeTruthy()
    expect(stored()).toBeUndefined()
    act(() => vi.advanceTimersByTime(REVIEW_WRITE_IDLE_MS))
    expect(stored()?.clips[0]).toEqual({ keep: true, hook: "Nobody tells you this" })
  })

  it("Reset gives the plan's hook back and clears the review", async () => {
    mountClipInspector()
    fireEvent.change(hookOf(0), { target: { value: "mine" } })
    fireEvent.click(within(card(0)).getByRole("button", { name: "Reset" }))
    await waitFor(() => expect(hookOf(0).value).toBe("Hook 1"))
    expect(stored()).toBeUndefined()
    expect(within(card(0)).queryByText("Edited")).toBeNull()
  })

  it("an emptied hook is an explicit empty hook, and the plan's hook is shown beside Reset", () => {
    mountClipInspector()
    fireEvent.change(hookOf(2), { target: { value: "" } })
    expect(hookOf(2).value).toBe("")
    expect(within(card(2)).getByText("Plan: “Hook 3”")).toBeTruthy()
  })

  it("the title is read-only", () => {
    mountClipInspector()
    expect(within(card(0)).queryByDisplayValue("Clip 1")).toBeNull()
  })
})

describe("the takes on each card, matched by clipKey", () => {
  it("shows a Preview, a Final and a dropped clip's final; a stale preview says it predates the plan", () => {
    const replanned = CLIPS.map((c, i) => (i === 1 ? { ...c, segments: [...c.segments, { id: "extra", inMs: 150_000, outMs: 155_000, video: "cam" }] } : c))
    loadClipCanvas({ plan: replanned })
    patchNode("cut", {
      generatedResults: [
        take(0, "proxy", {}, replanned),
        take(1, "proxy", { planBasis: "0000000000000001" }, replanned),
        take(2, "final", {}, replanned),
        take(3, "final", {}, replanned),
        take(3, "proxy", {}, replanned),
      ],
    })
    patchNode("plan", { editedEdl: undefined })
    mountClipInspector()
    expect(card(0).dataset.state).toBe("preview")
    expect(card(1).dataset.state).toBe("preview-stale")
    expect(within(card(1)).getByText("Preview predates this plan")).toBeTruthy()
    expect(card(2).dataset.state).toBe("final-ready")
    expect(within(card(2)).getAllByText("Final").length).toBeGreaterThan(0)
  })

  it("a Final of a dropped clip reads not in this set", async () => {
    patchNode("cut", { generatedResults: [take(2, "final")] })
    mountClipInspector()
    fireEvent.click(keepOf(2))
    await waitFor(() => expect(card(2).dataset.state).toBe("final-not-in-set"))
    expect(within(card(2)).getByText("Final (not in this set)")).toBeTruthy()
  })

  it("lists finals of clips the plan no longer has under From earlier plans, collapsed", () => {
    const gone = { ...take(0, "final"), clipKey: "999-1000", jobId: "gone", url: "https://cdn.test/gone.mp4" }
    patchNode("cut", { generatedResults: [gone] })
    mountClipInspector()
    const orphans = screen.getByTestId("clip-orphans")
    expect(within(orphans).queryByText("Final of an earlier clip")).toBeNull()
    fireEvent.click(within(orphans).getByRole("button", { name: /From earlier plans \(1\)/ }))
    expect(within(orphans).getByText("Final of an earlier clip")).toBeTruthy()
  })

  it("a failed sent row reads Preview failed, naming that it still renders at Render final", () => {
    patchNode("cut", {
      __listResults: [take(0, "proxy").url, ""],
      generatedResults: [take(0, "proxy")],
      __listResultStamps: [{ quality: "proxy", clipKey: keyOf(0) }, { clipKey: keyOf(1) }],
    })
    mountClipInspector()
    expect(card(1).dataset.state).toBe("preview-failed")
    expect(within(card(1)).getByText(/Preview failed\. It still renders at Render final\./)).toBeTruthy()
    expect(card(2).dataset.state).toBe("no-preview")
  })

  it("an audio render's preview is an audio tile, with no picture", () => {
    patchNode("cut", { output: "audio" })
    // The settings basis follows the render's output: stamp the take after the switch.
    patchNode("cut", { generatedResults: [take(0, "proxy")] })
    mountClipInspector()
    expect(card(0).dataset.state).toBe("audio-only")
    expect(within(card(0)).getByRole("button", { name: "Play clip 1" })).toBeTruthy()
    expect(card(0).querySelector("img")).toBeNull()
    expect(card(0).querySelector("video")).toBeNull()
  })
})

describe("one clip plays at a time", () => {
  it("mounts a video only for the card whose play button was pressed", () => {
    patchNode("cut", { generatedResults: [take(0, "proxy"), take(1, "proxy")] })
    mountClipInspector()
    expect(document.querySelectorAll("video")).toHaveLength(0)
    fireEvent.click(within(card(0)).getByRole("button", { name: "Play clip 1" }))
    expect(document.querySelectorAll("video")).toHaveLength(1)
    expect(card(0).querySelector("video")?.getAttribute("preload")).toBe("none")
    fireEvent.click(within(card(1)).getByRole("button", { name: "Play clip 2" }))
    expect(document.querySelectorAll("video")).toHaveLength(1)
    expect(card(1).querySelector("video")).not.toBeNull()
    expect(card(0).querySelector("video")).toBeNull()
  })
})

describe("one audio clip plays at a time", () => {
  const audioCards = () => {
    patchNode("cut", { output: "audio" })
    patchNode("cut", { generatedResults: [take(0, "proxy"), take(1, "proxy")] })
    mountClipInspector()
  }

  it("mounts no audio player until a card's play button is pressed", () => {
    audioCards()
    expect(document.querySelectorAll("audio")).toHaveLength(0)
  })

  it("mounts an audio player only for the card pressed; starting another unmounts the first", () => {
    audioCards()
    fireEvent.click(within(card(0)).getByRole("button", { name: "Play clip 1" }))
    expect(document.querySelectorAll("audio")).toHaveLength(1)
    expect(card(0).querySelector("audio")?.getAttribute("preload")).toBe("none")
    fireEvent.click(within(card(1)).getByRole("button", { name: "Play clip 2" }))
    expect(document.querySelectorAll("audio")).toHaveLength(1)
    expect(card(1).querySelector("audio")).not.toBeNull()
    expect(card(0).querySelector("audio")).toBeNull()
  })
})

describe("the JSON tab and closing", () => {
  it("the JSON switch shows the clips as edited and as planned", () => {
    mountClipInspector()
    fireEvent.click(screen.getByRole("button", { name: "JSON" }))
    expect(screen.getByTestId("review-json")).toBeTruthy()
    expect(cards()).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Clips" }))
    expect(cards()).toHaveLength(4)
  })

  it("closing writes the hook typed a moment ago first", () => {
    vi.useFakeTimers()
    const { onClose } = mountClipInspector()
    fireEvent.change(hookOf(0), { target: { value: "just typed" } })
    expect(stored()).toBeUndefined()
    fireEvent.keyDown(dlg(), { key: "Escape" })
    expect(stored()?.clips[0]).toEqual({ keep: true, hook: "just typed" })
    expect(onClose).toHaveBeenCalled()
  })

  it("an edit made on an earlier plan is flagged, ignored, and can be discarded", () => {
    loadClipCanvas({ planData: { editedEdl: { v: 1, kind: "clips", basis: "0000000000000000", clips: CLIPS.map(() => ({ keep: false })) } } })
    mountClipInspector()
    expect(screen.getByTestId("banner-stale-edit")).toBeTruthy()
    expect(cards().every((c) => c.dataset.keep === "true")).toBe(true)
    fireEvent.click(within(screen.getByTestId("banner-stale-edit")).getByRole("button", { name: "Discard them" }))
    expect(planNodeData().editedEdl).toBeUndefined()
  })
})

describe("which inspector a render opens", () => {
  it("ReviewInspector opens the Clip Pack's for a clip set", () => {
    render(<ReviewInspector open renderId="cut" onClose={() => undefined} />)
    expect(within(dlg()).getByText("Review clips · Find Clips → Render Clip")).toBeTruthy()
  })

  it("and the cut review for a Tighten EDL (review-inspector.test.tsx holds its cases)", () => {
    loadCanvas()
    render(<ReviewInspector open renderId="cut" onClose={() => undefined} />)
    expect(within(dlg()).getByText("Review cut · Tighten Plan → Apply Cut")).toBeTruthy()
  })
})
