// The graphs a run reaches THROUGH a component node (R51's run-start check): a component's
// snapshot and what it references, never a graph reached only through sub-workflow nodes (the
// run's own loader reads those), and nothing read for a run with neither.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { ugcComposedKey } from "@nodaro/render-rules"

const read = vi.hoisted(() => ({ graph: new Map<string, { nodes: unknown[]; edges: unknown[] }>(), calls: 0 }))
vi.mock("@/lib/ugc-composed-graph.js", () => ({
  loadUgcComposedGraph: async () => {
    read.calls++
    return { graph: read.graph, opaque: new Map(), failed: false, loads: read.graph.size }
  },
}))

import { componentRunGraphs } from "../llm-unpriced-component-graphs.js"

const chat = (id: string) => ({ id, type: "llm-chat", data: { llmModel: "m" } })

beforeEach(() => {
  read.graph = new Map()
  read.calls = 0
})

describe("componentRunGraphs", () => {
  it("returns each graph reached through a component, with its path; not one reached only through sub-workflows", async () => {
    const root = [{ id: "sw", type: "sub-workflow", data: {} }, { id: "c1", type: "component", data: { appSlug: "a" } }]
    read.graph = new Map([
      [ugcComposedKey([]), { nodes: root, edges: [] }],
      [ugcComposedKey(["sw"]), { nodes: [chat("in-sub"), { id: "c2", type: "component", data: { appSlug: "b" } }], edges: [] }],
      [ugcComposedKey(["sw", "c2"]), { nodes: [chat("in-c2")], edges: [] }],
      [ugcComposedKey(["c1"]), { nodes: [chat("in-c1"), { id: "sw2", type: "sub-workflow", data: {} }], edges: [] }],
      [ugcComposedKey(["c1", "sw2"]), { nodes: [chat("in-c1-sub")], edges: [] }],
    ])
    const graphs = await componentRunGraphs(root, [], "owner")
    expect(graphs.map((g) => g.path)).toEqual([["sw", "c2"], ["c1"], ["c1", "sw2"]])
    expect(graphs.find((g) => g.path.join() === "c1")!.nodes.map((n) => n.id)).toEqual(["in-c1", "sw2"])
  })

  it("reads nothing for a run with no component or sub-workflow node", async () => {
    expect(await componentRunGraphs([chat("a")], [], "owner")).toEqual([])
    expect(read.calls).toBe(0)
  })
})
