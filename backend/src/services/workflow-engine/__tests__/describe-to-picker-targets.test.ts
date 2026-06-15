import { describe, it, expect } from "vitest"
import { pickerFanoutTargets } from "@nodaro/shared"
import { buildSyncHttpBody } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const nodes: SimpleNode[] = [
  { id: "dp", type: "describe-to-picker", data: { label: "DP" } },
  { id: "p", type: "person", data: { label: "Person" } },
  { id: "s", type: "styling", data: { label: "Styling" } },
  { id: "txt", type: "combine-text", data: { label: "T" } },
]
const edges = [
  { source: "dp", target: "p", sourceHandle: "picker-json" },
  { source: "dp", target: "s", sourceHandle: "picker-json" },
  { source: "dp", target: "txt", sourceHandle: "picker-json" }, // combine-text not analyzable
]

describe("buildSyncHttpBody describe-to-picker", () => {
  it("sends the edge-derived targetPickers", () => {
    const derived = pickerFanoutTargets("dp", edges, nodes) // ["person","styling"]
    const ctx = { userId: "u1" } as OrchestratorContext
    const body = buildSyncHttpBody(nodes[0], { imageUrl: "https://x/y.png" }, ctx, undefined, new Map(), derived)
    expect(body).toMatchObject({ imageUrl: "https://x/y.png", targetPickers: ["person", "styling"], userId: "u1" })
  })
})
