// frontend/src/lib/__tests__/node-position.test.ts
import { describe, it, expect } from "vitest"
import { ensureNodePositions } from "@/lib/node-position"
import type { WorkflowNode } from "@/types/nodes"

const mk = (id: string, position?: unknown): WorkflowNode =>
  ({ id, type: "generate-image", data: {}, ...(position !== undefined ? { position } : {}) }) as unknown as WorkflowNode

describe("ensureNodePositions", () => {
  it("fills nodes with no position using a deterministic grid", () => {
    const { nodes, filledCount } = ensureNodePositions([mk("a"), mk("b")])
    expect(filledCount).toBe(2)
    expect(Number.isFinite(nodes[0].position.x)).toBe(true)
    expect(Number.isFinite(nodes[0].position.y)).toBe(true)
    expect(nodes[1].position).not.toEqual(nodes[0].position)
  })

  it("preserves existing valid positions and does not mutate input", () => {
    const input = [mk("a", { x: 10, y: 20 })]
    const frozen = Object.freeze({ ...input[0] })
    const { nodes, filledCount } = ensureNodePositions([frozen as WorkflowNode])
    expect(filledCount).toBe(0)
    expect(nodes[0].position).toEqual({ x: 10, y: 20 })
  })

  it("fills non-finite or partial positions", () => {
    const { nodes, filledCount } = ensureNodePositions([mk("a", { x: NaN, y: 5 }), mk("b", {})])
    expect(filledCount).toBe(2)
    expect(Number.isFinite(nodes[0].position.x)).toBe(true)
    expect(Number.isFinite(nodes[1].position.y)).toBe(true)
  })

  it("handles empty array", () => {
    expect(ensureNodePositions([])).toEqual({ nodes: [], filledCount: 0 })
  })
})
