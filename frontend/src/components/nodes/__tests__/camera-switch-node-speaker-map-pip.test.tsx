// Camera Switch's Speaker map pip follows Speaker Map's availability for the
// viewer (lib/target-handle-availability.ts): withheld → neither the React Flow
// handle nor its popover pip is drawn; available → both, as before. A wire
// already on the pip keeps it drawn (a hidden pip under a live wire would be an
// edge the canvas cannot draw).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup, act } from "@testing-library/react"

const m = vi.hoisted(() => ({
  baseHandles: [] as string[],
  popoverHandles: [] as string[],
  edges: [] as Array<{ target: string; targetHandle?: string }>,
}))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  // React Flow's own store: the canvas's edges (the hook reads the wire there).
  useStore: (selector: (s: { edges: unknown[] }) => unknown) => selector({ edges: m.edges }),
  useUpdateNodeInternals: vi.fn(() => () => {}),
}))
vi.mock("../base-node", () => ({
  BaseNode: ({ handles, children }: any) => {
    m.baseHandles = (handles ?? []).filter((h: any) => h.type === "target").map((h: any) => h.id)
    return <div>{children}</div>
  },
}))
vi.mock("../handle-with-popover", () => ({
  HandleWithPopover: ({ handleId, type }: any) => {
    if (type === "target") m.popoverHandles.push(handleId)
    return null
  },
}))
vi.mock("../node-quick-strip", () => ({ NodeQuickStrip: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("@/components/ui/json-tree", () => ({ JsonTree: () => null }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 10 }))
vi.mock("@/hooks/use-workflow-store", () => ({
  // The workflow store holds no edges: the pip must follow the canvas's.
  useWorkflowStore: (selector: any) => selector({ updateNodeData: () => {}, nodes: [], edges: [] }),
}))

import { CameraSwitchNode } from "../camera-switch-node"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"

function renderNode() {
  m.baseHandles = []
  m.popoverHandles = []
  return render(<CameraSwitchNode {...({ id: "cs", data: { label: "Camera Switch" }, selected: false } as any)} />)
}

describe("Camera Switch draws its Speaker map pip only for a viewer offered Speaker Map", () => {
  beforeEach(() => {
    m.edges = []
    __resetSurfaceAvailabilityForTests(null)
  })
  afterEach(() => cleanup())

  it("before availability has landed: no handle and no popover pip (hidden until loaded)", () => {
    renderNode()
    expect(m.baseHandles).toEqual(["edl", "transcript"])
    expect(m.popoverHandles).toEqual(["edl", "transcript"])
  })

  it("before availability has landed but already wired: the pip stays drawn under its wire", () => {
    m.edges = [{ target: "cs", targetHandle: "speakerMap" }]
    renderNode()
    expect(m.baseHandles).toContain("speakerMap")
    expect(m.popoverHandles).toContain("speakerMap")
  })

  it("withheld: no handle and no popover pip; the EDL and Transcript pips stay", () => {
    __resetSurfaceAvailabilityForTests({ nodes: ["speaker-map"], models: [] })
    renderNode()
    expect(m.baseHandles).toEqual(["edl", "transcript"])
    expect(m.popoverHandles).toEqual(["edl", "transcript"])
  })

  it("available: the pip is drawn as before", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [] })
    renderNode()
    expect(m.baseHandles).toEqual(["edl", "transcript", "speakerMap"])
    expect(m.popoverHandles).toEqual(["edl", "transcript", "speakerMap"])
  })

  it("withheld but already wired: the pip stays drawn under its wire", () => {
    __resetSurfaceAvailabilityForTests({ nodes: ["speaker-map"], models: [] })
    m.edges = [{ target: "cs", targetHandle: "speakerMap" }]
    renderNode()
    expect(m.baseHandles).toContain("speakerMap")
    expect(m.popoverHandles).toContain("speakerMap")
  })

  it("the pip appears when the viewer's availability lands after first paint", () => {
    renderNode()
    expect(m.baseHandles).not.toContain("speakerMap")
    m.popoverHandles = []
    act(() => __resetSurfaceAvailabilityForTests({ nodes: [], models: [] }))
    expect(m.baseHandles).toContain("speakerMap")
    expect(m.popoverHandles).toContain("speakerMap")
  })
})
