import { describe, it, expect, vi } from "vitest"
import type { WorkflowNode } from "@/types/nodes"

vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

const { speakerViewPricePreflight } = await import("../speaker-view-price-preflight")
const { nestedRunPreflight } = await import("../sub-workflow-preflight")

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode

describe("speakerViewPricePreflight", () => {
  it("names the first Speaker View node the run executes", () => {
    const msg = speakerViewPricePreflight([node("t", "transcribe"), node("Speakers", "speaker-view")])
    expect(msg).toContain("Speakers")
    expect(msg).toContain("Speaker View is not priced yet")
  })

  it("lets a run with no Speaker View start, and ignores a skipped one", () => {
    expect(speakerViewPricePreflight([node("t", "transcribe")])).toBeNull()
    expect(speakerViewPricePreflight([node("sv", "speaker-view", { skipped: true })])).toBeNull()
  })

  it("is part of the nested walk: a Speaker View inside a referenced workflow refuses the run up front", async () => {
    const sub = node("s1", "sub-workflow", {
      referencedWorkflowId: "wf-a",
      selectedRouteId: "r1",
      routeSnapshot: { inputPorts: [], outputPorts: [], visibleOutputPortId: "out" },
    })
    const msg = await nestedRunPreflight([sub], {
      load: async () => ({
        nodes: [node("Inner Speakers", "speaker-view")],
        edges: [],
        inputNode: node("in", "sub-workflow-input"),
        outputNode: node("out", "sub-workflow-output"),
      }),
    })
    expect(msg).toContain("Inner Speakers")
    expect(msg).toContain("Speaker View is not priced yet")
  })
})
