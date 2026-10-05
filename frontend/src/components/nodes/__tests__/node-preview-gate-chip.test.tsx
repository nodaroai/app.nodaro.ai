import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("lucide-react", () => new Proxy({} as Record<PropertyKey, unknown>, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

type N = { id: string; type: string; data: Record<string, unknown>; position: { x: number; y: number } }
const store = vi.hoisted(() => ({ nodes: [] as N[], edges: [] as Array<{ id: string; source: string; target: string }> }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(store),
    { getState: () => store },
  ),
}))

import { NodePreviewGateChip } from "../node-preview-gate-chip"

// PREVIEW_STOP_RULE_ENABLED, as /config.js hands it to the editor (decided
// 2026-10-05): on for these cases unless a case turns it off.
const previewRuleOn = () => { window.__NODARO_RUNTIME__ = { previewStopRule: true } }
const previewRuleOff = () => { delete window.__NODARO_RUNTIME__ }
afterEach(previewRuleOff)

const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data, position: { x: 0, y: 0 } })

function graph(quality: "proxy" | "final") {
  store.nodes = [n("plan", "edit-plan"), n("cut", "apply-edl", { quality }), n("cap", "add-captions")]
  store.edges = [
    { id: "a", source: "plan", target: "cut" },
    { id: "b", source: "cut", target: "cap" },
  ]
}

describe("NodePreviewGateChip", () => {
  beforeEach(() => {
    cleanup()
    previewRuleOn()
  })

  it("reads 'After Render final' on a node a Preview render gates, with the hint", () => {
    graph("proxy")
    render(<NodePreviewGateChip nodeId="cap" />)
    expect(screen.getByRole("note")).toHaveTextContent("After Render final")
    expect(screen.getByRole("note")).toHaveAttribute("title", "Runs on the final; not billed in this run")
  })

  it("is not on the render itself, nor upstream of it", () => {
    graph("proxy")
    expect(render(<NodePreviewGateChip nodeId="cut" />).container).toBeEmptyDOMElement()
    cleanup()
    expect(render(<NodePreviewGateChip nodeId="plan" />).container).toBeEmptyDOMElement()
  })

  it("is gone once the render is Final", () => {
    graph("final")
    expect(render(<NodePreviewGateChip nodeId="cap" />).container).toBeEmptyDOMElement()
  })

  it("PREVIEW_STOP_RULE_ENABLED off: no chip anywhere", () => {
    previewRuleOff()
    graph("proxy")
    expect(render(<NodePreviewGateChip nodeId="cap" />).container).toBeEmptyDOMElement()
  })
})
