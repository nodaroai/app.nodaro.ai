// The Edit Plan node's ways into the review (A3-5, R17 a, U1): Expand opens the
// review when the plan feeds a render whose cut can be reviewed (its JSON tree
// becomes the review's JSON tab), and keeps opening the JSON tree when there is
// nothing to review there; an EDITED chip shows while the person's review is
// applied.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react"
import { EDITED_EDL_VERSION, editPlanBasis } from "@nodaro/shared"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))
vi.mock("../base-node", () => ({ BaseNode: ({ children }: any) => <div>{children}</div> }))
vi.mock("../node-quick-strip", () => ({ NodeQuickStrip: () => null }))
vi.mock("../handle-with-popover", () => ({ HandleWithPopover: () => null, HANDLE_COLORS: { video: "#000", audio: "#000" } }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 0 }))
vi.mock("@/hooks/use-edit-plan-estimate-duration", () => ({ useEditPlanEstimateDurationSec: () => 60 }))
vi.mock("@/lib/edit-plan-modes", () => ({ editPlanPerMinuteReported: () => false, useEditPlanModes: () => 0 }))
vi.mock("@/components/inspector/edl-validity-badge", () => ({ EdlValidityBadge: () => null }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

import { EditPlanNode } from "../edit-plan-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useReviewOpenStore } from "@/hooks/use-review-open-store"

const PLAN = { version: 1, clock: "master", sources: [{ id: "cam", url: "c.mp4", kind: "video" }], segments: [{ id: "s0", inMs: 0, outMs: 4000, video: "cam" }, { id: "s1", inMs: 5000, outMs: 9000, video: "cam" }], dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }] }
const EDIT = {
  v: EDITED_EDL_VERSION,
  kind: "edl",
  basis: editPlanBasis(PLAN),
  edl: { segments: [{ id: "s0", inMs: 1000, outMs: 4000, video: "cam" }, PLAN.segments[1]], dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }, { inMs: 0, outMs: 1000, reason: "manual" }] },
}
const at = { x: 0, y: 0 }
const wire = (target: string) => ({ id: `p-${target}`, source: "p", sourceHandle: "edl", target, targetHandle: "edl" })

function canvas(planData: Record<string, unknown>, renders: string[] = ["r"]) {
  useWorkflowStore.setState({
    nodes: [
      { id: "p", type: "edit-plan", position: at, data: { label: "Plan", mode: "tighten", executionStatus: "completed", ...planData } },
      ...renders.map((id) => ({ id, type: "apply-edl", position: at, data: { label: id } })),
    ] as never,
    edges: renders.map(wire) as never,
  })
}
const mount = () => {
  const node = useWorkflowStore.getState().nodes[0]!
  return render(<EditPlanNode {...({ id: "p", data: node.data, selected: false } as any)} />)
}
const expand = () => fireEvent.click(screen.getByRole("button", { name: "Expand result" }))

beforeEach(() => useReviewOpenStore.setState({ hostMounted: true, renderId: null }))
afterEach(() => {
  cleanup()
  useReviewOpenStore.setState({ hostMounted: false, renderId: null })
})

describe("EditPlanNode — Expand", () => {
  it("opens the review at the render the plan feeds, not the JSON tree", () => {
    canvas({ generatedJson: PLAN })
    mount()
    expand()
    expect(useReviewOpenStore.getState().renderId).toBe("r")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("with several renders, opens at the first (the header's picker chooses among them)", () => {
    canvas({ generatedJson: PLAN }, ["a", "b"])
    mount()
    expand()
    expect(useReviewOpenStore.getState().renderId).toBe("a")
  })

  it("with no render consuming the plan, keeps opening its JSON", () => {
    canvas({ generatedJson: PLAN }, [])
    mount()
    expand()
    expect(useReviewOpenStore.getState().renderId).toBeNull()
    expect(within(screen.getByRole("dialog")).getByText(/segments/)).toBeTruthy()
  })

  it("a clip set opens the Clip Pack inspector at its render (A4-2)", () => {
    canvas({ mode: "clips", generatedJson: [PLAN, PLAN] })
    mount()
    expand()
    expect(useReviewOpenStore.getState().renderId).toBe("r")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("where no inspector is mounted, keeps opening its JSON", () => {
    useReviewOpenStore.setState({ hostMounted: false })
    canvas({ generatedJson: PLAN })
    mount()
    expand()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })
})

describe("EditPlanNode — the EDITED chip", () => {
  it("shows while the person's review is applied", () => {
    canvas({ generatedJson: PLAN, editedEdl: EDIT })
    mount()
    expect(screen.getByText("Edited")).toBeTruthy()
  })

  it.each([
    ["no review", {}],
    ["a review made on an earlier plan", { editedEdl: { ...EDIT, basis: "0000000000000000" } }],
  ])("is absent with %s", (_label, extra) => {
    canvas({ generatedJson: PLAN, ...extra })
    mount()
    expect(screen.queryByText("Edited")).toBeNull()
  })
})
