// The render node's way into the review (A3-5, R17 a, R18 a): "Review cut" for
// any render with an Edit Plan cut behind it — whatever its take, or none — and
// nothing where the review cannot open (no plan, a clip set, no inspector host).
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useReviewOpenStore } from "@/hooks/use-review-open-store"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { loadCanvas } from "@/components/edl-review/__tests__/review-canvas"
import { ReviewCutButton } from "../review-cut-button"

beforeEach(() => {
  useReviewOpenStore.setState({ hostMounted: true, renderId: null })
  loadCanvas()
})
afterEach(() => {
  cleanup()
  useReviewOpenStore.setState({ hostMounted: false, renderId: null })
})

describe("ReviewCutButton", () => {
  it("opens the review of its render", () => {
    render(<ReviewCutButton renderId="cut" />)
    fireEvent.click(screen.getByRole("button", { name: "Review cut" }))
    expect(useReviewOpenStore.getState().renderId).toBe("cut")
  })

  it.each([
    ["no take yet", {}],
    ["a Final on show", { generatedResults: [{ url: "f.mp4", quality: "final" }], generatedVideoUrl: "f.mp4" }],
    ["a Preview on show", { generatedResults: [{ url: "p.mp4", quality: "proxy" }], generatedVideoUrl: "p.mp4" }],
    ["a render set to Final, with the stop rule off", { quality: "final" }],
  ])("is there with %s", (_label, cut) => {
    loadCanvas({ cut })
    render(<ReviewCutButton renderId="cut" />)
    expect(screen.getByRole("button", { name: "Review cut" })).toBeTruthy()
  })

  it("is not there with no Edit Plan behind the render", () => {
    loadCanvas({ wired: { plan: false } })
    render(<ReviewCutButton renderId="cut" />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("reads Review clips for a clip set, and opens the same review store entry (A4-2)", () => {
    loadCanvas({ plan: [{ version: 1, clock: "master", sources: [], segments: [], dropped: [] }] })
    render(<ReviewCutButton renderId="cut" />)
    expect(screen.queryByRole("button", { name: "Review cut" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Review clips" }))
    expect(useReviewOpenStore.getState().renderId).toBe("cut")
  })

  it("is not there for a chapter list, which has nothing to review", () => {
    loadCanvas({ plan: { version: 1, chapters: [] } })
    render(<ReviewCutButton renderId="cut" />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("is not there where no inspector is mounted to show the review", () => {
    useReviewOpenStore.setState({ hostMounted: false })
    render(<ReviewCutButton renderId="cut" />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("appears when the plan lands", () => {
    useWorkflowStore.setState({ nodes: useWorkflowStore.getState().nodes.map((n) => (n.id === "plan" ? { ...n, data: { ...n.data, generatedJson: undefined } } : n)) } as never)
    render(<ReviewCutButton renderId="cut" />)
    expect(screen.queryByRole("button")).toBeNull()
    act(() => loadCanvas())
    expect(screen.getByRole("button", { name: "Review cut" })).toBeTruthy()
  })
})
