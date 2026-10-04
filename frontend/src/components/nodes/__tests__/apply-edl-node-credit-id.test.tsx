// The Apply EDL pill and its Run button quote `rate × minutes`, where the rate
// is the row of the render's QUALITY: a proxy (preview) reads
// `apply-edl:proxy`, a final `apply-edl` (applyEdlCreditId), for a video and an
// audio output alike. It used to read the bare `apply-edl` row whatever the
// quality, quoting every preview at the final's price.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"

const m = vi.hoisted(() => ({
  rate: { "apply-edl": 10, "apply-edl:proxy": 2 } as Record<string, number>,
  pill: [] as number[],
  button: [] as number[],
  ids: [] as Array<string | undefined>,
}))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))
vi.mock("../base-node", () => ({
  BaseNode: ({ credits, topToolbarContent, children }: any) => {
    m.pill.push(credits)
    return <div>{topToolbarContent}{children}</div>
  },
}))
vi.mock("../run-node-button", () => ({
  RunNodeButton: ({ credits }: any) => {
    m.button.push(credits)
    return null
  },
}))
vi.mock("../handle-with-popover", () => ({ HandleWithPopover: () => null, HANDLE_COLORS: { video: "#000", audio: "#000" } }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({ updateNodeData: () => {}, runSingleNode: () => {} }),
}))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  useModelCredits: (id: string | undefined) => {
    m.ids.push(id)
    return id ? (m.rate[id] ?? 0) : 0
  },
}))
// 4 billed minutes.
vi.mock("@/hooks/use-apply-edl-estimate-minutes", () => ({ useApplyEdlEstimateMinutes: () => 4 }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: () => {} }),
}))

import { ApplyEdlNode } from "../apply-edl-node"

function renderNode(data: Record<string, unknown>) {
  m.pill = []
  m.button = []
  m.ids = []
  render(<ApplyEdlNode {...({ id: "node-1", data: { label: "Apply EDL", ...data }, selected: false } as any)} />)
}

describe("ApplyEdlNode prices the render on its quality's row", () => {
  afterEach(() => cleanup())

  it.each([
    { name: "a video proxy", data: { output: "video", quality: "proxy" }, id: "apply-edl:proxy", credits: 2 * 4 },
    { name: "an audio proxy", data: { output: "audio", quality: "proxy" }, id: "apply-edl:proxy", credits: 2 * 4 },
    { name: "a final", data: { quality: "final" }, id: "apply-edl", credits: 10 * 4 },
    { name: "no quality (the final)", data: {}, id: "apply-edl", credits: 10 * 4 },
  ])("$name → $id × minutes on the pill and the Run button", ({ data, id, credits }) => {
    renderNode(data)
    expect(new Set(m.ids)).toEqual(new Set([id]))
    expect(m.pill.at(-1)).toBe(credits)
    expect(m.button.at(-1)).toBe(credits)
  })
})
