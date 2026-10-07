// The note under a Preview on a render's node face (A3-5, U1): the Edit Plan's
// review was changed after this Preview was cut.
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { EDITED_EDL_VERSION, editPlanBasis } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { PLAN, loadCanvas } from "@/components/edl-review/__tests__/review-canvas"
import { EditedSincePreviewNote } from "../edited-since-note"

const EDIT = {
  v: EDITED_EDL_VERSION,
  kind: "edl",
  basis: editPlanBasis(PLAN),
  edl: {
    segments: [
      { id: "s0", inMs: 1000, outMs: 4000, video: "cam" },
      { id: "s1", inMs: 5000, outMs: 9000, video: "cam" },
    ],
    dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }, { inMs: 0, outMs: 1000, reason: "manual" }],
  },
}
const withEdit = (editedEdl: unknown) =>
  useWorkflowStore.setState({
    nodes: useWorkflowStore.getState().nodes.map((n) => (n.id === "plan" ? { ...n, data: { ...n.data, editedEdl } } : n)),
  } as never)

afterEach(() => cleanup())

describe("EditedSincePreviewNote", () => {
  it("says the plan was edited since a Preview that has no stamps (unknown reads as stale once edited)", () => {
    loadCanvas({ cut: { generatedResults: [{ url: "p.mp4", quality: "proxy" }], activeResultIndex: 0 } })
    withEdit(EDIT)
    render(<EditedSincePreviewNote renderId="cut" />)
    expect(screen.getByText("Edited since this preview")).toBeTruthy()
  })

  it("says nothing for an unedited plan", () => {
    loadCanvas({ cut: { generatedResults: [{ url: "p.mp4", quality: "proxy" }], activeResultIndex: 0 } })
    render(<EditedSincePreviewNote renderId="cut" />)
    expect(screen.queryByText("Edited since this preview")).toBeNull()
  })

  it("appears when the review is edited, and goes when the edit is reset", () => {
    loadCanvas({ cut: { generatedResults: [{ url: "p.mp4", quality: "proxy" }], activeResultIndex: 0 } })
    render(<EditedSincePreviewNote renderId="cut" />)
    expect(screen.queryByText("Edited since this preview")).toBeNull()
    act(() => withEdit(EDIT))
    expect(screen.getByText("Edited since this preview")).toBeTruthy()
    act(() => withEdit(undefined))
    expect(screen.queryByText("Edited since this preview")).toBeNull()
  })
})
