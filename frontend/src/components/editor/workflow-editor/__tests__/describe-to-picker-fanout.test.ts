import { describe, it, expect } from "vitest"
import { pickerFanoutTargets } from "@nodaro/shared"

describe("describe-to-picker fan-out target derivation", () => {
  it("derives wired analyzable pickers from the producer's picker-json output", () => {
    const nodes = [
      { id: "dp", type: "describe-to-picker" },
      { id: "p", type: "person" },
      { id: "l", type: "lens" },
    ]
    const edges = [
      { source: "dp", target: "p", sourceHandle: "picker-json" },
      { source: "dp", target: "l", sourceHandle: "picker-json" },
    ]
    expect(pickerFanoutTargets("dp", edges, nodes).sort()).toEqual(["lens", "person"])
  })
})
