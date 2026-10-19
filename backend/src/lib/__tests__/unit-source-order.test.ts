import { describe, it, expect } from "vitest"
import { orderSourceRows } from "@nodaro/render-rules"

describe("orderSourceRows (Speaker Map's sources, both engines)", () => {
  const rows = [{ id: "n1", url: "1", kind: "video" as const }, { id: "n2", url: "2", kind: "video" as const }, { id: "m", url: "3", kind: "audio" as const }]
  it("listed first by sourceOrder, then the rest in wire order; an id no longer wired is skipped", () => {
    expect(orderSourceRows(rows, ["m", "gone", "n2"]).map((r) => r.id)).toEqual(["m", "n2", "n1"])
    expect(orderSourceRows(rows, undefined).map((r) => r.id)).toEqual(["n1", "n2", "m"])
  })
  it("an id listed twice is taken once (one row per upstream node)", () => {
    expect(orderSourceRows(rows, ["n2", "n2", "m", "n2"]).map((r) => r.id)).toEqual(["n2", "m", "n1"])
  })
  it("a second row from a node is dropped, listed or not (the one rule a use-case node's recordings follow too)", () => {
    const twice = [...rows, { id: "n1", url: "1b", kind: "video" as const }]
    expect(orderSourceRows(twice, undefined).map((r) => r.url)).toEqual(["1", "2", "3"])
    expect(orderSourceRows(twice, ["n1"]).map((r) => r.url)).toEqual(["1", "2", "3"])
  })
  it("orders by another key when given one", () => {
    const wired = [{ nodeId: "a", n: 1 }, { nodeId: "b", n: 2 }]
    expect(orderSourceRows(wired, ["b"], (w) => w.nodeId).map((w) => w.n)).toEqual([2, 1])
  })
  it("never mutates its inputs", () => {
    const order = ["m"]
    const before = JSON.stringify([rows, order])
    orderSourceRows(rows, order)
    expect(JSON.stringify([rows, order])).toBe(before)
  })
})
