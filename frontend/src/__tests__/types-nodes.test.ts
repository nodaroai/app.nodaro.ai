import { describe, expect, it } from "vitest"
import type { ReduceNodeData, SceneNodeData, SceneNodeType } from "../types/nodes"
import { NODE_DEFINITIONS } from "../types/nodes"

describe("ReduceNodeData", () => {
  it("ReduceNodeData is part of SceneNodeData union", () => {
    const data: SceneNodeData = {
      label: "Reduce",
      strategyId: "concat",
      strategyConfig: { separator: "-" },
    } as ReduceNodeData
    expect((data as ReduceNodeData).strategyId).toBe("concat")
  })

  it("'reduce' is in SceneNodeType", () => {
    const t: SceneNodeType = "reduce"
    expect(t).toBe("reduce")
  })

  it("NODE_DEFINITIONS has an entry for 'reduce'", () => {
    expect(NODE_DEFINITIONS.find((n) => n.type === "reduce")).toBeTruthy()
  })

  it("NODE_DEFINITIONS 'reduce' entry has the expected default strategy", () => {
    const def = NODE_DEFINITIONS.find((n) => n.type === "reduce")
    expect(def).toBeDefined()
    const data = def!.defaultData as ReduceNodeData
    expect(data.strategyId).toBe("concat")
    expect(data.strategyConfig).toBeDefined()
    expect((data.strategyConfig as { separator?: string }).separator).toBe("\n\n")
  })
})
