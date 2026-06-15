import { describe, it, expect } from "vitest"
import { getNodeConnectors } from "../node-connectors"

const focused = { id: "gi1", type: "generate-image" }
const result = { id: "tp1", type: "text-prompt" }

describe("getNodeConnectors", () => {
  it("offers connectors for a valid focused×result pair, all disconnected with no edges", () => {
    const cs = getNodeConnectors(focused, result, [])
    expect(cs.length).toBeGreaterThan(0)
    expect(cs.every((c) => !c.connected && c.edgeId === undefined)).toBe(true)
    // text-prompt feeds generate-image's prompt input (result → focused).
    expect(cs.some((c) => c.direction === "target" && c.targetHandle === "prompt")).toBe(true)
  })

  it("marks a connector connected when a matching edge exists", () => {
    const first = getNodeConnectors(focused, result, [])[0]
    const edge = {
      id: "e1",
      source: first.source,
      sourceHandle: first.sourceHandle,
      target: first.target,
      targetHandle: first.targetHandle,
    }
    const cs = getNodeConnectors(focused, result, [edge])
    const match = cs.find((c) => c.key === first.key)
    expect(match?.connected).toBe(true)
    expect(match?.edgeId).toBe("e1")
  })

  it("caps at the requested max", () => {
    expect(getNodeConnectors(focused, result, [], { max: 1 }).length).toBeLessThanOrEqual(1)
  })

  it("returns nothing for the focused node's own row", () => {
    expect(getNodeConnectors(focused, { id: "gi1", type: "generate-image" }, [])).toEqual([])
  })

  it("returns nothing when a type is missing", () => {
    expect(getNodeConnectors(focused, { id: "x", type: undefined }, [])).toEqual([])
  })
})
