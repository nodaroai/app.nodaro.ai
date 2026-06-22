import { describe, it, expect } from "vitest"
import { nodeTypes } from "../index"

describe("voice-changer-pro node registration", () => {
  it("is wired into the React Flow nodeTypes map", () => {
    expect(nodeTypes["voice-changer-pro"]).toBeDefined()
  })
})
