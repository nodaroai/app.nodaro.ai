/**
 * "Back to Apply EDL" on Speaker View (Round 2, decided 2026-10-08): the swap
 * the other way, offered in the panel with the same confirm. The render it goes
 * back to comes from the registry, never a literal.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

const { store } = vi.hoisted(() => {
  const store = {
    nodes: [] as Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>,
    edges: [] as Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>,
    presentationSettings: { runTarget: "workflow" } as Record<string, unknown>,
    isReadOnly: false,
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
import { SpeakerViewConfig } from "../speaker-view-config"
import { SPEAKER_VIEW_TYPE } from "@/lib/replace-render-node"
import type { SpeakerViewData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

const AE = RENDER_NODE_TYPE_IDS.find((t) => t !== SPEAKER_VIEW_TYPE)!
const at = { x: 0, y: 0 }

function panel(readOnly = false) {
  store.isReadOnly = readOnly
  store.nodes = [
    { id: "cs", type: "camera-switch", position: at, data: { label: "Camera Switch" } },
    { id: "sv", type: SPEAKER_VIEW_TYPE, position: at, data: { label: "Speaker View" } },
    { id: "ac", type: "add-captions", position: at, data: { label: "Add Captions" } },
  ]
  store.edges = [
    { id: "e1", source: "cs", sourceHandle: "edl", target: "sv", targetHandle: "edl" },
    { id: "e2", source: "sv", sourceHandle: "transcript", target: "ac", targetHandle: "transcript" },
  ]
  store.presentationSettings = { runTarget: "workflow", outputItems: [{ type: "output", id: "o1", nodeId: "sv", outputKey: "result" }] }
  render(
    <SpeakerViewConfig
      data={{ label: "Speaker View", fieldMappings: {} } as unknown as SpeakerViewData}
      onUpdate={() => {}}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={store.nodes as unknown as WorkflowNode[]}
      edges={store.edges as unknown as WorkflowEdge[]}
      nodeId="sv"
    />,
  )
}

afterEach(() => cleanup())

describe("Back to Apply EDL (Speaker View panel)", () => {
  it("offers the swap back, saying what it keeps and moves", () => {
    panel()
    const action = screen.getByTestId("replace-render-node")
    expect(action.textContent).toContain("Back to Apply EDL")
    expect(action.textContent).toContain("keeps the edl wires")
    expect(action.textContent).toContain("moves 1 app item")
    expect(AE).not.toBe(SPEAKER_VIEW_TYPE)
  })

  it("the confirm lists the moved transcript wire and the app output Apply EDL cannot show", () => {
    panel()
    fireEvent.click(screen.getByRole("button", { name: /Back to Apply EDL/ }))
    const text = document.body.textContent ?? ""
    expect(text).toContain("Replace Speaker View with Apply EDL?")
    expect(text).toContain("Add Captions: transcript → json")
    expect(text).toContain("App output: result — Apply EDL does not show it")
    expect(screen.queryByTestId("render-swap-cameras-unjudged")).toBeNull()
  })

  it("not on a read-only canvas", () => {
    panel(true)
    expect(screen.queryByTestId("replace-render-node")).toBeNull()
  })
})
