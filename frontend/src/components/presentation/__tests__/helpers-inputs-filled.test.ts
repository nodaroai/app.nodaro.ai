import { describe, it, expect } from "vitest"
import type { WorkflowNode } from "@/types/nodes"
import { areAllInputsFilled } from "../helpers"

const mk = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode)

const col = (id: string, type = "text") => ({ id, name: id, handleId: `col_${id}`, type })

// After loop→list unification, `areAllInputsFilled` validates a list/loop node
// by COLUMN COUNT, not node type: multi-column lists (former loops) validate the
// `rows` (string[][]) shape; single-column lists validate the `items` shape.

describe("areAllInputsFilled — list/loop by column count", () => {
  it("single-column list: filled when items are non-empty", () => {
    const node = mk("n1", "list", { columns: [col("c1")] })
    expect(areAllInputsFilled([node], { n1: { items: ["a"] } })).toBe(true)
    expect(areAllInputsFilled([node], { n1: { items: [""] } })).toBe(false)
    expect(areAllInputsFilled([node], { n1: { items: [] } })).toBe(false)
  })

  it("multi-column list (former loop): every cell of every row must be filled", () => {
    const node = mk("n1", "list", { columns: [col("c1"), col("c2")] })
    expect(areAllInputsFilled([node], { n1: { rows: [["a", "b"]] } })).toBe(true)
    // Column 2 empty → not filled (would have been wrongly "filled" if routed
    // through the single-column items branch, which only checks column 0)
    expect(areAllInputsFilled([node], { n1: { rows: [["a", ""]] } })).toBe(false)
  })

  it("multi-column list: under minRows is not filled", () => {
    const node = mk("n1", "list", { columns: [col("c1"), col("c2")], minRows: 2 })
    expect(areAllInputsFilled([node], { n1: { rows: [["a", "b"]] } })).toBe(false)
    expect(areAllInputsFilled([node], { n1: { rows: [["a", "b"], ["c", "d"]] } })).toBe(true)
  })

  it("multi-column list with no minRows and zero rows is allowed (optional table)", () => {
    const node = mk("n1", "list", { columns: [col("c1"), col("c2")] })
    expect(areAllInputsFilled([node], { n1: { rows: [] } })).toBe(true)
  })
})
