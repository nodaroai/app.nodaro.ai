import { describe, it, expect } from "vitest"
import { followNodeIdMoves } from "../presentation-node-id"

const ps = (id: string) => ({ runTarget: "workflow" as const, outputItems: [{ type: "node" as const, nodeId: id }], cardMeta: { [id]: { title: "t" } } })

// An undo or redo that brings a swapped node back must bring the app's items
// back to it: they follow whichever node of a swap chain is on the canvas.
describe("followNodeIdMoves", () => {
  it("undo: the old node is back, so the items return to it", () => {
    expect(followNodeIdMoves(ps("node_9"), new Set(["r"]), [["r", "node_9"]])).toEqual(ps("r"))
  })

  it("redo: the new node is back, so the items move to it again", () => {
    expect(followNodeIdMoves(ps("r"), new Set(["node_9"]), [["r", "node_9"]])).toEqual(ps("node_9"))
  })

  it("a chain (there and back again) lands on whichever member is on the canvas", () => {
    const moves: Array<readonly [string, string]> = [["a", "b"], ["b", "c"]]
    expect(followNodeIdMoves(ps("c"), new Set(["a"]), moves)).toEqual(ps("a"))
    expect(followNodeIdMoves(ps("a"), new Set(["c"]), moves)).toEqual(ps("c"))
  })

  it("leaves the settings alone (same object) when nothing moved or no member is on the canvas", () => {
    const s = ps("r")
    expect(followNodeIdMoves(s, new Set(["r"]), [["r", "node_9"]])).toBe(s)
    expect(followNodeIdMoves(s, new Set(["x"]), [["r", "node_9"]])).toBe(s)
    expect(followNodeIdMoves(s, new Set(["r"]), [])).toBe(s)
  })
})
