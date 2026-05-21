import { describe, expect, it } from "vitest"
import type { NodeOutput } from "../types"

describe("NodeOutput", () => {
  it("allows optional result field (used by collect node)", () => {
    const o: NodeOutput = { result: "anything" }
    expect(o.result).toBe("anything")
  })
})
