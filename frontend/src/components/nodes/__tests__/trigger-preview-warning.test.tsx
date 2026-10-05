import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("lucide-react", () => new Proxy({} as Record<PropertyKey, unknown>, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

type N = { id: string; type: string; data: Record<string, unknown>; position: { x: number; y: number } }
const store = vi.hoisted(() => ({ nodes: [] as N[], edges: [] as Array<{ id: string; source: string; target: string }> }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign((selector: (s: unknown) => unknown) => selector(store), { getState: () => store }),
}))

import { TriggerPreviewWarning } from "../trigger-preview-warning"

// PREVIEW_STOP_RULE_ENABLED, as /config.js hands it to the editor (decided
// 2026-10-05): on for these cases unless a case turns it off.
const previewRuleOn = () => { window.__NODARO_RUNTIME__ = { previewStopRule: true } }
const previewRuleOff = () => { delete window.__NODARO_RUNTIME__ }
afterEach(previewRuleOff)

const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data, position: { x: 0, y: 0 } })

describe("TriggerPreviewWarning", () => {
  beforeEach(() => {
    cleanup()
    previewRuleOn()
    store.nodes = [n("trig", "schedule-trigger"), n("cut", "apply-edl", { quality: "proxy" })]
    store.edges = [{ id: "a", source: "trig", target: "cut" }]
  })

  it("warns on an armed trigger whose branch runs a Preview render", () => {
    render(<TriggerPreviewWarning nodeId="trig" armed />)
    expect(screen.getByRole("alert")).toHaveTextContent("Runs from this trigger are refused")
  })

  it("says nothing on a trigger that is not armed", () => {
    expect(render(<TriggerPreviewWarning nodeId="trig" armed={false} />).container).toBeEmptyDOMElement()
  })

  it("says nothing once the render is Final", () => {
    store.nodes = [n("trig", "schedule-trigger"), n("cut", "apply-edl", { quality: "final" })]
    expect(render(<TriggerPreviewWarning nodeId="trig" armed />).container).toBeEmptyDOMElement()
  })

  it("PREVIEW_STOP_RULE_ENABLED off: no warning (the server refuses nothing)", () => {
    previewRuleOff()
    expect(render(<TriggerPreviewWarning nodeId="trig" armed />).container).toBeEmptyDOMElement()
  })
})
