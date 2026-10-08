/**
 * U7 (SV16 b): Camera Switch's layout-hints note says who draws the hints and
 * offers the swap on each render its edit goes to that would refuse them.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

const { store } = vi.hoisted(() => {
  const store = {
    nodes: [] as Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>,
    edges: [] as Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>,
  }
  return { store }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (select: (s: typeof store) => unknown) => select(store),
    { getState: () => store },
  ),
}))

import { RENDER_NODE_TYPE_IDS } from "@nodaro/shared"
import { CameraSwitchConfig, hintRefusingRenders } from "../camera-switch-config"
import { SPEAKER_VIEW_TYPE } from "@/lib/replace-render-node"
import type { CameraSwitchNodeData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

const AE = RENDER_NODE_TYPE_IDS.find((t) => t !== SPEAKER_VIEW_TYPE)!
const at = { x: 0, y: 0 }

function canvas(renders: Array<{ id: string; type: string; label?: string }>) {
  store.nodes = [
    { id: "cs", type: "camera-switch", position: at, data: { label: "Camera Switch" } },
    ...renders.map((r) => ({ id: r.id, type: r.type, position: at, data: { label: r.label ?? r.id } })),
  ]
  store.edges = renders.map((r) => ({ id: `e-${r.id}`, source: "cs", sourceHandle: "edl", target: r.id, targetHandle: "edl" }))
  return { nodes: store.nodes as unknown as WorkflowNode[], edges: store.edges as unknown as WorkflowEdge[] }
}

function panel(layoutHints: boolean, g: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) {
  render(
    <CameraSwitchConfig
      data={{ label: "Camera Switch", layoutHints, fieldMappings: {} } as unknown as CameraSwitchNodeData}
      onUpdate={() => {}}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={g.nodes}
      edges={g.edges}
      nodeId="cs"
    />,
  )
}

afterEach(() => cleanup())

describe("hintRefusingRenders", () => {
  it("the renders the edit goes to directly, Speaker View excepted", () => {
    const g = canvas([{ id: "a", type: AE }, { id: "s", type: SPEAKER_VIEW_TYPE }, { id: "x", type: "combine-videos" }])
    expect(hintRefusingRenders("cs", g.nodes, g.edges).map((n) => n.id)).toEqual(["a"])
    expect(hintRefusingRenders(undefined, g.nodes, g.edges)).toEqual([])
  })
})

describe("the layout-hints note (U7)", () => {
  it("says Speaker View draws the hints and Apply EDL refuses them", () => {
    panel(false, canvas([]))
    expect(document.body.textContent).toContain("Speaker View draws them; Apply EDL refuses them.")
    expect(document.body.textContent).not.toContain("until Speaker View")
  })

  it("hints on: 'Replace Apply EDL with Speaker View' on the render the edit goes to", () => {
    panel(true, canvas([{ id: "a", type: AE }]))
    const actions = screen.getAllByTestId("replace-render-node")
    expect(actions).toHaveLength(1)
    expect(actions[0]!.textContent).toContain("Replace Apply EDL with Speaker View")
  })

  it("several renders: one action each, named by its label", () => {
    panel(true, canvas([{ id: "a", type: AE, label: "Wide cut" }, { id: "b", type: AE, label: "Vertical cut" }]))
    const text = screen.getAllByTestId("replace-render-node").map((a) => a.textContent)
    expect(text[0]).toContain("Replace Wide cut with Speaker View")
    expect(text[1]).toContain("Replace Vertical cut with Speaker View")
  })

  it("hints off, or Speaker View already downstream: no action", () => {
    panel(false, canvas([{ id: "a", type: AE }]))
    expect(screen.queryByTestId("replace-render-node")).toBeNull()
    cleanup()
    panel(true, canvas([{ id: "s", type: SPEAKER_VIEW_TYPE }]))
    expect(screen.queryByTestId("replace-render-node")).toBeNull()
  })

  it("before Camera Switch has run: the swap is offered, and its confirm says the Sources wire goes and the cameras may need re-wiring (Round 2)", () => {
    canvas([{ id: "a", type: AE }])
    store.nodes.push({ id: "up", type: "upload-video", position: at, data: { label: "Cam A" } })
    store.edges.push({ id: "e-src", source: "up", target: "a", targetHandle: "sources" })
    panel(true, { nodes: store.nodes as unknown as WorkflowNode[], edges: store.edges as unknown as WorkflowEdge[] })
    const button = screen.getByRole("button", { name: /Replace Apply EDL with Speaker View/ })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    expect(screen.getByTestId("render-swap-cameras-unjudged").textContent).toContain("the cameras may need re-wiring")
    expect(document.body.textContent).toContain("Cam A → sources")
  })
})
