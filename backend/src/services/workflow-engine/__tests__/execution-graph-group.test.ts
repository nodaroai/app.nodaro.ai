import { describe, expect, it } from "vitest"
import { buildExecutionLevels, isSourceNode } from "../execution-graph.js"
import type { SimpleNode } from "../types.js"

describe("buildExecutionLevels with group", () => {
  it("orders children before group", () => {
    const nodes: SimpleNode[] = [
      { id: "g", type: "group", data: {} },
      { id: "c1", type: "text-prompt", data: {}, parentId: "g" },
    ]
    const levels = buildExecutionLevels(nodes, [])
    const flat = levels.flat().map((n) => n.id)
    expect(flat.indexOf("c1")).toBeLessThan(flat.indexOf("g"))
  })

  it("orders both children before group", () => {
    const nodes: SimpleNode[] = [
      { id: "g", type: "group", data: {} },
      { id: "c1", type: "text-prompt", data: {}, parentId: "g" },
      { id: "c2", type: "text-prompt", data: {}, parentId: "g" },
    ]
    const levels = buildExecutionLevels(nodes, [])
    const flat = levels.flat().map((n) => n.id)
    expect(flat.indexOf("c1")).toBeLessThan(flat.indexOf("g"))
    expect(flat.indexOf("c2")).toBeLessThan(flat.indexOf("g"))
  })
})

describe("isSourceNode", () => {
  it("does NOT treat group as a source node", () => {
    expect(isSourceNode("group")).toBe(false)
  })
  it("does NOT treat collect as a source node", () => {
    expect(isSourceNode("collect")).toBe(false)
  })
})
