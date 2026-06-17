import { describe, it, expect, vi } from "vitest"

vi.mock("@/components/editor/config-panels/helpers", () => ({
  getModelIdentifier: (n: { type?: string }) => `${n.type}-model`,
}))
vi.mock("../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../types")>()
  return { ...actual, getFanOutMultiplier: () => 2 }
})

import { estimateRunCredits } from "../estimate-run-credits"
import type { WorkflowNode } from "@/types/nodes"

function n(id: string, type: string): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id } } as WorkflowNode
}

// Injected cached-cost lookup (the real one lives under @/ee).
const cachedCost = (id: string) => (id === "generate-image-model" ? 5 : undefined)

describe("estimateRunCredits", () => {
  it("sums (cached cost or NODE_CREDIT_COSTS fallback) × fan-out per node", () => {
    const nodes = [n("n1", "generate-image"), n("n2", "totally-unknown-type")]
    // n1: cached 5 × 2 = 10; n2: unknown → fallback 1 × 2 = 2 → 12
    expect(estimateRunCredits(nodes, nodes, [], cachedCost)).toBe(12)
  })

  it("returns 0 for an empty executable set", () => {
    expect(estimateRunCredits([], [], [], cachedCost)).toBe(0)
  })
})
