import { describe, it, expect } from "vitest"
import { executeSortList } from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function makeUpstreamJob(
  id: string,
  output: Record<string, unknown>,
): [SimpleNode, NodeExecutionState] {
  const node: SimpleNode = {
    id,
    type: "generate-script",
    data: { label: "upstream" },
  } as SimpleNode
  const state: NodeExecutionState = { status: "completed", output }
  return [node, state]
}

function makeSortNode(data: Record<string, unknown>): SimpleNode {
  return {
    id: "sort",
    type: "sort-list",
    data: { label: "Sort List", ...data },
  } as SimpleNode
}

describe("executeSortList", () => {
  it("sorts listResults numerically ascending by field", () => {
    const [upstream, upstreamState] = makeUpstreamJob("u", {
      listResults: [
        JSON.stringify({ id: 1, score: 5 }),
        JSON.stringify({ id: 2, score: 9 }),
        JSON.stringify({ id: 3, score: 1 }),
      ],
    })
    const sort = makeSortNode({ field: "score", sortType: "number", direction: "asc" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "u", target: "sort" }]
    const nodes = [upstream, sort]
    const states = { u: upstreamState }

    const result = executeSortList(sort, edges, nodes, states)
    expect(result.listResults?.map((r) => JSON.parse(r).id)).toEqual([3, 1, 2])
    expect(result.text).toBe(result.listResults?.[0])
  })

  it("spreads upstream JSON arrays into individual items (web-scrape shape)", () => {
    const [upstream, upstreamState] = makeUpstreamJob("u", {
      json: [
        { name: "b" },
        { name: "a" },
        { name: "c" },
      ],
    })
    const sort = makeSortNode({ field: "name", sortType: "text", direction: "asc" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "u", target: "sort" }]
    const result = executeSortList(sort, edges, [upstream, sort], { u: upstreamState })
    expect(result.listResults?.map((r) => JSON.parse(r).name)).toEqual(["a", "b", "c"])
  })

  it("places missing/invalid items last regardless of direction", () => {
    const [upstream, upstreamState] = makeUpstreamJob("u", {
      listResults: [
        JSON.stringify({ id: 1 }),
        JSON.stringify({ id: 2, score: 5 }),
        JSON.stringify({ id: 3, score: 1 }),
      ],
    })
    const edges: SimpleEdge[] = [{ id: "e1", source: "u", target: "sort" }]
    const nodes = [upstream, makeSortNode({})]

    const asc = executeSortList(
      makeSortNode({ field: "score", sortType: "number", direction: "asc" }),
      edges, nodes, { u: upstreamState },
    )
    expect(asc.listResults?.map((r) => JSON.parse(r).id)).toEqual([3, 2, 1])

    const desc = executeSortList(
      makeSortNode({ field: "score", sortType: "number", direction: "desc" }),
      edges, nodes, { u: upstreamState },
    )
    expect(desc.listResults?.map((r) => JSON.parse(r).id)).toEqual([2, 3, 1])
  })

  it("returns empty output for empty upstream", () => {
    const [upstream, upstreamState] = makeUpstreamJob("u", { listResults: [] })
    const result = executeSortList(
      makeSortNode({ field: "", sortType: "auto", direction: "asc" }),
      [{ id: "e", source: "u", target: "sort" }],
      [upstream],
      { u: upstreamState },
    )
    expect(result.listResults).toEqual([])
    expect(result.text).toBe("")
  })
})
