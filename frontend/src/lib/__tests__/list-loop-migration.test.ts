import { describe, it, expect } from "vitest"
import { migrateListLoopNodes, isMultiColumnList } from "../list-loop-migration"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const mk = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode)

describe("migrateListLoopNodes", () => {
  it("rewrites loop → list, leaving columns/rows intact", () => {
    const cols = [{ id: "c1", name: "Shot", handleId: "col_c1", type: "text" }]
    const { nodes } = migrateListLoopNodes([mk("n1", "loop", { columns: cols, rows: [["a"]] })], [])
    expect(nodes[0].type).toBe("list")
    expect((nodes[0].data as Record<string, unknown>).columns).toEqual(cols)
  })

  it("converts legacy items string → columns + rows and drops items", () => {
    const { nodes } = migrateListLoopNodes([mk("n1", "list", { items: "a\nb\n\nc" })], [])
    const d = nodes[0].data as Record<string, unknown>
    expect(d.items).toBeUndefined()
    expect((d.columns as unknown[]).length).toBe(1)
    expect(d.rows).toEqual([["a"], ["b"], ["c"]])
  })

  it("ensures a default column for a list with no columns (legacy effect branch 2)", () => {
    const { nodes } = migrateListLoopNodes([mk("n1", "list", {})], [])
    const d = nodes[0].data as Record<string, unknown>
    expect((d.columns as unknown[]).length).toBe(1)
    expect(d.rows).toEqual([[""]])
  })

  it("does NOT inject a default column into an empty loop (preserves empty-table)", () => {
    const { nodes } = migrateListLoopNodes([mk("n1", "loop", { columns: [], rows: [] })], [])
    expect(nodes[0].type).toBe("list")
    expect((nodes[0].data as Record<string, unknown>).columns).toEqual([])
  })

  it("is idempotent (second run is a no-op)", () => {
    const once = migrateListLoopNodes([mk("n1", "loop", { items: "a\nb" })], [])
    const twice = migrateListLoopNodes(once.nodes, once.edges)
    expect(twice.nodes).toEqual(once.nodes)
  })

  it("leaves unrelated nodes and all edges untouched", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2" }] as unknown as WorkflowEdge[]
    const { nodes, edges: out } = migrateListLoopNodes([mk("n1", "text-prompt", { text: "hi" })], edges)
    expect(nodes[0].type).toBe("text-prompt")
    expect(out).toEqual(edges)
  })
})

describe("isMultiColumnList", () => {
  it("returns true for >1 columns (former loop/Table)", () => {
    expect(isMultiColumnList({ columns: [{ id: "c1" }, { id: "c2" }] })).toBe(true)
  })
  it("returns false for exactly 1 column (single-column list)", () => {
    expect(isMultiColumnList({ columns: [{ id: "c1" }] })).toBe(false)
  })
  it("returns false for 0 columns", () => {
    expect(isMultiColumnList({ columns: [] })).toBe(false)
  })
  it("returns false when columns is missing/undefined", () => {
    expect(isMultiColumnList({})).toBe(false)
    expect(isMultiColumnList(undefined)).toBe(false)
  })
})
