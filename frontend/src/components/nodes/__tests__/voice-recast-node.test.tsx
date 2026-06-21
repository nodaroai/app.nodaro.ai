import { describe, it, expect } from "vitest"
import { nodeTypes } from "../index"

describe("voice-recast node registration", () => {
  it("is wired into the React Flow nodeTypes map", () => {
    expect(nodeTypes["voice-recast"]).toBeDefined()
  })
})
