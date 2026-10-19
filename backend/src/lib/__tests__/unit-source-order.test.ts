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
  it("never mutates its inputs", () => {
    const order = ["m"]
    const before = JSON.stringify([rows, order])
    orderSourceRows(rows, order)
    expect(JSON.stringify([rows, order])).toBe(before)
  })
})
