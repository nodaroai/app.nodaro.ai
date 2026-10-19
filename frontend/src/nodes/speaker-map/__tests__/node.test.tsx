// The Speaker Map node's face: its five pips, what it asks for when empty, and
// one line per speaker after a run — the camera by its place in the run's recordings.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

const store = vi.hoisted(() => ({ updateNodeData: vi.fn(), runSingleNode: vi.fn(), selectNode: vi.fn(), openFreeCut: vi.fn(), selectedNodeId: null, videoAutoplay: false }))

vi.mock("@xyflow/react", () => ({ Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" } }))
vi.mock("@/components/nodes/base-node", () => ({ BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div> }))
vi.mock("@/components/nodes/handle-with-popover", () => ({
  HandleWithPopover: ({ handleId, type, label }: any) => <div data-testid={`pip-${type}-${handleId}`}>{label}</div>,
}))
vi.mock("@/components/nodes/run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("@/components/nodes/editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("@/components/nodes/node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 10 }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: (selector: any) => selector(store) }))

import { NodeComponent as SpeakerMapNode } from "../node"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
const renderNode = (data: Record<string, unknown>) => render(<SpeakerMapNode {...({ id: "map", data: { label: "Speaker Map", fieldMappings: {}, ...data }, selected: false } as any)} />)
const RESULT = {
  version: 1,
  speakerMap: { A: "camB", B: "" },
  confidence: { A: { camera: "camB", marginDb: 7.5 }, B: { camera: "", marginDb: 1.2 } },
  notes: ['"camC": heard none of the speakers\' turns'],
  edl: { version: 1, clock: "master", sources: [{ id: "camA", url: "https://m/a.mp4", kind: "video" }, { id: "camB", url: "https://m/b.mp4", kind: "video" }, { id: "camC", url: "https://m/c.mp4", kind: "video" }], segments: [{ id: "whole", inMs: 0, outMs: 1000, video: "camA" }] },
}

afterEach(() => cleanup())

describe("SpeakerMapNode", () => {
  it("its pips: Cameras, Offsets and Transcript in; the map and the edit out", () => {
    renderNode({})
    for (const id of ["sources", "offsets", "transcript"]) expect(screen.getByTestId(`pip-target-${id}`)).toBeTruthy()
    expect(screen.getByTestId("pip-source-json").textContent).toBe(t("node.speakerMapResult"))
    expect(screen.getByTestId("pip-source-edl").textContent).toBe(t("node.speakerMapEdit"))
  })

  it("empty: asks for the cameras and a transcript", () => {
    renderNode({})
    expect(screen.getByText(t("node.speakerMapConnect"))).toBeTruthy()
  })

  it("after a run: one line per speaker in first-heard order, the camera by its place in the run's recordings; the notes counted", () => {
    renderNode({ executionStatus: "completed", generatedJson: RESULT })
    expect(screen.getByText("Speaker 1 → Camera 2")).toBeTruthy()
    expect(screen.getByText("Speaker 2 → no clear camera")).toBeTruthy()
    expect(screen.getByText(t("node.speakerMapNotes", { count: 1 }))).toBeTruthy()
  })

  it("a result that is not a Speaker Map result shows nothing of it", () => {
    renderNode({ executionStatus: "completed", generatedJson: { speakerMap: { A: 7 } } })
    expect(screen.getByText(t("node.speakerMapConnect"))).toBeTruthy()
  })
})
